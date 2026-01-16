import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createObjectCsvWriter as csvWriter } from 'csv-writer';
import { spawn } from 'child_process';
import chalk from 'chalk';
import delay from 'delay';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Конфигурация
const CONFIG = {
    INPUT_FILE: path.join(__dirname, 'urls_meta.txt'),
    OUTPUT_DIR: path.join(__dirname, 'Result'),
    BROWSER_HEADLESS: true,
    TIMEOUT: 30000,
    PARALLEL_LIMIT: 5, // Количество одновременных браузеров
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// Создание директории для результатов
if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
}

/**
 * Открыть файл и ждать закрытия редактора
 */
function openFileAndWait(filePath) {
    return new Promise(resolve => {
        const platform = process.platform;
        let command, args;

        if (platform === 'win32') {
            command = 'notepad.exe';
            args = [filePath];
        } else if (platform === 'darwin') {
            command = 'open';
            args = ['-W', filePath];
        } else {
            spawn('xdg-open', [filePath]);
            console.log(chalk.yellow('Отредактируй файл и нажми Enter в консоли для продолжения...'));
            process.stdin.once('data', () => resolve());
            return;
        }

        const editor = spawn(command, args, { stdio: 'inherit' });
        editor.on('close', () => resolve());
    });
}

/**
 * Чтение и обработка ссылок
 */
function readUrls(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const urls = content
            .split('\n')
            .map(url => url.trim())
            .filter(url => url.length > 0 && !url.startsWith('#')) // Игнорируем комментарии
            .map(url => {
                if (!/^https?:\/\//i.test(url)) {
                    return `https://${url}`;
                }
                return url;
            });

        // Удаление дубликатов
        return [...new Set(urls)];
    } catch (error) {
        console.error(chalk.red(`Ошибка чтения файла ${filePath}:`), error.message);
        return [];
    }
}

/**
 * Скрапинг расширенной мета-информации
 */
async function scrapeMeta(url, browser) {
    const page = await browser.newPage();

    try {
        // Устанавливаем User-Agent
        await page.setUserAgent(CONFIG.USER_AGENT);

        // Переходим на страницу
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: CONFIG.TIMEOUT 
        });

        // Извлекаем мета-информацию
        const meta = await page.evaluate(() => {
            const getMeta = (selector) => {
                const element = document.querySelector(selector);
                return element?.content || element?.getAttribute('content') || '';
            };

            return {
                title: document.title || '',
                description: getMeta('meta[name="description"]') || getMeta('meta[property="og:description"]') || '',
                keywords: getMeta('meta[name="keywords"]') || '',
                ogTitle: getMeta('meta[property="og:title"]') || '',
                ogImage: getMeta('meta[property="og:image"]') || '',
                canonical: document.querySelector('link[rel="canonical"]')?.href || '',
                h1: document.querySelector('h1')?.textContent?.trim() || '',
                robots: getMeta('meta[name="robots"]') || '',
                viewport: getMeta('meta[name="viewport"]') || '',
                charset: document.characterSet || ''
            };
        });

        // Получаем статус ответа
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        const statusCode = response?.status() || 0;

        await page.close();

        return {
            url,
            statusCode,
            success: true,
            ...meta
        };

    } catch (error) {
        await page.close();
        
        return {
            url,
            statusCode: 0,
            success: false,
            error: error.message,
            title: '',
            description: '',
            keywords: '',
            ogTitle: '',
            ogImage: '',
            canonical: '',
            h1: '',
            robots: '',
            viewport: '',
            charset: ''
        };
    }
}

/**
 * Обработка URL пакетами
 */
async function processBatch(urls, startIndex) {
    const browser = await puppeteer.launch({ 
        headless: CONFIG.BROWSER_HEADLESS,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const results = [];

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const globalIndex = startIndex + i + 1;
        
        console.log(chalk.blue(`[${globalIndex}] Обработка: ${url}`));
        
        try {
            const result = await scrapeMeta(url, browser);
            results.push(result);

            if (result.success) {
                console.log(chalk.green(`  ✓ Успешно (${result.statusCode})`));
                console.log(chalk.gray(`    Title: ${result.title.substring(0, 60)}${result.title.length > 60 ? '...' : ''}`));
            } else {
                console.log(chalk.red(`  ✗ Ошибка: ${result.error}`));
            }
        } catch (error) {
            console.log(chalk.red(`  ✗ Критическая ошибка: ${error.message}`));
            results.push({
                url,
                statusCode: 0,
                success: false,
                error: error.message
            });
        }

        // Небольшая задержка между запросами
        if (i < urls.length - 1) {
            await delay(500);
        }
    }

    await browser.close();
    return results;
}

/**
 * Параллельная обработка всех URL
 */
async function processAllUrls(urls) {
    const BATCH_SIZE = CONFIG.PARALLEL_LIMIT;
    const allResults = [];
    let successCount = 0;
    let errorCount = 0;

    console.log(chalk.cyan(`\n⚡ Режим обработки: до ${BATCH_SIZE} браузеров одновременно\n`));

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(urls.length / BATCH_SIZE);

        console.log(chalk.blue(`\n📦 Пакет ${batchNumber}/${totalBatches} (${batch.length} URL)...`));

        const startTime = Date.now();
        
        // Запускаем браузеры параллельно для каждого URL в пакете
        const batchPromises = batch.map((url, idx) => {
            return (async () => {
                const browser = await puppeteer.launch({ 
                    headless: CONFIG.BROWSER_HEADLESS,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const result = await scrapeMeta(url, browser);
                await browser.close();
                
                const globalIndex = i + idx + 1;
                if (result.success) {
                    console.log(chalk.green(`✓ [${globalIndex}/${urls.length}] ${url.substring(0, 50)}...`));
                } else {
                    console.log(chalk.red(`✗ [${globalIndex}/${urls.length}] ${url.substring(0, 50)}... - ${result.error}`));
                }
                
                return result;
            })();
        });

        const batchResults = await Promise.all(batchPromises);
        
        const endTime = Date.now();
        const batchTime = ((endTime - startTime) / 1000).toFixed(2);

        batchResults.forEach(result => {
            allResults.push(result);
            if (result.success) {
                successCount++;
            } else {
                errorCount++;
            }
        });

        console.log(chalk.gray(`   Обработано за ${batchTime}с\n`));

        // Задержка между пакетами
        if (i + BATCH_SIZE < urls.length) {
            await delay(1000);
        }
    }

    return { results: allResults, successCount, errorCount };
}

/**
 * Сохранение результатов в CSV
 */
async function saveToCSV(data, format = 'full') {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = path.join(CONFIG.OUTPUT_DIR, `meta_data_${timestamp}.csv`);

    let headers;
    
    if (format === 'full') {
        headers = [
            { id: 'url', title: 'URL' },
            { id: 'statusCode', title: 'Код ответа' },
            { id: 'title', title: 'Title' },
            { id: 'description', title: 'Description' },
            { id: 'keywords', title: 'Keywords' },
            { id: 'h1', title: 'H1' },
            { id: 'ogTitle', title: 'OG Title' },
            { id: 'ogImage', title: 'OG Image' },
            { id: 'canonical', title: 'Canonical' },
            { id: 'robots', title: 'Robots' },
            { id: 'viewport', title: 'Viewport' },
            { id: 'charset', title: 'Charset' },
            { id: 'error', title: 'Ошибка' }
        ];
    } else {
        headers = [
            { id: 'url', title: 'URL' },
            { id: 'statusCode', title: 'Код ответа' },
            { id: 'title', title: 'Title' },
            { id: 'description', title: 'Description' },
            { id: 'error', title: 'Ошибка' }
        ];
    }

    const writer = csvWriter({
        path: filename,
        header: headers,
        encoding: 'utf8'
    });

    await writer.writeRecords(data);
    return filename;
}

/**
 * Главная функция
 */
async function main() {
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.cyan('  🔍 Parser Meta - Сбор мета-информации'));
    console.log(chalk.cyan('='.repeat(60) + '\n'));

    // Проверка существования файла
    if (!fs.existsSync(CONFIG.INPUT_FILE)) {
        console.log(chalk.yellow('Создаю файл urls_meta.txt...'));
        fs.writeFileSync(CONFIG.INPUT_FILE, '# Добавьте URL (каждый с новой строки)\n# Пример:\n# example.com\n# https://google.com\n');
    }

    console.log(chalk.blue('📝 Открываю файл для редактирования...'));
    await openFileAndWait(CONFIG.INPUT_FILE);

    const urls = readUrls(CONFIG.INPUT_FILE);

    if (urls.length === 0) {
        console.log(chalk.yellow('\n⚠️  Файл пуст или нет валидных URL'));
        return;
    }

    console.log(chalk.green(`\n✓ Найдено URL: ${urls.length}`));
    console.log(chalk.gray(`Параллельных браузеров: ${CONFIG.PARALLEL_LIMIT}`));
    console.log(chalk.gray(`Таймаут: ${CONFIG.TIMEOUT / 1000}с\n`));

    const startTime = Date.now();
    const { results, successCount, errorCount } = await processAllUrls(urls);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Сохранение результатов
    const savedFile = await saveToCSV(results, 'full');

    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.green(`✅ Результаты сохранены в: ${savedFile}`));
    console.log(chalk.green(`✅ Успешно обработано: ${successCount} URL`));
    if (errorCount > 0) {
        console.log(chalk.yellow(`⚠️  Ошибок: ${errorCount} URL`));
    }
    console.log(chalk.blue(`⏱️  Общее время: ${totalTime}с`));
    console.log(chalk.gray(`   Средняя скорость: ${(urls.length / totalTime).toFixed(2)} URL/сек`));
    console.log(chalk.cyan('='.repeat(60) + '\n'));
}

// Запуск
main().catch(error => {
    console.error(chalk.red('\n❌ Критическая ошибка:'), error);
    process.exit(1);
});
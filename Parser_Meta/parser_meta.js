import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createObjectCsvWriter as csvWriter } from 'csv-writer';
import { spawn } from 'child_process';
import chalk from 'chalk';
import delay from 'delay';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const CONFIG = {
    INPUT_FILE: path.join(__dirname, 'urls_meta.txt'),
    OUTPUT_DIR: path.join(__dirname, 'Result'),
    BROWSER_HEADLESS: false, // При капче нужен видимый браузер
    TIMEOUT: 30000,
    PARALLEL_LIMIT: 5,
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

    // Ключевые слова для обнаружения капчи на странице
    CAPTCHA_KEYWORDS: [
        'captcha',
        'recaptcha',
        'hcaptcha',
        'cloudflare',
        'just a moment',
        'checking your browser',
        'please verify',
        'bot detection',
        'are you human',
        'robot',
        'verify you are',
        'ddos protection',
        'challenge',
        'turnstile',
    ],

    // Паузы между запросами (мс)
    DELAY_BETWEEN_REQUESTS: 500,
    DELAY_BETWEEN_BATCHES: 1000,
};

// ============================================================
// СОСТОЯНИЕ
// ============================================================
let isPaused = false;
let pauseResolver = null;
let captchaBrowser = null; // Браузер с открытой капчей
let captchaPage = null;    // Страница с капчей

// ============================================================
// СОЗДАНИЕ ДИРЕКТОРИЙ
// ============================================================
if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
}

// ============================================================
// НАСТРОЙКА READLINE (для ввода с консоли)
// ============================================================
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

// Обработка нажатия Enter в консоли
rl.on('line', () => {
    if (isPaused && pauseResolver) {
        console.log(chalk.green('\n✅ Капча пройдена! Продолжаю обработку...\n'));
        isPaused = false;
        pauseResolver();
        pauseResolver = null;
    }
});

// ============================================================
// ФОКУС КОНСОЛИ — вынести окно терминала поверх всего
// ============================================================
function bringTerminalToFront() {
    const platform = process.platform;

    try {
        if (platform === 'win32') {
            // Windows: PowerShell скрипт для поднятия окна консоли наверх
            const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetConsoleWindow();
}
"@
$hwnd = [Win32]::GetConsoleWindow()
[Win32]::ShowWindow($hwnd, 3)
[Win32]::SetForegroundWindow($hwnd)
[Win32]::BringWindowToTop($hwnd)
`;
            spawn('powershell', ['-Command', psScript], { stdio: 'ignore', detached: true });

        } else if (platform === 'darwin') {
            // macOS: osascript для активации Terminal
            spawn('osascript', [
                '-e',
                'tell application "Terminal" to activate'
            ], { stdio: 'ignore' });

        } else {
            // Linux: wmctrl или xdotool (если установлены)
            const wmctrl = spawn('wmctrl', ['-a', 'Terminal'], { stdio: 'ignore' });
            wmctrl.on('error', () => {
                // Если wmctrl не найден — пробуем xdotool
                spawn('xdotool', ['search', '--name', 'terminal', 'windowactivate'], {
                    stdio: 'ignore'
                });
            });
        }
    } catch (e) {
        // Тихо игнорируем ошибку фокусировки — не критично
    }
}

// ============================================================
// ПАУЗА ПРИ ОБНАРУЖЕНИИ КАПЧИ
// ============================================================
async function pauseForCaptcha(url, page) {
    isPaused = true;

    // Если браузер работал headless — переключаем страницу в видимый режим (невозможно на лету,
    // но мы держим браузер с капчей открытым, чтобы пользователь видел)
    captchaPage = page;

    console.log('\n');
    console.log(chalk.bgRed.white.bold('  ╔══════════════════════════════════════════════════════╗  '));
    console.log(chalk.bgRed.white.bold('  ║          🤖 ОБНАРУЖЕНА КАПЧА / БЛОКИРОВКА            ║  '));
    console.log(chalk.bgRed.white.bold('  ╚══════════════════════════════════════════════════════╝  '));
    console.log('');
    console.log(chalk.yellow(`  URL: ${url}`));
    console.log('');
    console.log(chalk.cyan('  Что нужно сделать:'));
    console.log(chalk.white('  1. Переключитесь на открытый браузер'));
    console.log(chalk.white('  2. Пройдите капчу вручную'));
    console.log(chalk.white('  3. Убедитесь, что страница загрузилась'));
    console.log(chalk.green.bold('  4. Вернитесь сюда и нажмите [ENTER] для продолжения'));
    console.log('');
    console.log(chalk.bgGreen.black.bold('  >>> Нажмите ENTER когда капча будет пройдена <<<  '));
    console.log('');

    // Поднимаем окно терминала поверх всего через 1.5 секунды
    // (даём время браузеру отобразить страницу с капчей)
    setTimeout(() => {
        bringTerminalToFront();
    }, 1500);

    // Ждём нажатия Enter
    await new Promise(resolve => {
        pauseResolver = resolve;
    });
}

// ============================================================
// ПРОВЕРКА НАЛИЧИЯ КАПЧИ НА СТРАНИЦЕ
// ============================================================
async function checkForCaptcha(page) {
    try {
        const pageContent = await page.evaluate(() => {
            return {
                title: document.title?.toLowerCase() || '',
                bodyText: document.body?.innerText?.substring(0, 2000)?.toLowerCase() || '',
                url: window.location.href?.toLowerCase() || '',
            };
        });

        const textToCheck = `${pageContent.title} ${pageContent.bodyText} ${pageContent.url}`;

        for (const keyword of CONFIG.CAPTCHA_KEYWORDS) {
            if (textToCheck.includes(keyword.toLowerCase())) {
                return true;
            }
        }

        // Проверяем наличие iframe капч
        const hasCaptchaIframe = await page.evaluate(() => {
            const iframes = Array.from(document.querySelectorAll('iframe'));
            return iframes.some(iframe => {
                const src = (iframe.src || '').toLowerCase();
                return src.includes('captcha') || src.includes('recaptcha') ||
                       src.includes('hcaptcha') || src.includes('turnstile') ||
                       src.includes('challenge');
            });
        });

        if (hasCaptchaIframe) return true;

        return false;
    } catch (e) {
        return false;
    }
}

// ============================================================
// СКРАПИНГ МЕТА-ИНФОРМАЦИИ
// ============================================================
async function scrapeMeta(url, browser) {
    const page = await browser.newPage();

    try {
        await page.setUserAgent(CONFIG.USER_AGENT);

        // Переходим на страницу
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: CONFIG.TIMEOUT
        }).catch(err => {
            throw new Error(err.message);
        });

        const statusCode = response?.status() || 0;

        // Небольшая пауза для полной загрузки динамического контента
        await delay(800);

        // Проверяем наличие капчи
        const hasCaptcha = await checkForCaptcha(page);

        if (hasCaptcha) {
            console.log(chalk.red(`  ⚠️  Капча на ${url}`));

            // Если браузер headless — нужно переоткрыть страницу в видимом режиме
            // Для этого запускаем отдельный видимый браузер
            let visibleBrowser = null;
            let visiblePage = null;

            try {
                visibleBrowser = await puppeteer.launch({
                    headless: false, // Видимый!
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--start-maximized',
                        '--window-size=1366,768',
                    ],
                    defaultViewport: null, // Полный размер окна
                });

                visiblePage = await visibleBrowser.newPage();
                await visiblePage.setUserAgent(CONFIG.USER_AGENT);
                await visiblePage.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: CONFIG.TIMEOUT
                }).catch(() => {});

            } catch (e) {
                // Если не смогли открыть видимый браузер — используем текущую страницу
                visiblePage = page;
            }

            // Пауза — ждём пока пользователь пройдёт капчу
            await pauseForCaptcha(url, visiblePage);

            // После нажатия Enter — пробуем ещё раз собрать мету с видимой страницы
            let metaFromCaptchaPage = null;
            try {
                const pageToExtract = visiblePage || page;

                metaFromCaptchaPage = await pageToExtract.evaluate(() => {
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
                        charset: document.characterSet || '',
                    };
                });
            } catch (e) {
                // Не смогли получить мету после капчи
            }

            // Закрываем видимый браузер (если открывали отдельный)
            if (visibleBrowser && visibleBrowser !== browser) {
                await visibleBrowser.close().catch(() => {});
            }

            await page.close().catch(() => {});

            if (metaFromCaptchaPage) {
                return {
                    url,
                    statusCode,
                    success: true,
                    captcha: true,
                    ...metaFromCaptchaPage
                };
            }

            return {
                url,
                statusCode,
                success: false,
                captcha: true,
                error: 'Капча — данные не получены',
                title: '', description: '', keywords: '',
                ogTitle: '', ogImage: '', canonical: '',
                h1: '', robots: '', viewport: '', charset: ''
            };
        }

        // Капчи нет — обычный сбор мета-данных
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
                charset: document.characterSet || '',
            };
        });

        await page.close();

        return {
            url,
            statusCode,
            success: true,
            captcha: false,
            ...meta
        };

    } catch (error) {
        await page.close().catch(() => {});

        return {
            url,
            statusCode: 0,
            success: false,
            captcha: false,
            error: error.message,
            title: '', description: '', keywords: '',
            ogTitle: '', ogImage: '', canonical: '',
            h1: '', robots: '', viewport: '', charset: ''
        };
    }
}

// ============================================================
// ПАРАЛЛЕЛЬНАЯ ОБРАБОТКА ВСЕХ URL
// ============================================================
async function processAllUrls(urls) {
    const BATCH_SIZE = CONFIG.PARALLEL_LIMIT;
    const allResults = [];
    let successCount = 0;
    let errorCount = 0;
    let captchaCount = 0;

    console.log(chalk.cyan(`\n⚡ Режим обработки: до ${BATCH_SIZE} браузеров одновременно\n`));
    console.log(chalk.gray('  Совет: при появлении капчи скрипт встанет на паузу.\n'));

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
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-blink-features=AutomationControlled',
                    ],
                    defaultViewport: { width: 1366, height: 768 },
                });

                const result = await scrapeMeta(url, browser);
                await browser.close().catch(() => {});

                const globalIndex = i + idx + 1;

                if (result.captcha) {
                    console.log(chalk.magenta(`🔒 [${globalIndex}/${urls.length}] ${url.substring(0, 60)} — капча пройдена`));
                } else if (result.success) {
                    console.log(chalk.green(`✓ [${globalIndex}/${urls.length}] ${url.substring(0, 60)}`));
                } else {
                    console.log(chalk.red(`✗ [${globalIndex}/${urls.length}] ${url.substring(0, 60)} — ${result.error?.substring(0, 60)}`));
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
                if (result.captcha) captchaCount++;
            } else {
                errorCount++;
            }
        });

        console.log(chalk.gray(`   Обработано за ${batchTime}с`));

        // Задержка между пакетами
        if (i + BATCH_SIZE < urls.length) {
            await delay(CONFIG.DELAY_BETWEEN_BATCHES);
        }
    }

    return { results: allResults, successCount, errorCount, captchaCount };
}

// ============================================================
// ОТКРЫТЬ ФАЙЛ И ЖДАТЬ ЗАКРЫТИЯ РЕДАКТОРА
// ============================================================
function openFileAndWait(filePath) {
    return new Promise(resolve => {
        const platform = process.platform;

        if (platform === 'win32') {
            const editor = spawn('notepad.exe', [filePath], { stdio: 'inherit' });
            editor.on('close', () => resolve());
        } else if (platform === 'darwin') {
            const editor = spawn('open', ['-W', filePath]);
            editor.on('close', () => resolve());
        } else {
            spawn('xdg-open', [filePath]);
            console.log(chalk.yellow('Отредактируй файл и нажми Enter в консоли для продолжения...'));
            process.stdin.once('data', () => resolve());
        }
    });
}

// ============================================================
// ЧТЕНИЕ URL ИЗ ФАЙЛА
// ============================================================
function readUrls(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const urls = content
            .split('\n')
            .map(url => url.trim())
            .filter(url => url.length > 0 && !url.startsWith('#'))
            .map(url => {
                if (!/^https?:\/\//i.test(url)) {
                    return `https://${url}`;
                }
                return url;
            });

        return [...new Set(urls)];
    } catch (error) {
        console.error(chalk.red(`Ошибка чтения файла ${filePath}:`), error.message);
        return [];
    }
}

// ============================================================
// СОХРАНЕНИЕ РЕЗУЛЬТАТОВ В CSV
// ============================================================
async function saveToCSV(data) {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = path.join(CONFIG.OUTPUT_DIR, `meta_data_${timestamp}.csv`);

    const headers = [
        { id: 'url',         title: 'URL' },
        { id: 'statusCode',  title: 'Код ответа' },
        { id: 'captcha',     title: 'Капча' },
        { id: 'title',       title: 'Title' },
        { id: 'description', title: 'Description' },
        { id: 'keywords',    title: 'Keywords' },
        { id: 'h1',          title: 'H1' },
        { id: 'ogTitle',     title: 'OG Title' },
        { id: 'ogImage',     title: 'OG Image' },
        { id: 'canonical',   title: 'Canonical' },
        { id: 'robots',      title: 'Robots' },
        { id: 'viewport',    title: 'Viewport' },
        { id: 'charset',     title: 'Charset' },
        { id: 'error',       title: 'Ошибка' },
    ];

    const writer = csvWriter({
        path: filename,
        header: headers,
        encoding: 'utf8'
    });

    // Преобразуем boolean captcha в читаемый текст
    const preparedData = data.map(row => ({
        ...row,
        captcha: row.captcha ? 'Да' : '',
        error: row.error || '',
    }));

    await writer.writeRecords(preparedData);
    return filename;
}

// ============================================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================================
async function main() {
    console.log(chalk.cyan('\n' + '='.repeat(62)));
    console.log(chalk.cyan('  🔍 Parser Meta — Сбор мета-информации'));
    console.log(chalk.cyan('  🤖 С поддержкой паузы при капче'));
    console.log(chalk.cyan('='.repeat(62) + '\n'));

    // Проверка существования файла
    if (!fs.existsSync(CONFIG.INPUT_FILE)) {
        console.log(chalk.yellow('Создаю файл urls_meta.txt...'));
        fs.writeFileSync(
            CONFIG.INPUT_FILE,
            '# Добавьте URL (каждый с новой строки)\n# Пример:\n# example.com\n# https://google.com\n'
        );
    }

    console.log(chalk.blue('📝 Открываю файл для редактирования...'));
    await openFileAndWait(CONFIG.INPUT_FILE);

    const urls = readUrls(CONFIG.INPUT_FILE);

    if (urls.length === 0) {
        console.log(chalk.yellow('\n⚠️  Файл пуст или нет валидных URL'));
        rl.close();
        return;
    }

    console.log(chalk.green(`\n✓ Найдено URL: ${urls.length}`));
    console.log(chalk.gray(`  Параллельных браузеров: ${CONFIG.PARALLEL_LIMIT}`));
    console.log(chalk.gray(`  Таймаут: ${CONFIG.TIMEOUT / 1000}с`));
    console.log(chalk.gray(`  Режим браузера: ${CONFIG.BROWSER_HEADLESS ? 'headless (при капче откроется видимый)' : 'видимый'}`));
    console.log('');

    const startTime = Date.now();
    const { results, successCount, errorCount, captchaCount } = await processAllUrls(urls);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Сохранение результатов
    const savedFile = await saveToCSV(results);

    console.log(chalk.cyan('\n' + '='.repeat(62)));
    console.log(chalk.green(`✅ Результаты сохранены в: ${savedFile}`));
    console.log(chalk.green(`✅ Успешно обработано:    ${successCount} URL`));
    if (captchaCount > 0) {
        console.log(chalk.magenta(`🔒 С капчей (пройдено):   ${captchaCount} URL`));
    }
    if (errorCount > 0) {
        console.log(chalk.yellow(`⚠️  Ошибок:               ${errorCount} URL`));
    }
    console.log(chalk.blue(`⏱️  Общее время:          ${totalTime}с`));
    console.log(chalk.gray(`   Средняя скорость:     ${(urls.length / totalTime).toFixed(2)} URL/сек`));
    console.log(chalk.cyan('='.repeat(62) + '\n'));

    rl.close();
}

// ============================================================
// ЗАПУСК
// ============================================================
main().catch(error => {
    console.error(chalk.red('\n❌ Критическая ошибка:'), error);
    rl.close();
    process.exit(1);
});
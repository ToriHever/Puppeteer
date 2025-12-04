import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter as csvWriter } from 'csv-writer';
import { spawn } from 'child_process';

// Открыть файл и ждать закрытия редактора
function openFileAndWait(filePath) {
    return new Promise(resolve => {
        const platform = process.platform;
        let command, args;

        if (platform === 'win32') {
            command = 'notepad.exe';
            args = [filePath];
        } else if (platform === 'darwin') {
            command = 'open';
            args = ['-W', filePath]; // ждет закрытия TextEdit
        } else {
            // xdg-open не ждёт, поэтому просто открываем и просим вручную продолжить
            spawn('xdg-open', [filePath]);
            console.log('Отредактируй файл и нажми Enter в консоли для продолжения...');
            process.stdin.once('data', () => resolve());
            return;
        }

        const editor = spawn(command, args, { stdio: 'inherit' });

        editor.on('close', () => {
            resolve();
        });
    });
}

// Чтение и обработка ссылок
function readUrls(filePath) {
    return fs.readFileSync(filePath, 'utf-8')
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0)
        .map(url => {
            if (!/^https?:\/\//i.test(url)) {
                return `https://${url}`;
            }
            return url;
        });
}

// Скрапинг мета-информации
async function scrapeMeta(url) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const meta = await page.evaluate(() => ({
            title: document.title || 'Нет title',
            description: document.querySelector('meta[name="description"]')?.content || 'Нет description'
        }));

        console.log(`Собрано: ${url}`);
        await browser.close();
        return { url, ...meta };
    } catch (error) {
        console.error(`Ошибка при обработке ${url}:`, error.message);
        await browser.close();
        return { url, title: 'Ошибка', description: 'Ошибка' };
    }
}

// Сохранение результатов в CSV
async function saveToCSV(data, filename) {
    const filePath = path.resolve(filename);
    const writer = csvWriter({
        path: filePath,
        header: [
            { id: 'url', title: 'URL' },
            { id: 'title', title: 'Title' },
            { id: 'description', title: 'Description' }
        ],
    });

    await writer.writeRecords(data);
    console.log(`Данные сохранены в ${filename}`);
}

// Главный блок
(async () => {
    const filePath = path.resolve('urls_meta.txt');

    console.log('Открываю файл для редактирования...');
    await openFileAndWait(filePath);

    const urls = readUrls(filePath);
    const results = [];

    for (const url of urls) {
        const data = await scrapeMeta(url);
        results.push(data);
    }

    await saveToCSV(results, 'meta_data.csv');
})();

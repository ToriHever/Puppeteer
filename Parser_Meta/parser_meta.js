import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter as csvWriter } from 'csv-writer';

// Читаем ссылки из файла
const urls = fs.readFileSync('urls_meta.txt', 'utf-8')
    .split('\n')
    .map(url => url.trim())
    .filter(url => url.length > 0);

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

(async () => {
    const results = [];
    for (const url of urls) {
        const data = await scrapeMeta(url);
        results.push(data);
    }
    await saveToCSV(results, 'meta_data.csv');
})();

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import { sendTelegramMessage } from '../Notifications_Telegram.js';
import path from 'path';

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const outputDir = 'Parser_domen/Results';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Папка "${outputDir}" создана.`);
}

const getUniqueFilename = (baseName) => {
    let counter = 1;
    let filename = `${outputDir}/${baseName}.csv`;
    while (fs.existsSync(filename)) {
        filename = `${outputDir}/${baseName}_${counter}.csv`;
        counter++;
    }
    return filename;
};

const scriptDir = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/?([A-Za-z]):/, '$1:'));
const domensPath = path.resolve(scriptDir, 'domens.txt');
const domains = fs.readFileSync(domensPath, 'utf-8')
    .split('\n')
    .map((d) => d.trim())
    .filter(Boolean);

if (!domains.length) {
    console.error('Файл domens.txt пуст');
    await sendTelegramMessage('Ошибка: Файл domens.txt пуст или не содержит доменов.');
    process.exit(1);
}

const saveToCsv = async (results, batchNumber) => {
    const filename = getUniqueFilename(`Партия_${batchNumber}`);
    const csvWriter = createCsvWriter({
        path: filename,
        header: [
            { id: 'domain', title: 'Домен' },
            { id: 'provider', title: 'Провайдер' },
            { id: 'organization', title: 'Организация' },
        ],
    });
    await csvWriter.writeRecords(results);
    console.log(`Результаты сохранены в: ${filename}`);
    await sendTelegramMessage(`Результаты сохранены: ${filename}`);
};

const appendToLog = (text) => {
    const logText = `[${new Date().toLocaleString()}] ${text}\n`;
    fs.appendFileSync(`${outputDir}/log.txt`, logText);
};

(async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    const checkHostURL = 'https://check-host.net/';
    const results = [];
    let batchNumber = 1;
    let domainCounter = 0;

    for (const domain of domains) {
        domainCounter++;
        const startTime = new Date();
        console.log(`\n#${domainCounter}: ${domain} (${startTime.toLocaleTimeString()})`);

        try {
            await page.goto(checkHostURL, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const inputSelector = 'input[name="host"]';
            await page.waitForSelector(inputSelector);

            // Очистка поля и ввод
            await page.click(inputSelector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type(inputSelector, domain);
            await page.keyboard.press('Enter');

            // Ожидаем либо ошибку, либо таблицу
            const tableSelector = 'div.flex-auto.w-full table tbody tr';
            const errorSelector = '.error';
            await page.waitForSelector(`${errorSelector}, ${tableSelector}`, { timeout: 30000 });

            const hasError = await page.$(errorSelector);
            if (hasError) {
                const msg = `Ошибка у домена "${domain}": Найден элемент ".error". Пропущен.`;
                console.warn(msg);
                appendToLog(msg);
                continue;
            }

            const data = await page.evaluate(() => {
                const rows = document.querySelectorAll('div.flex-auto.w-full table tbody tr');
                if (rows.length < 5) return null;

                const getText = (index) =>
                    rows[index]?.querySelector('td:last-child')?.innerText?.trim() || 'Не найдено';

                return {
                    provider: getText(3),
                    organization: getText(4),
                };
            });

            if (!data) {
                const msg = `Ошибка у домена "${domain}": недостаточно строк в таблице.`;
                console.warn(msg);
                appendToLog(msg);
                continue;
            }

            console.log(`Провайдер: ${data.provider}`);
            console.log(`Организация: ${data.organization}`);

            results.push({ domain, ...data });

        } catch (err) {
            const msg = `Ошибка при обработке домена "${domain}": ${err.message}`;
            console.error(msg);
            appendToLog(msg);
            await sendTelegramMessage(msg);
            await saveToCsv(results, batchNumber);
            await browser.close();
            process.exit(1);
        }

        if (domainCounter % 1000 === 0) {
            await saveToCsv(results, batchNumber);
            results.length = 0;
            batchNumber++;
        }
    }

    if (results.length > 0) {
        await saveToCsv(results, batchNumber);
    }

    await browser.close();
    console.log('Готово! Все результаты сохранены.');
    await sendTelegramMessage('Скрипт завершён. Все результаты сохранены.');
})();

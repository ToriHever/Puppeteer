import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import readline from 'readline';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';

puppeteer.use(StealthPlugin());

const COOKIES_PATH = './cookiesWordstat.json';
const TARGET_URL = 'https://cp.unisender.com/ru/v5/cdp/lists/1077';
const OUTPUT_CSV = './contacts.csv';
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Ждём enter
function waitForEnter(promptText = 'Нажмите Enter после авторизации...') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(promptText + '\n', () => {
        rl.close();
        resolve();
    }));
}

async function loadCookies(page) {
    try {
        const cookies = JSON.parse(await fs.readFile(COOKIES_PATH, 'utf8'));
        await page.setCookie(...cookies);
        console.log('✅ Куки загружены');
    } catch (err) {
        console.error('⚠️ Не удалось загрузить куки:', err.message);
    }
}

async function saveCookies(page) {
    const cookies = await page.cookies();
    await fs.writeFile(COOKIES_PATH, JSON.stringify(cookies, null, 2), 'utf8');
    console.log('💾 Куки сохранены');
}

function isOnTargetPage(url) {
    return url.startsWith(TARGET_URL);
}

async function extractTableData(page) {
    return await page.evaluate(() => {
        const table = document.querySelector('table');
        if (!table) return [];

        const rows = Array.from(table.querySelectorAll('tr'));
        return rows.map(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            return cells.map(cell => cell.innerText.trim());
        });
    });
}

async function saveToCsv(data, append = false) {
    if (!data.length) return;

    const headers = data[0].map((_, idx) => ({ id: `col${idx}`, title: `col${idx}` }));
    const records = data.slice(1).map(row => {
        const obj = {};
        row.forEach((val, idx) => {
            obj[`col${idx}`] = val;
        });
        return obj;
    });

    const csvWriter = createCsvWriter({
        path: OUTPUT_CSV,
        header: headers,
        append: append,
    });

    await csvWriter.writeRecords(records);
    console.log(`✅ Сохранено ${records.length} строк (${append ? 'добавлено' : 'перезапись'})`);
}

async function clickNextPage(page) {
    try {
        const selector = 'div._flex_1x067_1._justifyFlexStart_1x067_26._alignCenter_1x067_50._gap_1x067_90._xl_1x067_106._noWrap_1x067_114._row_1x067_6';
        const wrapper = await page.$(selector);

        if (!wrapper) {
            console.log('⚠️ Блок пагинации не найден');
            return false;
        }

        const divs = await wrapper.$$('div');
        if (divs.length < 2) {
            console.log('⚠️ Недостаточно элементов пагинации');
            return false;
        }

        const lastDiv = divs[divs.length - 1];
        const isDisabled = await lastDiv.evaluate(el =>
            el.hasAttribute('aria-disabled') ||
            el.className.includes('disabled') ||
            el.getAttribute('tabindex') === '-1'
        );

        if (isDisabled) {
            console.log('⏹ Последняя страница достигнута');
            return false;
        }

        await lastDiv.click();
        console.log('➡ Переход на следующую страницу...');
        await sleep(1500);
        return true;
    } catch (err) {
        console.log('⚠ Ошибка при переходе на следующую страницу:', err.message);
        return false;
    }
}

// Главная функция
(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
    });

    const page = await browser.newPage();

    await page.goto('https://cp.unisender.com', { waitUntil: 'domcontentloaded' });
    await loadCookies(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    if (!isOnTargetPage(page.url())) {
        console.log('⚠️ Вы не на целевой странице. Авторизуйтесь вручную.');
        await waitForEnter();
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        if (!isOnTargetPage(page.url())) {
            console.log('❌ Не удалось попасть на целевую страницу. Завершение.');
            await browser.close();
            return;
        }

        await saveCookies(page);
    }

    console.log('✅ На целевой странице. Начинаем парсинг...');

    let isFirstPage = true;

    while (true) {
        try {
            await page.waitForSelector('table', { timeout: 1500 });
        } catch (e) {
            console.log('⚠️ Таблица не появилась. Прерываем.');
            break;
        }

        const tableData = await extractTableData(page);
        if (!tableData.length) {
            console.log('⚠️ Нет данных на текущей странице');
            break;
        }

        await saveToCsv(tableData, !isFirstPage);
        isFirstPage = false;

        const hasNext = await clickNextPage(page);
        if (!hasNext) break;
    }

    console.log(`🧾 Парсинг завершён. Файл: ${OUTPUT_CSV}`);
    await browser.close();
})();

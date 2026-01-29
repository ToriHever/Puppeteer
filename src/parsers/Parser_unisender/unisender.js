import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';

puppeteer.use(StealthPlugin());

const BASE_PATH = './';
const COOKIES_PATH = path.join(BASE_PATH, 'cookiesWordstat.json');
const LOGIN_PATH = path.join(BASE_PATH, 'login.txt');
const OUTPUT_CSV = path.join(BASE_PATH, 'unisender_contacts.csv');

const sleep = ms => new Promise(res => setTimeout(res, ms));

let csvWriter;
let headers = [];

function createWriter(header, append = false) {
    csvWriter = createCsvWriter({
        path: OUTPUT_CSV,
        header: header.map(h => ({ id: h, title: h })),
        append: append
    });
}

async function waitForUserOnError(error) {
    console.error('❌ Ошибка:', error.message);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question('Нажми Enter для продолжения после устранения ошибки...', () => {
            rl.close();
            resolve();
        });
    });
}

async function loadCookies(page) {
    try {
        const cookies = JSON.parse(await fs.readFile(COOKIES_PATH, 'utf-8'));
        await page.setCookie(...cookies);
        console.log('✅ Cookies загружены');
    } catch (error) {
        await waitForUserOnError(error);
    }
}

async function tryLoginIfNeeded(page) {
    try {
        await sleep(1500);
        const loginButton = await page.$('.newAuth__loginBtn');
        if (loginButton) {
            console.log('🔐 Требуется авторизация. Загружаем логин и пароль...');
            const [email, password] = (await fs.readFile(LOGIN_PATH, 'utf-8'))
                .split('\n')
                .map(l => l.trim());

            await page.type('input[type="email"]', email, { delay: 50 });
            await page.type('input[type="password"]', password, { delay: 50 });

            console.log('➡ Вводим данные и нажимаем кнопку входа...');
            await loginButton.click();
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            console.log('✅ Успешно авторизовались');

            const newCookies = await page.cookies();
            await fs.writeFile(COOKIES_PATH, JSON.stringify(newCookies, null, 2));
            console.log('💾 Куки пересохранены');
        } else {
            console.log('✅ Авторизация не требуется');
        }
    } catch (error) {
        await waitForUserOnError(error);
    }
}

async function ensureCorrectPage(page) {
    const target = 'https://cp.unisender.com/ru/v5/cdp/contacts';
    const currentUrl = page.url();
    if (!currentUrl.startsWith(target)) {
        console.log('↩ Переход на страницу контактов вручную');
        await page.goto(target, { waitUntil: 'networkidle2' });
    }
}

async function parseTable(page, isFirstPage) {
    const tableData = await page.$eval('table._table_1jhh4_40', table => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
            const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
            return Object.fromEntries(headers.map((h, i) => [h, cells[i] || '']));
        });
        return { headers, rows };
    }).catch(() => ({ headers: [], rows: [] }));

    if (isFirstPage && tableData.headers.length) {
        headers = tableData.headers;
        createWriter(headers, false);
    }

    if (tableData.rows.length > 0) {
        await csvWriter.writeRecords(tableData.rows);
        console.log(`✅ Записано ${tableData.rows.length} строк`);
        return true;
    }
    return false;
}

async function clickNextPage(page) {
    try {
        const wrapper = await page.$('._pagination_s31x9_33');
        if (!wrapper) return false;

        const divs = await wrapper.$$('div');
        if (divs.length < 2) return false;

        const lastDiv = divs[divs.length - 1];
        await lastDiv.click();

        console.log('➡ Клик по последней кнопке пагинации, ждём обновления...');
        await sleep(1500);
        return true;
    } catch (error) {
        console.log('⚠ Не удалось перейти на следующую страницу:', error.message);
        return false;
    }
}


(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();
    await loadCookies(page);
    await page.goto('https://cp.unisender.com/ru/v5/cdp/contacts', { waitUntil: 'networkidle2' });
    await tryLoginIfNeeded(page);
    await ensureCorrectPage(page);

    try {
        let isFirstPage = true;

        while (true) {
            console.log(`📄 Обработка страницы`);
            const hasRows = await parseTable(page, isFirstPage);
            isFirstPage = false;

            if (!hasRows) break;
            const hasNext = await clickNextPage(page);
            if (!hasNext) break;
        }

        console.log('✅ Парсинг завершён');
    } catch (err) {
        await waitForUserOnError(err);
    } finally {
        console.log('🧾 CSV файл готов: unisender_contacts.csv');
        // await browser.close();
    }
})();

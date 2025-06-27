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
const OUTPUT_CSV = path.join(BASE_PATH, 'unisender_campaigns.csv');

const sleep = ms => new Promise(res => setTimeout(res, ms));

let csvWriter;

function createWriter(append = false) {
    csvWriter = createCsvWriter({
        path: OUTPUT_CSV,
        header: [
            { id: 'title', title: 'Название рассылки' },
            { id: 'time', title: 'Время' },
            { id: 'date', title: 'Дата' },
            { id: 'segment', title: 'Сегмент' },
            { id: 'metric1', title: 'Метрика 1' },
            { id: 'metric2', title: 'Метрика 2' },
            { id: 'metric3', title: 'Метрика 3' },
            { id: 'metric4', title: 'Метрика 4' }
        ],
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
    const target = 'https://cp.unisender.com/ru/v5/campaigns';
    const currentUrl = page.url();
    if (!currentUrl.startsWith(target)) {
        console.log('↩ Переход на страницу кампаний вручную');
        await page.goto(target, { waitUntil: 'networkidle2' });
    }
}

async function parsePage(page) {
    const results = await page.$$eval('.reportCard', cards => {
        return cards.map(card => {
            const badge = card.querySelector('.USBadge');
            if (badge?.textContent.includes('Отклонена')) return null;

            const title = card.querySelector('.reportCard__title')?.textContent.trim() || '';
            const timeBlock = card.querySelector('.reportCard__info .reportCard__time');
            const [time, date] = timeBlock?.textContent.split(',').map(t => t.trim()) || ['', ''];
            const segment = card.querySelector('.reportCard__info .reportCard__list')?.textContent.trim() || '';

            const metricBlocks = card.querySelectorAll('.reportCard__footer .reportAnalyticsItem__valueAbsolute');
            const metrics = Array.from(metricBlocks).map(el => el.textContent.trim());

            return {
                title,
                time,
                date,
                segment,
                metric1: metrics[0] || '',
                metric2: metrics[1] || '',
                metric3: metrics[2] || '',
                metric4: metrics[3] || ''
            };
        }).filter(Boolean);
    });

    console.log(`✅ Найдено ${results.length} карточек на странице`);
    await csvWriter.writeRecords(results);
    return results.length > 0;
}

async function clickNextPage(page) {
    try {
        const wrapper = await page.$('.reportList__paginationWrapper');
        if (!wrapper) return false;

        const ul = await wrapper.$('.MuiPagination-ul');
        if (!ul) return false;

        const items = await ul.$$('li');
        if (items.length < 2) return false;

        const lastLi = items[items.length - 1];
        await lastLi.click();

        console.log('➡ Клик по последнему элементу пагинации, ждём обновления...');
        await sleep(7000); // Ждём 7 секунд

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
    await loadCookies(page); // 🟢 Загружаем куки
    await page.goto('https://cp.unisender.com/ru/v5/campaigns', { waitUntil: 'networkidle2' }); // 🟢 Сразу переходим
    await tryLoginIfNeeded(page); // 🟠 Если надо — логинимся
    await ensureCorrectPage(page); // 🟡 Убеждаемся, что мы там, где нужно

    try {
        let isFirstPage = true;

        while (true) {
            console.log(`📄 Обработка страницы`);
            createWriter(!isFirstPage);
            isFirstPage = false;

            const hasCards = await parsePage(page);
            if (!hasCards) break;

            const hasNext = await clickNextPage(page);
            if (!hasNext) break;

            await sleep(1500);
        }

        console.log('✅ Парсинг завершён');
    } catch (err) {
        await waitForUserOnError(err);
    } finally {
        console.log('🧾 CSV файл готов: unisender_campaigns.csv');
        // await browser.close();
    }
})();

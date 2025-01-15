import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import { sendTelegramMessage } from '../Notifications_Telegram.js'; // Импортируем функцию
import path from 'path';

// Подключаем плагин "Stealth" для Puppeteer
puppeteer.use(StealthPlugin());

// Константа для базового пути
const BASE_PATH = 'C:/Users/DDGWindows/Desktop/Puppeteer/Parser_request'; 

// Настройки
const LOGIN = 'viparsing@yandex.ru'; // Замените на ваш логин
const PASSWORD = 'otbotov2345'; // Замените на ваш пароль
const COOKIES_PATH = path.join(BASE_PATH, 'cookiesWordstat.json');
const REQUESTS_FILE = path.join(BASE_PATH, 'requests.txt');
const OUTPUT_DIR = path.join(BASE_PATH, 'Results');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'results.csv');
const BROWSER_WIDTH = 1035;
const BROWSER_HEIGHT = 520;

// Функция для генерации запросов с операторами (кавычки и восклицательные знаки)
function generateRequestsWithOperators(queries) {
    const updatedQueries = [];

    queries.forEach((query) => {
        const trimmedQuery = query.trim(); // Убираем лишние пробелы

        if (trimmedQuery) {
            // Оригинальный запрос
            updatedQueries.push({
                type: 'original',
                query: trimmedQuery
            });

            // Запрос в кавычках
            updatedQueries.push({
                type: 'withQuotes',
                query: `"${trimmedQuery}"`
            });

            // Запрос с восклицательными знаками
            const exclamationQuery = trimmedQuery
                .split(' ')
                .map((word) => `!${word}`)
                .join(' ');
            updatedQueries.push({
                type: 'withExclamation',
                query: `"${exclamationQuery}"`
            });
        }
    });

    return updatedQueries;
}

// Загружаем список запросов и добавляем операторы
let queries = fs.readFileSync(REQUESTS_FILE, 'utf-8').split('\n').filter(Boolean);
const updatedQueries = generateRequestsWithOperators(queries);

const csvWriter = createCsvWriter({
    path: OUTPUT_FILE,
    header: [
        {
            id: 'query',
            title: 'Запрос'
        },
        {
            id: 'type',
            title: 'Тип'
        },
        {
            id: 'frequency',
            title: 'Частота'
        }
    ]
});

// Функция для копирования текста в буфер обмена через Puppeteer
async function copyToClipboard(page, text) {
    await page.evaluate((text) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }, text);
}

// Функция для вставки текста из буфера обмена с помощью комбинации клавиш Ctrl+V
async function pasteFromClipboard(page) {
    const inputSelector = '.textinput__control';

    // Наводим на поле ввода и кликаем, чтобы оно стало активным
    await page.click(inputSelector);

    // Вставляем текст через Ctrl + V
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Control');
}

// Задержка с случайным интервалом
function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Функция для задержки
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Используем объект для хранения частоты запросов
let results = {};

// Массив для записи в CSV
const csvData = [];


// Основной процесс
(async () => {
    try {
        // Проверяем наличие папки для результатов
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, {
                recursive: true
            });
        }

        // Открываем браузер
        const browser = await puppeteer.launch({
            headless: false,
            defaultViewport: {
                width: BROWSER_WIDTH,
                height: BROWSER_HEIGHT
            },
        });

        const page = await browser.newPage();

        // Если файл cookies существует, загружаем их
        if (fs.existsSync(COOKIES_PATH)) {
            const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
            await page.setCookie(...cookies);
            console.log('Куки загружены, авторизация выполнена');
            await sendTelegramMessage('Куки загружены, авторизация выполнена');
        } else {
            console.log('Куки не найдены, выполняем авторизацию');
            await page.goto('https://passport.yandex.ru/auth');
            await page.waitForSelector('input[name="login"]');
            await page.type('input[name="login"]', LOGIN, { delay: 100 });
            await page.click('#passp\\:sign-in');
            await page.waitForSelector('input[name="password"]');
            await page.type('input[name="password"]', PASSWORD, { delay: 100 });
            await page.click('#passp\\:sign-in');
            await page.waitForNavigation();

            const cookies = await page.cookies();
            fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies));
            console.log('Куки сохранены для повторного использования в:', COOKIES_PATH);
            await sendTelegramMessage(`Куки сохранены для повторного использования в: ${COOKIES_PATH}`);
        }

        // Переходим на Wordstat
        await page.goto('https://wordstat.yandex.ru/');
        await page.waitForSelector('.textinput__control');

        // Рабочий цикл для обработки запросов
        for (const { type, query } of updatedQueries) {
            const baseQuery = query.replace(/["!]/g, '').trim();

            if (!results[baseQuery]) {
                results[baseQuery] = {
                    original: '',
                    withQuotes: '',
                    withExclamation: '',
                };
            }

            await page.click('.textinput__control', { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await delay(getRandomDelay(1000, 3000));
            await copyToClipboard(page, query);
            await pasteFromClipboard(page);
            await delay(getRandomDelay(1000, 3000));
            await page.keyboard.press('Enter');
            await delay(getRandomDelay(2000, 5000));

            const frequency = await page.evaluate(() => {
                const element = document.querySelector('.wordstat__content-preview-text_last');
                if (!element) return '0';
                const text = element.textContent || '';
                return text.split(':')[1]?.trim() || '0';
            });

            if (type === 'original') {
                results[baseQuery].original = frequency;
            } else if (type === 'withQuotes') {
                results[baseQuery].withQuotes = frequency;
            } else if (type === 'withExclamation') {
                results[baseQuery].withExclamation = frequency;
            }

            console.log(`Обработан запрос: "${baseQuery}" | Оригинал: ${results[baseQuery].original} | Кавычки: ${results[baseQuery].withQuotes} | Восклицания: ${results[baseQuery].withExclamation}`);

        }

        /// Подготовка данных для записи в CSV
        for (const query in results) {
            const { original, withQuotes, withExclamation } = results[query];
            csvData.push({
             query: query,
                frequency: results[query].original || '0',
                frequencyWithQuotes: results[query].withQuotes || '0',
                frequencyWithExclamation: results[query].withExclamation || '0',
            });
        }

        // Создаем CSV-записыватель с нужными заголовками
        const csvWriter = createCsvWriter({
            path: OUTPUT_FILE,
            header: [
                { id: 'query', title: 'Запрос' },
                { id: 'frequency', title: 'Частота' },
                { id: 'frequencyWithQuotes', title: 'Частота с кавычками' },
                { id: 'frequencyWithExclamation', title: 'Частота с кавычками и восклицательными знаками' }
            ]
        });

        // Записываем результаты в CSV
        await csvWriter.writeRecords(csvData);
        console.log('Парсинг завершен. /nРезультаты сохранены в:', OUTPUT_FILE);
        await sendTelegramMessage(`Парсинг запросов завершен. /nРезультаты сохранены в ${OUTPUT_FILE}`);

        await browser.close();

    } catch (error) {
        console.error('Произошла ошибка:', error.message);

        // Сохранение частичных данных
        console.log('Сохраняем частичные результаты...');
        if (Object.keys(results).length > 0) {
    // Подготовка частичных данных для записи
    const partialCsvData = [];
    for (const query in results) {
        const { original, withQuotes, withExclamation } = results[query];
        partialCsvData.push({
            query: query,
            frequency: original || '0',
            frequencyWithQuotes: withQuotes || '0',
            frequencyWithExclamation: withExclamation || '0',
        });
    }

    // Создаем CSV-записыватель с той же структурой заголовков
    const partialCsvWriter = createCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'query', title: 'Запрос' },
            { id: 'frequency', title: 'Частота' },
            { id: 'frequencyWithQuotes', title: 'Частота с кавычками' },
            { id: 'frequencyWithExclamation', title: 'Частота с кавычками и восклицательными знаками' },
        ],
    });

    // Записываем данные в CSV
    await partialCsvWriter.writeRecords(partialCsvData);
    console.log('Частичные результаты сохранены в:', OUTPUT_FILE);
    await browser.close();
} else {
            console.log('Нет данных для сохранения.');
        }

        // Отправляем уведомление о проблеме
        await sendTelegramMessage(`Ошибка: ${error.message}. /n*Частичные результаты сохранены.*`);
    }
})(); // Завершающая скобка

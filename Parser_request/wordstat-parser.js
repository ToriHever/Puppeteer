const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Настройки
const LOGIN = 'viparsing@yandex.ru'; // Замените на ваш логин
const PASSWORD = 'otbotov2345'; // Замените на ваш пароль
const COOKIES_PATH = path.join(__dirname, 'cookiesWordstat.json'); // Сохраняем куки в ту же директорию
const REQUESTS_FILE = 'Parser_request/requests.txt';
const OUTPUT_DIR = 'Parser_request/Результат парсинга запросов';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'results.csv');
const BROWSER_WIDTH = 1035;
const BROWSER_HEIGHT = 520;

// Функция для ожидания подтверждения пользователя
async function waitForUserConfirmation(message) {
    console.log(message); // Сообщение для пользователя
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    await new Promise(resolve => rl.question('', () => {
        rl.close();
        resolve();
    }));
}

// Функция для генерации случайного числа в диапазоне от min до max
function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Функция для добавления задержки
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Функция для ввода текста с кавычками и восклицательными знаками
async function typeWithSpecialChars(page, text, useQuotes = true) {
    if (useQuotes) {
        await page.keyboard.type('"', { delay: getRandomDelay(50, 150) });
    }

    // Вводим каждое слово с восклицательным знаком
    const words = text.split(' ');
    for (let i = 0; i < words.length; i++) {
        await page.keyboard.type(`!${words[i]}`, { delay: getRandomDelay(50, 150) });
        if (i < words.length - 1) {
            // Добавляем пробел между словами
            await page.keyboard.type(' ', { delay: getRandomDelay(50, 150) });
        }
    }

    if (useQuotes) {
        await page.keyboard.type('"', { delay: getRandomDelay(50, 150) });
    }
}

// Функция для очистки поля ввода
async function clearInputField(page, inputSelector) {
    await page.click(inputSelector, { clickCount: 3 }); // Выделить все
    await page.keyboard.press('Backspace'); // Удалить
}

(async () => {
    // Проверяем наличие папки для результатов
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Загружаем список запросов
    const queries = fs.readFileSync(REQUESTS_FILE, 'utf-8').split('\n').filter(Boolean);

    // Открываем браузер
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: BROWSER_WIDTH, height: BROWSER_HEIGHT },
    });

    const page = await browser.newPage();
    
    // Если файл cookies существует, загрузим cookies для авторизации
    if (fs.existsSync(COOKIES_PATH)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
        await page.setCookie(...cookies);
        console.log('Куки загружены, авторизация выполнена');
        // После успешной авторизации переходим на Wordstat
        await page.goto('https://wordstat.yandex.ru/');
        await page.waitForSelector('.textinput__control', { timeout: 60000 });
    } else {
        console.log('Куки не найдены, выполняем авторизацию');
       
        // Переходим на страницу авторизации
        await page.goto('https://passport.yandex.ru/auth');
        await page.waitForSelector('input[name="login"]', { timeout: 60000 });

        // Вводим логин
        await page.type('input[name="login"]', LOGIN, { delay: 100 });
        await page.click('#passp\\:sign-in');
        await waitForUserConfirmation('Подтвердите личность (капча или код), затем нажмите Enter в консоли.');

        // Сохраняем куки для последующего использования
        const cookies = await page.cookies();
        fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies));
        console.log('Куки сохранены для повторного использования в:', COOKIES_PATH);
       
        // После успешной авторизации переходим на Wordstat
        await page.goto('https://wordstat.yandex.ru/');
        await page.waitForSelector('.textinput__control', { timeout: 60000 });
    }

    // Открываем файл для записи результатов
    const resultsStream = fs.createWriteStream(OUTPUT_FILE);
    resultsStream.write('Запрос,Частота,"Ч","!Ч"\n');

    for (const query of queries) {
        const variations = [
            query,  // Оригинальный запрос
            query,  // Запрос в кавычках
            query,  // Запрос с восклицательными знаками
        ];

        const rowData = [query];

        for (let i = 0; i < variations.length; i++) {
            // Наводим мышь на поле ввода
            await page.mouse.move(142, 162, { steps: 10 });
            
            // Очистка поля ввода
            const inputSelector = '.textinput__control';
            await clearInputField(page, inputSelector);
            await delay(getRandomDelay(1000, 3000)); 

            // Вводим запрос с вариацией
            const useQuotes = i === 1; // Используем кавычки для второй вариации
            const useExclamation = i === 2; // Используем восклицательные знаки для третьей вариации

            // Вводим запрос с восклицательными знаками и кавычками
            if (useExclamation || useQuotes) {
                await typeWithSpecialChars(page, variations[i], useQuotes);
            } else {
                await page.keyboard.type(variations[i], { delay: getRandomDelay(50, 150) });
            }

            await page.keyboard.press('Enter');
            await delay(getRandomDelay(2000, 5000));

            // Извлекаем результаты
            const result = await page.evaluate(() => {
                const element = document.querySelector('.wordstat__content-preview-text_last');
                if (!element) return null;
                const text = element.textContent || '';
                return text.split(':')[1]?.trim() || null;
            });

            rowData.push(result || 'Нет данных');
        }

        // Записываем результат в CSV
        resultsStream.write(rowData.join(',') + '\n');
        console.log(`Запрос "${query.trim().replace(/\s+/g, ' ')}" обработан.`);
    }

    console.log('Парсинг завершен. Результаты сохранены в:', OUTPUT_FILE);
    // Закрываем браузер
    await browser.close();
})();

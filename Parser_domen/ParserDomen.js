import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import readline from 'readline';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import { sendTelegramMessage } from '../Notifications_Telegram.js'; // Импортируем функцию

// Подключаем плагин "Stealth" для Puppeteer
puppeteer.use(StealthPlugin());

// Функция для задержки
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Папка для сохранения результатов
const outputDir = 'Parser_domen/Results';

// Создаем папку, если она не существует
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Папка "${outputDir}" создана.`);
}

// Функция для проверки и создания уникального имени файла
const getUniqueFilename = (baseName) => {
    let counter = 1;
    let filename = `${outputDir}/${baseName}.csv`;

    while (fs.existsSync(filename)) {
        filename = `${outputDir}/${baseName}_${counter}.csv`;
        counter++;
    }

    return filename;
};

// Чтение списка доменов из файла domens.txt
const domains = fs.readFileSync('Parser_domen/domens.txt', 'utf-8')
    .split('\n')
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);

if (!domains.length) {
    console.error('Ошибка: Файл domens.txt пуст или не содержит доменов.');
    await sendTelegramMessage(`Ошибка: Файл domens.txt пуст или не содержит доменов. Скрипт завершил работу.`);
    process.exit(1); // Завершаем скрипт
}

// Функция для сохранения результатов в CSV
const saveToCsv = async (results, batchNumber) => {
    const uniqueFilename = getUniqueFilename(`Партия_${batchNumber}`);

    const csvWriter = createCsvWriter({
        path: uniqueFilename,
        header: [
            { id: 'domain', title: 'Домен' },
            { id: 'provider', title: 'Провайдер' },
            { id: 'organization', title: 'Организация' },
        ],
    });

    await csvWriter.writeRecords(results);
    console.log(`Результаты сохранены в файл: ${uniqueFilename}`);
    await sendTelegramMessage(`Результаты сохранены: ${uniqueFilename}`);
};

(async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    const checkHostURL = 'https://check-host.net/';
    const results = [];
    let batchNumber = 1;
    let domainCounter = 0;
    let lastProcessedDomain = null;

    for (const domain of domains) {
        domainCounter++;
        lastProcessedDomain = domain;
        const startTime = new Date();
        console.log(`Проверяем домен #${domainCounter}: ${domain}`);
        console.log(`Начало проверки: ${startTime.toLocaleString()}`);

        try {
            await page.goto(checkHostURL, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const inputSelector = 'input[name="host"]';
            await page.waitForSelector(inputSelector);

            // Очистка поля ввода
            await page.focus(inputSelector);
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');

            // Ввод домена
            await page.type(inputSelector, domain);
            await page.keyboard.press('Enter');

            // Проверка наличия таблицы или ошибки
            try {
                const errorSelector = '.error';
                const tableSelector = 'div.flex-auto.w-full table tbody tr';

                // Ждем появления таблицы или ошибки (что наступит первым)
                await page.waitForSelector(`${errorSelector}, ${tableSelector}`, {
                    timeout: 30000
                });

                const hasErrorClass = await page.evaluate(() => {
                    return !!document.querySelector('.error');
                });

                if (hasErrorClass) {
                    const errorMsg = `Ошибка: Для домена "${domain}" обнаружен элемент с классом "error". Пропускаем.`;
                    console.error(errorMsg);
                    continue;
                }

                // Если таблица не найдена, то ошибка
                const hasTable = await page.evaluate(() => {
                    return !!document.querySelector('div.flex-auto.w-full table tbody tr');
                });

                if (!hasTable) {
                    const errorMsg = `Ошибка: Таблица для домена "${domain}" не найдена.`;
                    console.error(errorMsg);
                    continue;
                }
            } catch (error) {
                const errorMsg = `Ошибка при проверке наличия таблицы или ошибки для домена "${domain}": ${error.message}`;
                console.error(errorMsg);
                continue;
            }

            // Извлечение данных
            const providerAndOrganization = await page.evaluate(() => {
                const rows = document.querySelectorAll('div.flex-auto.w-full table tbody tr');
                let provider = 'Не найдено';
                let organization = 'Не найдено';

                if (rows[3]) {
                    provider = rows[3].querySelector('td:last-child')?.innerText || 'Не найдено';
                }
                if (rows[4]) {
                    organization = rows[4].querySelector('td:last-child')?.innerText || 'Не найдено';
                }

                return { provider, organization };
            });

            console.log(`Провайдер: ${providerAndOrganization.provider}`);
            console.log(`Организация: ${providerAndOrganization.organization}`);

            results.push({
                domain,
                provider: providerAndOrganization.provider,
                organization: providerAndOrganization.organization,
            });

        } catch (error) {
            const errorMsg = `Неизвестная ошибка при обработке домена ${domain}: ${error?.message || 'Без сообщения об ошибке'}`;
            console.error(errorMsg);
            await sendTelegramMessage(errorMsg);

            // Сохраняем результаты перед завершением работы
            await saveToCsv(results, batchNumber);
            console.log(`Скрипт завершён из-за неизвестной ошибки: ${error.message}. Все результаты сохранены.`);
            await sendTelegramMessage(`Скрипт завершён из-за неизвестной ошибки: ${error.message}. Все результаты сохранены. Последний обработанный домен ${lastProcessedDomain}`);

            await browser.close();
            process.exit(1); // Завершаем скрипт
        }

        // Сохраняем результаты каждые 1000 доменов
        if (domainCounter % 1000 === 0) {
            await saveToCsv(results, batchNumber);
            batchNumber++;
            results.length = 0; // Очищаем массив для следующего набора
        }
    }

    // Сохраняем оставшиеся результаты, если есть
    if (results.length > 0) {
        await saveToCsv(results, batchNumber);
    }

    await browser.close();
    console.log('Скрипт завершён. Все результаты сохранены.');
    await sendTelegramMessage('Скрипт завершён. Все результаты сохранены.');
})();


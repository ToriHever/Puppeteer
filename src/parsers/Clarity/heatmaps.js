import puppeteer from 'puppeteer';
import fs from 'fs';
import {
    fileURLToPath
} from 'url';
import {
    dirname,
    resolve
} from 'path';
import readline from 'readline';
import {
    createObjectCsvWriter
} from 'csv-writer';

// ESM-аналоги __dirname
const __filename = fileURLToPath(
    import.meta.url);
const __dirname = dirname(__filename);

const COOKIES_PATH = resolve(__dirname, 'clarity.microsoft.com.cookies.json');
const URLS_PATH = resolve(__dirname, 'urls.txt');
const OUTPUT_PATH = resolve(__dirname, 'Clarity.csv');

// Универсальная функция задержки
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log('— Запускаем браузер…');
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });
    const page = await browser.newPage();

    // 1) Загрузка куки
    if (fs.existsSync(COOKIES_PATH)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
            await page.setCookie(...cookies);
            console.log('✔ Cookies загружены');
        } catch (e) {
            console.error('❌ Ошибка чтения cookies:', e);
        }
    } else {
        console.warn('⚠ Файл cookies не найден, потребуется ручной логин');
    }

    // CSV writer: новые колонки для каждого набора
    const csvWriter = createObjectCsvWriter({
        path: OUTPUT_PATH,
        header: [
            {
                id: 'url',
                title: 'URL'
            },
            {
                id: 'pctScroll',
                title: '% прокрутки'
            },
            {
                id: 'visitors',
                title: '# посетителей'
            },
            {
                id: 'pctLeave',
                title: '% уходит'
            }
    ],
        append: fs.existsSync(OUTPUT_PATH)
    });

    // Читаем URLs.txt
    const rl = readline.createInterface({
        input: fs.createReadStream(URLS_PATH),
        crlfDelay: Infinity
    });

    // Функция обработки каждого URL
    async function processUrl(url) {
        url = url.trim();
        if (!url) return;
        console.log(`\n→ Обрабатываем: ${url}`);
        try {
            // 2) Навигация
            await page.goto(
                'https://clarity.microsoft.com/projects/view/fumb9hruw3/heatmaps?date=Last%20180%20days', {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                }
            );
            console.log('  ✔ Heatmaps открыт');

            // 4–6) Поиск URL
            await page.waitForSelector('#SuggestionSearchBoxheatmaps0zero', {
                timeout: 10000
            });
            await page.click('#SuggestionSearchBoxheatmaps0zero');
            await page.type('#SuggestionSearchBoxheatmaps0zero', url, {
                delay: 50
            });
            console.log('  ✔ Ввели URL');
            await (page.waitFor ? page.waitFor(2000) : sleep(2000));

            // 7) Просмотреть тепловую карту
            let ok;
            for (let i = 0; i < 10; i++) {
                ok = await page.evaluate(() => {
                    const b = [...document.querySelectorAll('button')]
                        .find(el => el.textContent.trim() === 'Просмотреть тепловую карту');
                    if (b) {
                        b.click();
                        return true;
                    }
                    return false;
                });
                if (ok) break;
                await sleep(500);
            }
            if (!ok) throw new Error('Кнопка Просмотреть тепловую карту не найдена');
            await (page.waitFor ? page.waitFor(1000) : sleep(1000));

            // 8) Прокрутка
            for (let i = 0; i < 10; i++) {
                ok = await page.evaluate(() => {
                    const b = [...document.querySelectorAll('button')]
                        .find(el => el.textContent.includes('Прокрутка'));
                    if (b) {
                        b.click();
                        return true;
                    }
                    return false;
                });
                if (ok) break;
                await sleep(500);
            }
            if (!ok) throw new Error('Кнопка Прокрутка не найдена');
            await (page.waitFor ? page.waitFor(2000) : sleep(2000));
            // 8.1) Ждём, пока появится контейнер с результатами
            await page.waitForSelector(
  'div.heatmaps_webHeatmapSidebarContent__ISC4J > *',
  { timeout: 15000 }
);
console.log('  ✔ Первый элемент результатов появился');


            // 9) Сбор и парсинг данных
            const csvRecords = await page.evaluate(() => {
                const wrapper = document.querySelector('div.heatmaps_webHeatmapSidebarContent__ISC4J');
                if (!wrapper) return [];
                // Текст через innerText, убираем заголовок
                let text = wrapper.innerText.trim();
                // Удаляем первую строку-заголовок
                const lines = text.split(/\r?\n+/).slice(1);
                const values = lines.join(',').split(',');
                const records = [];
                for (let i = 0; i + 2 < values.length; i += 3) {
                    records.push({
                        pctScroll: values[i].trim(),
                        visitors: values[i + 1].trim(),
                        pctLeave: values[i + 2].trim()
                    });
                }
                return records;
            });
            console.log(`  ✔ Parsed ${csvRecords.length} rows`);

            // 10) Запись в CSV
            const recordsToWrite = csvRecords.map(rec => ({
                url,
                ...rec
            }));
            await csvWriter.writeRecords(recordsToWrite);
            console.log(`  ✔ Записано ${recordsToWrite.length} строк в CSV`);
            ('  ✔ Все записи сохранены');

        } catch (err) {
            console.error(`  ❌ Ошибка при обработке ${url}:`, err);
        }
    }

    // Обработка URL
    for await (const line of rl) {
        await processUrl(line);
    }
    console.log('\nВсе URL обработаны. Браузер остаётся открытым.');
})();

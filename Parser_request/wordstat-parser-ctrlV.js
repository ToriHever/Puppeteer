import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import { sendTelegramMessage } from '../Notifications_Telegram.js';
import path from 'path';
import os from 'os';

// Подключаем плагин "Stealth"
puppeteer.use(StealthPlugin());

// Пути и настройки
const USERNAME = os.userInfo().username;
const BASE_PATH = path.join('C:/Users', USERNAME, 'Desktop/Puppeteer/Parser_request');
const LOGIN = 'viparsing@yandex.ru';
const PASSWORD = 'otbotov2345';
const COOKIES_PATH = path.join(BASE_PATH, 'cookiesWordstat.json');
const REQUESTS_FILE = path.join(BASE_PATH, 'requests.txt');
const OUTPUT_DIR = path.join(BASE_PATH, 'Results');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'results.csv');
const BROWSER_WIDTH = 1035;
const BROWSER_HEIGHT = 520;

// Генерация запросов с операторами
function generateRequestsWithOperators(queries) {
  const updated = [];
  queries.forEach(q => {
    const t = q.trim();
    if (!t) return;
    updated.push({ type: 'original', query: t });
    updated.push({ type: 'withQuotes', query: `"${t}"` });
    const excl = t.split(' ').map(w => `!${w}`).join(' ');
    updated.push({ type: 'withExclamation', query: `"${excl}"` });
  });
  return updated;
}

// Clipboard helpers
async function copyToClipboard(page, text) {
  await page.evaluate(txt => {
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }, text);
}
async function pasteFromClipboard(page) {
  const sel = '.textinput__control';
  await page.click(sel);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyV');
  await page.keyboard.up('Control');
}
function getRandomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let browser;
  const results = {};
  const csvData = [];

  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    browser = await puppeteer.launch({ headless: false, defaultViewport: { width: BROWSER_WIDTH, height: BROWSER_HEIGHT }});
    const page = await browser.newPage();

    // Авторизация / загрузка куки
    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
      await page.setCookie(...cookies);
    } else {
      await page.goto('https://passport.yandex.ru/auth');
      await page.waitForSelector('input[name="login"]');
      await page.type('input[name="login"]', LOGIN, { delay: 100 });
      await page.click('#passp\\:sign-in');
      await page.waitForSelector('input[name="password"]');
      await page.type('input[name="password"]', PASSWORD, { delay: 100 });
      await page.click('#passp\\:sign-in');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      fs.writeFileSync(COOKIES_PATH, JSON.stringify(await page.cookies()));
    }

    await page.goto('https://wordstat.yandex.ru/');
    await page.waitForSelector('.textinput__control');

    const lines = fs.readFileSync(REQUESTS_FILE, 'utf-8').split('\n').filter(Boolean);
    const updatedQueries = generateRequestsWithOperators(lines);

    for (const { type, query } of updatedQueries) {
      const key = query.replace(/['"!]/g, '').trim();
      if (!results[key]) results[key] = { original: '', withQuotes: '', withExclamation: '' };

      let processed = false;
      while (!processed) {
        try {
          // ввод
          await page.click('.textinput__control', { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await delay(getRandomDelay(1000, 3000));
          await copyToClipboard(page, query);
          await pasteFromClipboard(page);
          // Enter + ожидание навигации
          await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {})
          ]);
          await delay(getRandomDelay(1000, 3000));

          // сбор
          const freq = await page.evaluate(() => {
            const el = document.querySelector('.wordstat__content-preview-text_last');
            if (!el) return '0';
            return el.textContent.split(':')[1]?.trim() || '0';
          });
          results[key][
            type === 'original' ? 'original' : type === 'withQuotes' ? 'withQuotes' : 'withExclamation'
          ] = freq;

          console.log(`Processed: ${key} | orig:${results[key].original} | q:${results[key].withQuotes} | !:${results[key].withExclamation}`);
          processed = true;
        } catch (err) {
          const msg = err.message || '';
          if (msg.includes('.textinput__control') || msg.includes('Execution context was destroyed')) {
            console.log(`Caught error: "${msg}". Нажмите любую клавишу для продолжения...`);
            await new Promise(r => {
              process.stdin.resume();
              process.stdin.once('data', () => { process.stdin.pause(); r(); });
            });
            // пересохранение куки после сбоя
            fs.writeFileSync(COOKIES_PATH, JSON.stringify(await page.cookies()));
            console.log('Куки пересохранены:', COOKIES_PATH);
          } else {
            throw err;
          }
        }
      }
    }

    // запись CSV
    for (const q in results) {
      csvData.push({ query: q, frequency: results[q].original, frequencyWithQuotes: results[q].withQuotes, frequencyWithExclamation: results[q].withExclamation });
    }
    const writer = createCsvWriter({ path: OUTPUT_FILE, header: [
      { id: 'query', title: 'Запрос' },
      { id: 'frequency', title: 'Частота' },
      { id: 'frequencyWithQuotes', title: 'Частота с кавычками' },
      { id: 'frequencyWithExclamation', title: 'Частота с кавычками и восклицаниями' }
    ]});
    await writer.writeRecords(csvData);
    console.log('Results saved:', OUTPUT_FILE);
    await sendTelegramMessage(`Парсинг завершён. Файл: ${OUTPUT_FILE}`);

    await browser.close();
  } catch (e) {
    console.error('Fatal error:', e.message);
    // partial save
    if (Object.keys(results).length) {
      const partial = Object.entries(results).map(([q, r]) => ({ query: q, frequency: r.original, frequencyWithQuotes: r.withQuotes, frequencyWithExclamation: r.withExclamation }));
      await createCsvWriter({ path: OUTPUT_FILE, header: [
        { id: 'query', title: 'Запрос' },
        { id: 'frequency', title: 'Частота' },
        { id: 'frequencyWithQuotes', title: 'Частота с кавычками' },
        { id: 'frequencyWithExclamation', title: 'Частота с кавычками и восклицаниями' }
      ]}).writeRecords(partial);
      console.log('Partial results saved to:', OUTPUT_FILE);
      await sendTelegramMessage(`Error: ${e.message}. Partial saved: ${OUTPUT_FILE}`);
    }
    if (browser) await browser.close();
  }
})();

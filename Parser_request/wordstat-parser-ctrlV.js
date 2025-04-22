import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import readline from 'readline';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import { sendTelegramMessage } from '../Notifications_Telegram.js';
import path from 'path';
import os from 'os';

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

// Утилиты
function generateRequestsWithOperators(queries) {
  const updated = [];
  queries.forEach(q => {
    const t = q.trim(); if (!t) return;
    updated.push({ type: 'original', query: t });
    updated.push({ type: 'withQuotes', query: `"${t}"` });
    const excl = t.split(' ').map(w => `!${w}`).join(' ');
    updated.push({ type: 'withExclamation', query: `"${excl}"` });
  });
  return updated;
}
async function copyToClipboard(page, text) {
  await page.evaluate(txt => {
    const ta = document.createElement('textarea'); ta.value = txt;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  }, text);
}
async function pasteFromClipboard(page) {
  const sel = '.textinput__control';
  await page.click(sel);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyV'); await page.keyboard.up('Control');
}
function getRandomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function promptCommand(rl) { return new Promise(res => rl.question('> ', ans => res(ans.trim()))); }

(async () => {
  let browser;
  let results = {};
  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    browser = await puppeteer.launch({ headless: false, defaultViewport: { width: BROWSER_WIDTH, height: BROWSER_HEIGHT } });
    const page = await browser.newPage();

    // Попытка загрузить куки
    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
      await page.setCookie(...cookies);
      console.log('Куки загружены из файла.');
    }

    console.log('Доступные команды: login, save-cookie, run');
    while (true) {
      const cmd = await promptCommand(rl);
      if (cmd === 'login') {
        console.log('Выполняется вход...');
        await page.goto('https://passport.yandex.ru/auth');
        await page.waitForSelector('input[name="login"]', { timeout: 60000 });
        await page.type('input[name="login"]', LOGIN, { delay: 100 });
        await page.click('#passp\\:sign-in');
        await page.waitForSelector('input[name="password"]', { timeout: 60000 });
        await page.type('input[name="password"]', PASSWORD, { delay: 100 });
        await page.click('#passp\\:sign-in');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        const newCookies = await page.cookies();
        fs.writeFileSync(COOKIES_PATH, JSON.stringify(newCookies));
        console.log('Вход выполнен, куки сохранены.');
      } else if (cmd === 'save-cookie') {
        const currentCookies = await page.cookies();
        fs.writeFileSync(COOKIES_PATH, JSON.stringify(currentCookies));
        console.log('Куки сохранены вручную.');
      } else if (cmd === 'run') {
        const url = page.url();
        if (url.includes('wordstat.yandex.ru')) {
          console.log('Запуск парсинга...'); break;
        } else {
          console.log(`Вы на странице ${url}. Перейдите на https://wordstat.yandex.ru/ и повторите 'run'.`);
        }
      } else {
        console.log('Неизвестная команда. Укажите login, save-cookie или run.');
      }
    }
    rl.close();

    // Основной парсинг
    const lines = fs.readFileSync(REQUESTS_FILE, 'utf-8').split('\n').filter(Boolean);
    const updatedQueries = generateRequestsWithOperators(lines);
    results = {};
    const csvData = [];

    for (const { type, query } of updatedQueries) {
      const key = query.replace(/['"!]/g, '').trim();
      if (!results[key]) results[key] = { original: '', withQuotes: '', withExclamation: '' };
      let processed = false;
      while (!processed) {
        try {
          await page.click('.textinput__control', { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await delay(getRandomDelay(1000, 3000));
          await copyToClipboard(page, query);
          await pasteFromClipboard(page);
          await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {})
          ]);
          await delay(getRandomDelay(1000, 3000));
          const freq = await page.evaluate(() => {
            const el = document.querySelector('.wordstat__content-preview-text_last');
            return el ? el.textContent.split(':')[1]?.trim() || '0' : '0';
          });
          const field = type === 'original' ? 'original' : type === 'withQuotes' ? 'withQuotes' : 'withExclamation';
          results[key][field] = freq;
          console.log(`Processed: ${key} | orig:${results[key].original} | q:${results[key].withQuotes} | !:${results[key].withExclamation}`);
          processed = true;
        } catch (err) {
          const msg = err.message || '';
          if (msg.includes('.textinput__control') || msg.includes('Execution context was destroyed')) {
            console.log(`Ошибка: "${msg}". Нажмите любую клавишу для продолжения...`);
            await new Promise(r => { process.stdin.resume(); process.stdin.once('data', () => { process.stdin.pause(); r(); }); });
            const freshCookies = await page.cookies();
            fs.writeFileSync(COOKIES_PATH, JSON.stringify(freshCookies));
            console.log('Куки пересохранены после сбоя.');
          } else {
            throw err;
          }
        }
      }
    }

    // Сохранение результатов
    for (const q of Object.keys(results)) csvData.push({ query: q, frequency: results[q].original, frequencyWithQuotes: results[q].withQuotes, frequencyWithExclamation: results[q].withExclamation });
    await createCsvWriter({ path: OUTPUT_FILE, header: [
      { id: 'query', title: 'Запрос' },
      { id: 'frequency', title: 'Частота' },
      { id: 'frequencyWithQuotes', title: 'Частота с кавычками' },
      { id: 'frequencyWithExclamation', title: 'Частота с восклицаниями' }
    ]}).writeRecords(csvData);

    console.log('Парсинг завершён. Файл:', OUTPUT_FILE);
    await sendTelegramMessage(`Парсинг завершён. Файл: ${OUTPUT_FILE}`);
    await browser.close();
  } catch (error) {
    console.error('Непредвиденная ошибка:', error.message);
    // Сохранение частичных результатов
    if (results && Object.keys(results).length) {
      const partial = Object.entries(results).map(([q, r]) => ({ query: q, frequency: r.original, frequencyWithQuotes: r.withQuotes, frequencyWithExclamation: r.withExclamation }));
      await createCsvWriter({ path: OUTPUT_FILE, header: [
        { id: 'query', title: 'Запрос' },
        { id: 'frequency', title: 'Частота' },
        { id: 'frequencyWithQuotes', title: 'Частота с кавычками' },
        { id: 'frequencyWithExclamation', title: 'Частота с восклицаниями' }
      ]}).writeRecords(partial);
      console.log('Частичные результаты сохранены в:', OUTPUT_FILE);
      await sendTelegramMessage(`Ошибка: ${error.message}. Частичные результаты сохранены в ${OUTPUT_FILE}`);
    }
    if (browser) await browser.close();
    process.exit(1);
  }
})();

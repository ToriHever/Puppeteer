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
const AUTH_URL = 'https://passport.yandex.ru/auth';
const TARGET_URL = 'https://wordstat.yandex.ru/';
const COOKIES_PATH = path.join(BASE_PATH, 'cookiesWordstat.json');
const REQUESTS_FILE = path.join(BASE_PATH, 'requests.txt');
const OUTPUT_DIR = path.join(BASE_PATH, 'Results');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'WordStat.csv');
const VIEWPORT = { width: 1035, height: 520 };

// Утилиты
function generateRequestsWithOperators(queries) {
  const updated = [];
  for (const q of queries) {
    const t = q.trim(); if (!t) continue;
    updated.push({ type: 'original', query: t });
    updated.push({ type: 'withQuotes', query: `"${t}"` });
    const excl = t.split(' ').map(w => `!${w}`).join(' ');
    updated.push({ type: 'withExclamation', query: `"${excl}"` });
  }
  return updated;
}
function getRandomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function promptCommand(rl) { return new Promise(res => rl.question('> ', ans => res(ans.trim()))); }

(async () => {
  let browser;
  const results = {};
  try {
    // Создаём папку для результатов
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Настройка CSV-писателя: дозапись
    const csvWriter = createCsvWriter({
      path: OUTPUT_FILE,
      header: [
        { id: 'query', title: 'Запрос' },
        { id: 'frequency', title: 'Частота' },
        { id: 'frequencyWithQuotes', title: 'Частота с кавычками' },
        { id: 'frequencyWithExclamation', title: 'Частота с восклицаниями' }
      ],
      append: fs.existsSync(OUTPUT_FILE)
    });

    // Интерфейс ввода команд
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Запуск браузера
    browser = await puppeteer.launch({ headless: false, defaultViewport: VIEWPORT, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Переход на сайт и загрузка куки
    console.log(`Переход на сайт: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });
    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
      await page.setCookie(...cookies);
      console.log('Куки загружены.');
      await page.reload({ waitUntil: 'networkidle2' });
    }

    // Добавляем UI-кнопки для команд
    await page.exposeFunction('uiCommand', cmd => rl.write(cmd + '\n'));
    await page.evaluate(() => {
      const panel = document.createElement('div');
      panel.style = 'position:fixed;top:0;left:0;z-index:9999;background:#eee;padding:8px;border:1px solid #333;font-family:sans-serif;';
      ['login','save-cookie','clear','run'].forEach(cmd => {
        const btn = document.createElement('button');
        btn.innerText = cmd;
        btn.style = 'margin-right:5px;';
        btn.onclick = () => window.uiCommand(cmd);
        panel.appendChild(btn);
      });
      document.body.appendChild(panel);
    });

    // Проверяем наличие поля ввода для автозапуска
    const hasInput = (await page.$('.textinput__control')) !== null;
    let autoRun = false;
    if (hasInput) {
      console.log('Поле ввода обнаружено — автоматический запуск "run"');
      autoRun = true;
    } else {
      console.log('Поле ввода не найдено — ожидание команды');
      await sendTelegramMessage('⚠️ Предупреждение — Скрипт не начат');
    }

    console.log('Команды: login, save-cookie, clear, run');
    while (!autoRun) {
      const cmd = await promptCommand(rl);
      if (cmd === 'login') {
        console.log('Авторизация...');
        await page.goto(AUTH_URL, { waitUntil: 'networkidle2' });
        await page.waitForSelector('input[name="login"]', { timeout: 60000 });
        await page.type('input[name="login"]', LOGIN, { delay: 100 });
        await page.click('#passp\\:sign-in');
        await page.waitForSelector('input[name="password"]', { timeout: 60000 });
        await page.type('input[name="password"]', PASSWORD, { delay: 100 });
        await page.click('#passp\\:sign-in');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        fs.writeFileSync(COOKIES_PATH, JSON.stringify(await page.cookies()));
        console.log('Куки сохранены.');
      } else if (cmd === 'save-cookie') {
        fs.writeFileSync(COOKIES_PATH, JSON.stringify(await page.cookies()));
        console.log('Куки сохранены вручную.');
      } else if (cmd === 'clear') {
        if (fs.existsSync(OUTPUT_FILE)) {
          fs.writeFileSync(OUTPUT_FILE, '');
          console.log('Файл результатов очищен.');
        } else console.log('Файл результатов не найден.');
      } else if (cmd === 'run') {
        if (page.url().startsWith(TARGET_URL)) {
          console.log('Запуск парсинга...'); autoRun = true;
        } else console.log(`Неверная страница: ${page.url()}`);
      } else console.log('Используйте: login, save-cookie, clear или run');
    }
    rl.close();

    // Читаем запросы и генерируем операции
    const lines = fs.readFileSync(REQUESTS_FILE, 'utf-8').split('\n').filter(Boolean);
    const tasks = generateRequestsWithOperators(lines);

    // Основной цикл парсинга
    for (const { type, query } of tasks) {
      const key = query.replace(/['"!]/g, '').trim();
      if (!results[key]) results[key] = { original: '', withQuotes: '', withExclamation: '' };
      let done = false;
      while (!done) {
        try {
          // Ввод запроса без использования буфера обмена
          await page.click('.textinput__control', { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await delay(getRandomDelay(500, 1000));
          await page.type('.textinput__control', query);
          await page.keyboard.press('Enter');
          await page.waitForSelector('.wordstat__content-preview-text_last', { timeout: 10000 });
          await delay(getRandomDelay(1000, 3000));

          const freq = await page.evaluate(() => {
            const el = document.querySelector('.wordstat__content-preview-text_last');
            return el ? el.textContent.split(':')[1]?.trim() : '0';
          });
          const field = type === 'original' ? 'original'
                        : type === 'withQuotes' ? 'withQuotes'
                        : 'withExclamation';
          results[key][field] = freq;
          console.log(`Result: ${key} | ${field}=${freq}`);

          // Запись строки по завершению всех трех метрик
          if (results[key].original !== '' && results[key].withQuotes !== '' && results[key].withExclamation !== '') {
            await csvWriter.writeRecords([{ query: key,
              frequency: results[key].original,
              frequencyWithQuotes: results[key].withQuotes,
              frequencyWithExclamation: results[key].withExclamation
            }]);
          }
          done = true;
        } catch (err) {
          const msg = err.message || '';
          if (msg.includes('Waiting for selector') && msg.includes('.wordstat__content-preview-text_last')) {
            console.log('Результат не найден, устанавливаем 0');
            const field = type === 'original' ? 'original'
                          : type === 'withQuotes' ? 'withQuotes'
                          : 'withExclamation';
            results[key][field] = '0';
            if (results[key].original !== '' && results[key].withQuotes !== '' && results[key].withExclamation !== '') {
              await csvWriter.writeRecords([{ query: key,
                frequency: results[key].original,
                frequencyWithQuotes: results[key].withQuotes,
                frequencyWithExclamation: results[key].withExclamation
              }]);
            }
            done = true;
          } else if (msg.includes('.textinput__control') || msg.includes('Execution context was destroyed')) {
            console.log(`Ошибка: "${msg}". Нажмите любую клавишу для продолжения...`);
            await new Promise(r => { process.stdin.resume(); process.stdin.once('data', () => { process.stdin.pause(); r(); }); });
            fs.writeFileSync(COOKIES_PATH, JSON.stringify(await page.cookies()));
            console.log('Куки пересохранены. Продолжаем...');
          } else throw err;
        }
      }
    }

    console.log('Парсинг завершён. Результаты в CSV:', OUTPUT_FILE);
    await sendTelegramMessage(`Парсинг завершён: ${OUTPUT_FILE}`);
    await browser.close();
    process.exit(0);
  } catch (error) {
    console.error('Ошибка:', error.message);
    await sendTelegramMessage(`Скрипт прерван: ${error.message}`);
    if (browser) await browser.close();
    process.exit(1);
  }
})();

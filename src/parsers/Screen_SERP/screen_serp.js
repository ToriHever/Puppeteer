import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { executablePath } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

puppeteer.use(StealthPlugin());

const execFileAsync = promisify(execFile);

// Путь к файлу запросов
const requestsPath = path.resolve('request.txt');

// === Шаг 1. Открыть файл в Блокноте и ждать его закрытия ===
console.log('📝 Открываем request.txt для редактирования...');
await execFileAsync('notepad.exe', [requestsPath]);
console.log('✅ Файл отредактирован и закрыт');

// === Шаг 2. Чтение запроса ===
let queries = [];
try {
  const fileContent = fs.readFileSync(requestsPath, 'utf-8');
  queries = fileContent
    .split('\n')
    .map(q => q.trim())
    .filter(Boolean);

  if (!queries.length) {
    console.log('❌ Файл request.txt пуст');
    process.exit(1);
  }
} catch (err) {
  console.error('❌ Не удалось прочитать request.txt:', err.message);
  process.exit(1);
}

console.log('📄 Загружено запросов:', queries.length);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-profile-'));
console.log('📁 Временный профиль создан:', userDataDir);

const browser = await puppeteer.launch({
  headless: false,
  executablePath: executablePath(),
  userDataDir,
  defaultViewport: { width: 1920, height: 1080 },
  args: [
    '--disable-extensions',
    '--disable-popup-blocking',
    '--lang=ru-RU,ru',
    '--window-position=0,0',
    '--window-size=1920,1080',
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ]
});

const page = await browser.newPage();
await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9' });
await page.goto('https://www.google.com');

try {
  await page.waitForSelector('div.QS5gu.sy4vM', { timeout: 3000 });
  await page.click('div.QS5gu.sy4vM');
  console.log('🟢 Клик по кнопке «Отклонить все» выполнен');
} catch {
  console.log('ℹ️ Кнопка «Отклонить все» не найдена (возможно, уже скрыта)');
}

const screenshotsDir = path.resolve('screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir);
}

for (let i = 0; i < queries.length; i++) {
  const query = queries[i];
  console.log(`🔎 Ищем: ${query}`);
  await page.goto('https://www.google.com');
  await page.waitForSelector('textarea[name="q"]', { visible: true });
  await page.type('textarea[name="q"]', query, { delay: 100 });
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

  if (i === 0) {
    let attempts = 0;
    while (attempts < 3) {
      const currentUrl = page.url();
      if (currentUrl.startsWith('https://www.google.com/search?q=')) {
        console.log('✅ Перешли на страницу с результатами поиска');
        break;
      }
      attempts++;
      console.log(`⌛ Ожидаем переход на страницу результатов... попытка ${attempts}`);
      await new Promise(res => setTimeout(res, 30000));
    }
  }

  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });

    const filename = path.join(screenshotsDir, `${query}.png`);
    await page.screenshot({ path: filename, fullPage: true });
  console.log(`✅ Скриншот сохранён: ${filename}`);
}

await browser.close();
console.log('⏳ Закрыли браузер. Удаляем профиль...');
setTimeout(() => {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    console.log('🧹 Профиль успешно удалён');
  } catch (e) {
    console.warn('⚠️ Не удалось удалить профиль:', e.message);
  }
}, 1000);

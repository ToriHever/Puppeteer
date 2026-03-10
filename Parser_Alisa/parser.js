import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const linksPath = path.join(__dirname, 'links.txt');
const cookiesPath = path.join(__dirname, 'cookiesWordstat.json');
const outputPath = path.join(__dirname, 'result.csv');

const CONCURRENCY = 5;

function escapeCSV(value) {
  if (!value) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size)
    result.push(array.slice(i, i + size));
  return result;
}

async function createPage(browser, cookies) {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType()))
      req.abort();
    else
      req.continue();
  });
  await page.goto('https://ya.ru', { waitUntil: 'domcontentloaded' });
  await page.setCookie(...cookies);
  return page;
}

async function hasCaptcha(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() || '';
    return (
      text.includes('подтвердите, что запросы отправляли вы') ||
      text.includes('я не робот') ||
      text.includes('captcha') ||
      !!document.querySelector('[class*="captcha"], [id*="captcha"], [class*="CheckboxCaptcha"]')
    );
  });
}

async function waitCaptchaGone(page, url, timeoutMs = 20_000) {
  console.log(`  [CAPTCHA] Жду пока уйдёт: ${url}`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1500));
    if (!(await hasCaptcha(page))) {
      console.log(`  [CAPTCHA] Ушла!`);
      return true;
    }
  }
  return false;
}

// Парсим DOM — единственный надёжный источник
async function parseDOM(page) {
  return page.evaluate(() => {
    const question = document.querySelector('h1')?.innerText.trim() || '';

    const answer = Array.from(document.querySelectorAll('.lc-styled-text p'))
      .map(el => {
        // Клонируем, удаляем все ссылки-источники (ref), берём чистый текст
        const clone = el.cloneNode(true);
        clone.querySelectorAll('a.ref, a[class*="ref"]').forEach(a => a.remove());
        return clone.innerText.trim();
      })
      .filter(Boolean).join(' ');

    const sources = [...new Set(
      Array.from(document.querySelectorAll('.lc-styled-text a.ref[href]'))
        .map(a => a.href)
        .filter(h => h.startsWith('http') && !h.includes('ya.ru') && !h.includes('yandex.') && !h.includes('favicon'))
    )].join(' | ');

    return { question, answer, sources };
  });
}

async function parseUrl(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Ждём либо h1, либо капчу
  await page.waitForFunction(() => {
    const text = document.body?.innerText?.toLowerCase() || '';
    const captcha = text.includes('подтвердите') || text.includes('captcha') || !!document.querySelector('[class*="captcha"]');
    const content = !!document.querySelector('h1');
    return captcha || content;
  }, { timeout: 15_000 }).catch(() => {});

  // Обработка капчи
  if (await hasCaptcha(page)) {
    const gone = await waitCaptchaGone(page, url);
    if (!gone) {
      console.error(`  [FAIL] Капча не ушла: ${url}`);
      return { url, question: '', answer: 'CAPTCHA_TIMEOUT', sources: '' };
    }
    await page.waitForSelector('h1', { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
  }

  const data = await parseDOM(page);
  return { url, ...data };
}

(async () => {
  const links = fs.readFileSync(linksPath, 'utf-8')
    .split('\n').map(l => l.trim()).filter(Boolean);

  const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const pages = [];
  for (let i = 0; i < CONCURRENCY; i++)
    pages.push(await createPage(browser, cookies));

  const batches = chunk(links, CONCURRENCY);
  const rows = [['url', 'question', 'answer', 'sources'].join(',')];

  for (const batch of batches) {
    const promises = batch.map((url, i) => parseUrl(pages[i], url));
    const results = await Promise.all(promises);
    for (const r of results) {
      rows.push([
        escapeCSV(r.url),
        escapeCSV(r.question),
        escapeCSV(r.answer),
        escapeCSV(r.sources)
      ].join(','));
      console.log(`OK: ${r.url} | ${r.question?.slice(0, 60)}`);
    }
  }

  fs.writeFileSync(outputPath, rows.join('\n'), 'utf-8');
  await browser.close();
  console.log(`[DONE] ${outputPath}`);
})();
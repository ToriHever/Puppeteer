const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────────

// Домен, ссылки на который ищем (вписывай сюда)
const TARGET_DOMAINS = [
  'ddos-guard.ru',
  // 'another-domain.com',
];

const CONFIG = {
  // Текстовый файл со списком URL (по одному на строку)
  pagesFile: 'pages.txt',

  // Файл для сохранения результатов
  outputFile: 'results.csv',

  // Таймаут загрузки страницы (мс)
  pageTimeout: 30000,

  // Задержка между страницами (мс), чтобы не спамить
  delayBetweenPages: 150,
};
const SCRIPT_DIR = path.dirname(process.argv[1]);

// Читаем список страниц из файла
function loadPages(filePath) {
  const abs = path.resolve(SCRIPT_DIR, filePath);
  if (!fs.existsSync(abs)) {
    console.error(`❌ Файл со страницами не найден: ${abs}`);
    console.error(`   Создайте файл "${filePath}" и добавьте URL по одному на строку.`);
    process.exit(1);
  }
  const lines = fs.readFileSync(abs, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')); // пустые строки и комментарии пропускаем
  console.log(`📋 Загружено страниц из ${filePath}: ${lines.length}`);
  return lines;
}

const OUTPUT_PATH = path.resolve(SCRIPT_DIR, CONFIG.outputFile);

// Инициализация CSV-файла с заголовком (если не существует)
function initCSV() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.writeFileSync(OUTPUT_PATH, 'source_page,link_url,link_text,checked_at\n', 'utf8');
    console.log(`📄 Создан файл: ${OUTPUT_PATH}`);
  } else {
    console.log(`📄 Используется существующий файл: ${OUTPUT_PATH}`);
  }
}

// Дозапись строк в CSV сразу после проверки страницы
function appendToCSV(rows) {
  if (!rows.length) return;
  const lines = rows
    .map(({ sourcePage, url, text, checkedAt }) => {
      const safe = (v) => `"${String(v).replace(/"/g, '""')}"`;
      return [safe(sourcePage), safe(url), safe(text), safe(checkedAt)].join(',');
    })
    .join('\n');
  fs.appendFileSync(OUTPUT_PATH, lines + '\n', 'utf8');
}

// Проверяем, содержит ли URL строку целевого домена после //
function matchesTargetDomain(href) {
  try {
    const afterSlashes = href.split('//')[1];
    if (!afterSlashes) return false;
    return TARGET_DOMAINS.some((domain) => afterSlashes.includes(domain));
  } catch {
    return false;
  }
}

// Определяем, похоже ли на редирект капчи / блокировку
function isCaptchaOrBlock(page) {
  const url = page.url();
  const blockPatterns = [
    /captcha/i,
    /recaptcha/i,
    /challenge/i,
    /blocked/i,
    /access.denied/i,
    /403/,
    /503/,
  ];
  return blockPatterns.some((p) => p.test(url));
}

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function run() {
  const pages = loadPages(CONFIG.pagesFile);
  initCSV();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const pageUrl of pages) {
    const page = await browser.newPage();

    // Маскируем user-agent под обычный браузер
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    try {
      console.log(`\n🔍 Проверяю: ${pageUrl}`);

      const response = await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.pageTimeout,
      });

      // Проверяем HTTP-статус
      const status = response?.status();
      if (status && status >= 400) {
        console.warn(`  ⚠️  HTTP ${status} — пропускаю`);
        await page.close();
        continue;
      }

      // Проверяем на капчу/блокировку после редиректа
      if (isCaptchaOrBlock(page)) {
        console.warn(`  ⚠️  Похоже на капчу/блокировку (${page.url()}) — пропускаю`);
        await page.close();
        continue;
      }

      // Собираем все <a href="..."> со страницы
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          href: a.href,
          text: a.innerText.trim().slice(0, 200),
        }));
      });

      console.log(`  📎 Всего ссылок на странице: ${links.length}`);
      console.log(`  🎯 Ищем домен: ${TARGET_DOMAINS.join(', ')}`);

      // Фильтруем по целевому домену
      const checkedAt = new Date().toISOString();
      const matched = links
        .filter(({ href }) => matchesTargetDomain(href))
        .map(({ href, text }) => ({
          sourcePage: pageUrl,
          url: href,
          text,
          checkedAt,
        }));

      // Дедупликация по URL в рамках одной страницы
      const seen = new Set();
      const unique = matched.filter(({ url }) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });

      console.log(`  ✅ Найдено ссылок: ${unique.length}`);
      unique.forEach(({ url }) => console.log(`     → ${url}`));

      // Сразу пишем в файл
      appendToCSV(unique);

    } catch (err) {
      // Любые ошибки (таймаут, сетевая ошибка, JS-ошибка) — просто пропускаем
      console.warn(`  ❌ Ошибка: ${err.message} — пропускаю`);
    } finally {
      await page.close();
    }

    await delay(CONFIG.delayBetweenPages);
  }

  await browser.close();
  console.log(`\n🎉 Готово! Результаты сохранены в: ${OUTPUT_PATH}`);
}

run().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
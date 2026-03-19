import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── CONFIG ────────────────────────────────────────────────────────────────────

// Домены, ссылки на которые ищем
const TARGET_DOMAINS = [
  'ddos-guard.ru',
  'ddos-guard.net',
  // 'another-domain.com',
];

// Текстовые упоминания для поиска в теле страницы (без учёта регистра)
// Слеш может быть или не быть: ddos-guard, ddos/guard — оба варианта
const TEXT_PATTERNS = [
  /ddos[-\/]?guard/i,
];

// Домены-исключения — страницы с этих доменов пропускаются и не проверяются
const EXCLUDED_DOMAINS = [
  'accounts.google.com',
  'maps.google.com',
  'policies.google.com',
  'site-analyzer.ru',
  'support.google.com',
  'www.google.com',
  'www.google.ru',
];

const CONFIG = {
  pagesFile: 'pages.txt',
  pageTimeout: 30000,
  delayBetweenPages: 150,
};

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);

// ─── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ──────────────────────────────────────────────────

function loadPages(filePath) {
  const abs = path.resolve(SCRIPT_DIR, filePath);
  if (!fs.existsSync(abs)) {
    console.error(`❌ Файл со страницами не найден: ${abs}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(abs, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  console.log(`📋 Загружено строк из ${filePath}: ${lines.length}`);
  return lines;
}

// Возвращает hostname из URL или null если URL невалидный
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function extractDomain(url) {
  try {
    const parts = new URL(url).hostname.split('.');
    return parts.slice(-2).join('.');
  } catch {
    return 'unknown';
  }
}

// Фильтрует список URL — убирает те, чей hostname совпадает с EXCLUDED_DOMAINS
function filterExcludedPages(pages) {
  const excluded = [];
  const filtered = pages.filter((url) => {
    const hostname = getHostname(url);
    if (!hostname) return true; // невалидный URL — оставляем, упадёт с ошибкой позже
    const isExcluded = EXCLUDED_DOMAINS.includes(hostname);
    if (isExcluded) excluded.push(url);
    return !isExcluded;
  });

  if (excluded.length > 0) {
    console.log(`\n🚫 Исключено страниц (домены из списка исключений): ${excluded.length}`);
    excluded.forEach((url) => console.log(`   — ${url}`));
  }

  console.log(`✅ Остаётся страниц для проверки: ${filtered.length}\n`);
  return filtered;
}

function generateOutputFilename(pages) {
  const sourceDomain = extractDomain(pages[0]);
  const date = new Date().toISOString().slice(0, 10);
  return `results_${sourceDomain}_${date}.csv`;
}

function ensureResultsDir() {
  const dir = path.resolve(SCRIPT_DIR, 'Results');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    console.log(`📁 Создана папка: Results`);
  }
  return dir;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function initCSV(linksPath, errorsPath) {
  fs.writeFileSync(linksPath, 'source_page,link_url,link_text,matched_domain,checked_at\n', 'utf8');
  fs.writeFileSync(errorsPath, 'source_page,error_type,error_detail,checked_at\n', 'utf8');
}

function appendLinks(linksPath, rows) {
  if (!rows.length) return;
  const lines = rows.map(({ sourcePage, url, text, matchedDomain, checkedAt }) => {
    const s = (v) => `"${String(v).replace(/"/g, '""')}"`;
    return [s(sourcePage), s(url), s(text), s(matchedDomain), s(checkedAt)].join(',');
  }).join('\n');
  fs.appendFileSync(linksPath, lines + '\n', 'utf8');
}

function appendError(errorsPath, sourcePage, errorType, errorDetail) {
  const s = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const checkedAt = new Date().toISOString();
  const line = [s(sourcePage), s(errorType), s(errorDetail), s(checkedAt)].join(',');
  fs.appendFileSync(errorsPath, line + '\n', 'utf8');
}

// ─── MATCHING ─────────────────────────────────────────────────────────────────

function matchesTargetDomain(href) {
  try {
    const afterSlashes = href.split('//')[1];
    if (!afterSlashes) return null;
    for (const domain of TARGET_DOMAINS) {
      if (afterSlashes.includes(domain)) return domain;
    }
    return null;
  } catch {
    return null;
  }
}

function isCaptchaOrBlock(page) {
  return [/captcha/i, /recaptcha/i, /challenge/i, /blocked/i, /access.denied/i, /403/, /503/]
    .some((p) => p.test(page.url()));
}

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ─── ПОИСК ТЕКСТОВЫХ УПОМИНАНИЙ ───────────────────────────────────────────────

async function findTextMentions(page) {
  return page.evaluate((patterns) => {
    const results = [];

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!text) continue;

      const matchedPattern = patterns.some((p) => new RegExp(p, 'i').test(text));
      if (!matchedPattern) continue;

      // Пропускаем если узел находится внутри <a>
      let parent = node.parentElement;
      let insideLink = false;
      while (parent && parent !== document.body) {
        if (parent.tagName === 'A') {
          insideLink = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (insideLink) continue;

      const blockParent = node.parentElement;
      const context = blockParent
        ? blockParent.innerText.trim().slice(0, 300)
        : text.slice(0, 300);

      results.push(context);
    }

    return [...new Set(results)];
  }, TEXT_PATTERNS.map((r) => r.source));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  const rawPages = loadPages(CONFIG.pagesFile);

  // Очищаем список от исключённых доменов до запуска браузера
  const pages = filterExcludedPages(rawPages);

  if (pages.length === 0) {
    console.error('❌ После фильтрации не осталось страниц для проверки.');
    process.exit(1);
  }

  const OUTPUT_FILENAME = generateOutputFilename(pages);
  const ERRORS_FILENAME = OUTPUT_FILENAME.replace('results_', 'errors_');
  const RESULTS_DIR = ensureResultsDir();
  const LINKS_PATH  = path.join(RESULTS_DIR, OUTPUT_FILENAME);
  const ERRORS_PATH = path.join(RESULTS_DIR, ERRORS_FILENAME);

  console.log(`🎯 Ищем ссылки на домены   : ${TARGET_DOMAINS.join(', ')}`);
  console.log(`🔤 Ищем текстовые упоминания: ${TEXT_PATTERNS.map(r => r.toString()).join(', ')}`);
  console.log(`🚫 Домены-исключения        : ${EXCLUDED_DOMAINS.join(', ')}`);
  initCSV(LINKS_PATH, ERRORS_PATH);
  console.log(`📄 Ссылки  → ${OUTPUT_FILENAME}`);
  console.log(`📄 Ошибки  → ${ERRORS_FILENAME}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let countOk = 0;
  let countErr = 0;

  for (const pageUrl of pages) {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    try {
      console.log(`🔍 Проверяю: ${pageUrl}`);

      const response = await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.pageTimeout,
      });

      const status = response?.status();

      if (status && status >= 400) {
        console.warn(`  ⚠️  HTTP ${status} — записываю в лог ошибок`);
        appendError(ERRORS_PATH, pageUrl, `HTTP_${status}`, `Сервер вернул статус ${status}`);
        countErr++;
        await page.close();
        continue;
      }

      if (isCaptchaOrBlock(page)) {
        const detail = `Редирект на: ${page.url()}`;
        console.warn(`  ⚠️  Капча/блокировка — записываю в лог ошибок`);
        appendError(ERRORS_PATH, pageUrl, 'BLOCKED', detail);
        countErr++;
        await page.close();
        continue;
      }

      const checkedAt = new Date().toISOString();
      const rows = [];

      // ── 1. Ищем ссылки на целевые домены ──────────────────────────────────
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          href: a.href,
          text: a.innerText.trim().slice(0, 200),
        }))
      );

      console.log(`  📎 Всего ссылок на странице: ${links.length}`);

      const seenUrls = new Set();
      for (const { href, text } of links) {
        const domain = matchesTargetDomain(href);
        if (!domain) continue;
        if (seenUrls.has(href)) continue;
        seenUrls.add(href);
        rows.push({ sourcePage: pageUrl, url: href, text, matchedDomain: domain, checkedAt });
      }

      console.log(`  🔗 Найдено ссылок на домены: ${rows.length}`);

      // ── 2. Ищем текстовые упоминания (без ссылки) ─────────────────────────
      const textMentions = await findTextMentions(page);

      console.log(`  🔤 Найдено текстовых упоминаний: ${textMentions.length}`);

      for (const context of textMentions) {
        rows.push({
          sourcePage: pageUrl,
          url: 'Нет ссылки',
          text: context,
          matchedDomain: 'текстовое упоминание',
          checkedAt,
        });
      }

      rows.forEach(({ url, matchedDomain, text }) => {
        if (url === 'Нет ссылки') {
          console.log(`     → [${matchedDomain}] "${text.slice(0, 80)}..."`);
        } else {
          console.log(`     → [${matchedDomain}] ${url}`);
        }
      });

      appendLinks(LINKS_PATH, rows);
      countOk++;

    } catch (err) {
      const errorType = err.name === 'TimeoutError' ? 'TIMEOUT' : 'ERROR';
      console.warn(`  ❌ ${errorType}: ${err.message} — записываю в лог ошибок`);
      appendError(ERRORS_PATH, pageUrl, errorType, err.message);
      countErr++;
    } finally {
      await page.close();
    }

    await delay(CONFIG.delayBetweenPages);
  }

  await browser.close();

  console.log('\n════════════════════════════════════════════════');
  console.log(`✅ Успешно обработано : ${countOk} стр.`);
  console.log(`❌ Ошибок             : ${countErr} стр.`);
  console.log(`📄 Ссылки сохранены   : ${OUTPUT_FILENAME}`);
  if (countErr > 0) {
    console.log(`📄 Лог ошибок         : ${ERRORS_FILENAME}`);
  }
  console.log('════════════════════════════════════════════════\n');
}

run().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
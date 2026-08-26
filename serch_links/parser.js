import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
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
  'www.google-analytics.com'
];

const CONFIG = {
  pagesFile: 'pages.txt',
  pageTimeout: 30000,
  delayBetweenPages: 150,
  // Поиск по запросу (когда передан query вместо pages.txt)
  searchPagesCount: 10,          // сколько страниц выдачи просматривать по умолчанию
  minSearchResultsThreshold: 3,  // меньше — считаем, что это капча/блокировка
  searchPageDelay: [1500, 3500], // пауза между страницами выдачи, мс
  // Режим «домены × слова» (приоритетный, см. resolveDomainsAndWords)
  domainsFile: 'domains.txt',
  wordsFile: 'words.txt',
};

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const COOKIES_FILE = path.join(SCRIPT_DIR, 'scripts', 'cookies', 'google.json');

// ─── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ──────────────────────────────────────────────────

// Если строка — голый домен без протокола (например "example.ru" или
// "example.ru/path"), добавляем https://, иначе page.goto() падает —
// Puppeteer не принимает URL без схемы.
function ensureProtocol(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function loadPages(filePath) {
  const abs = path.resolve(SCRIPT_DIR, filePath);
  if (!fs.existsSync(abs)) {
    console.error(`❌ Файл со страницами не найден: ${abs}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(abs, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(ensureProtocol);
  console.log(`📋 Загружено строк из ${filePath}: ${lines.length}`);
  return lines;
}

// Как loadPages, но не падает, если файла нет — возвращает пустой список
// (используется для опциональных domains.txt/words.txt)
function loadOptionalList(filePath) {
  const abs = path.resolve(SCRIPT_DIR, filePath);
  if (!fs.existsSync(abs)) return [];
  return fs.readFileSync(abs, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// domains.txt может содержать как "example.ru", так и "https://example.ru/path" —
// для оператора site: нужен именно голый хост
function normalizeDomainForSiteSearch(raw) {
  return raw.trim().replace(/^https?:\/\//i, '').split('/')[0];
}

// Собирает поисковый запрос вида: site:example.ru "защита от ddos"
// (многословные фразы берём в кавычки — точный поиск фразы, а не отдельных слов)
function buildSiteQuery(domain, word) {
  const phrase = word.includes(' ') ? `"${word}"` : word;
  return `site:${domain} ${phrase}`;
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
  // "matched" — домен (режим pages.txt/query), "текстовое упоминание" или
  // конкретное слово из words.txt (режим domains.txt+words.txt), в зависимости от режима
  fs.writeFileSync(linksPath, 'source_page,link_url,link_text,matched,page_date,snippet_date,checked_at\n', 'utf8');
  fs.writeFileSync(errorsPath, 'source_page,error_type,error_detail,checked_at\n', 'utf8');
}

function appendLinks(linksPath, rows) {
  if (!rows.length) return;
  const lines = rows.map(({ sourcePage, url, text, matchedDomain, pageDate, snippetDate, checkedAt }) => {
    const s = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    return [s(sourcePage), s(url), s(text), s(matchedDomain), s(pageDate), s(snippetDate), s(checkedAt)].join(',');
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

// Ищет на странице текст, совпадающий с одним из patternSources (regex-источники,
// без учёта регистра). По умолчанию пропускает совпадения внутри <a> (чтобы не
// дублировать то, что уже поймано отдельным сканом ссылок в старом режиме) —
// skipInsideLinks: false заставляет учитывать и такие совпадения, дополнительно
// возвращая href той ссылки (нужно для режима «домены × слова», где ссылка,
// содержащая слово в тексте, — и есть искомый результат).
// Возвращает массив { context, patternIndex, linkHref }.
async function findTextMentions(page, patternSources, { skipInsideLinks = true } = {}) {
  return page.evaluate((patterns, skipInside) => {
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

      const patternIndex = patterns.findIndex((p) => new RegExp(p, 'i').test(text));
      if (patternIndex === -1) continue;

      // Ищем, находится ли узел внутри <a>, и запоминаем саму ссылку
      let parent = node.parentElement;
      let linkEl = null;
      while (parent && parent !== document.body) {
        if (parent.tagName === 'A') {
          linkEl = parent;
          break;
        }
        parent = parent.parentElement;
      }
      if (linkEl && skipInside) continue;

      const blockParent = node.parentElement;
      const context = blockParent
        ? blockParent.innerText.trim().slice(0, 300)
        : text.slice(0, 300);

      results.push({ context, patternIndex, linkHref: linkEl ? linkEl.href : '' });
    }

    // Де-дуп по паре (контекст, ссылка)
    const seen = new Map();
    for (const r of results) {
      const key = `${r.context}|${r.linkHref}`;
      if (!seen.has(key)) seen.set(key, r);
    }
    return [...seen.values()];
  }, patternSources, skipInsideLinks);
}

// Экранирует спецсимволы regex — нужно, чтобы обычное слово из words.txt
// можно было безопасно использовать как паттерн для поиска по тексту
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── ДАТА СОЗДАНИЯ/ОБНОВЛЕНИЯ СТРАНИЦЫ ─────────────────────────────────────────

// Ищет дату публикации/обновления в meta-тегах, JSON-LD и <time>.
// Возвращает { published, modified } (пустая строка, если не нашли).
async function extractPageDates(page) {
  return page.evaluate(() => {
    const metaContent = (selector) => document.querySelector(selector)?.content?.trim() || '';

    let published =
      metaContent('meta[property="article:published_time"]') ||
      metaContent('meta[itemprop="datePublished"]') ||
      metaContent('meta[name="publish-date"]') ||
      metaContent('meta[name="date"]');

    let modified =
      metaContent('meta[property="article:modified_time"]') ||
      metaContent('meta[itemprop="dateModified"]') ||
      metaContent('meta[name="last-modified"]');

    // JSON-LD (schema.org Article/NewsArticle/WebPage), включая @graph
    if (!published || !modified) {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      for (const script of scripts) {
        let data;
        try {
          data = JSON.parse(script.textContent);
        } catch {
          continue;
        }
        const nodes = Array.isArray(data) ? data : (data['@graph'] || [data]);
        for (const node of nodes) {
          if (!node || typeof node !== 'object') continue;
          if (!published && node.datePublished) published = String(node.datePublished);
          if (!modified && node.dateModified) modified = String(node.dateModified);
        }
        if (published && modified) break;
      }
    }

    // <time datetime="...">
    if (!published) {
      const timeEl = document.querySelector('time[datetime]');
      if (timeEl) published = timeEl.getAttribute('datetime') || '';
    }

    return { published, modified };
  }).catch(() => ({ published: '', modified: '' }));
}

// Собирает лучшую доступную дату страницы: modified > published > Last-Modified заголовок
async function resolvePageDate(page, response) {
  const { published, modified } = await extractPageDates(page);
  if (modified) return modified;
  if (published) return published;
  const lastModifiedHeader = response?.headers()?.['last-modified'];
  return lastModifiedHeader || '';
}

// Пытается достать дату из сниппета Google (например "15 мар. 2024 г. — текст...")
function extractSnippetDateFromText(text) {
  if (!text) return '';
  const patterns = [
    // "15 мар. 2024 г. —" / "3 июл 2023 -"
    /^(\d{1,2}\s+[а-яё]+\.?\s+\d{4}\s*г?\.?)\s*[—\-–]/i,
    // "Jul 15, 2024 —"
    /^([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})\s*[—\-–]/,
    // "3 дня назад —" / "2 недели назад -"
    /^(\d+\s+[а-яё]+\s+назад)\s*[—\-–]/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return '';
}

// ─── ПОИСК ПО ЗАПРОСУ (Google) ─────────────────────────────────────────────────

function resolveQuery() {
  const cliQuery = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
  if (cliQuery) return cliQuery;

  const queryFile = path.resolve(SCRIPT_DIR, 'query.txt');
  if (fs.existsSync(queryFile)) {
    const lines = fs.readFileSync(queryFile, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (lines.length) return lines[0];
  }
  return '';
}

function resolvePagesCount() {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--pages='));
  if (arg) {
    const n = parseInt(arg.split('=')[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return CONFIG.searchPagesCount;
}

function slugify(str) {
  const slug = str
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'query';
}

function loadGoogleCookies() {
  try {
    const raw = fs.readFileSync(COOKIES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : (parsed.cookies || []);
    return arr.filter((c) => c.name && c.value);
  } catch {
    return [];
  }
}

async function saveGoogleCookies(page) {
  try {
    const dir = path.dirname(COOKIES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2), 'utf8');
    console.log(`  🍪 Куки Google сохранены → ${COOKIES_FILE}`);
  } catch (e) {
    console.warn(`  ⚠️  Не удалось сохранить куки: ${e.message}`);
  }
}

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message}\nНажмите Enter после решения капчи...\n`, () => {
      rl.close();
      resolve();
    });
  });
}

// Извлекает ссылки результатов выдачи (не сервисные google-ссылки) со страницы
async function extractSearchResults(page) {
  return page.evaluate(() => {
    function extractFromNodes(nodes) {
      const seen = new Set();
      const out = [];
      for (const node of nodes) {
        if (node.closest('[data-text-ad]') || node.querySelector('[data-text-ad]')) continue;

        const linkEl =
          node.querySelector('a[href][jsname]') ||
          node.querySelector('a[ping]') ||
          node.querySelector('a[data-ved]') ||
          node.querySelector('h3 a') ||
          node.querySelector('a[href^="https"]:not([role="button"])');

        const url = linkEl ? linkEl.href : '';
        if (!url || !url.startsWith('http')) continue;
        if (
          url.includes('google.com') ||
          url.includes('webcache.') ||
          url.includes('translate.') ||
          url.includes('maps.')
        ) continue;
        if (seen.has(url)) continue;
        seen.add(url);

        const titleEl = node.querySelector('h3') || node.querySelector('[role="heading"]');
        const title = titleEl ? titleEl.textContent.trim() : '';

        // Текст сниппета-описания — нужен, чтобы потом вытащить дату,
        // которую Google иногда показывает перед описанием ("15 мар 2024 — ...")
        const descSelectors = [
          '[data-sncf="1"]', '[data-content-feature="1"]',
          '.VwiC3b', '.yXK7lf', '.s3v9rd', '.st', '.lEBKkf',
        ];
        let description = '';
        for (const sel of descSelectors) {
          const el = node.querySelector(sel);
          if (el && el.textContent.trim().length > 10) {
            description = el.textContent.trim();
            break;
          }
        }

        out.push({ url, title, description });
      }
      return out;
    }

    // Пробуем все стратегии и берём ту, что дала больше результатов —
    // одна случайно зацепленная левая ссылка (виджет, "похожие запросы")
    // не должна перекрывать более широкую резервную стратегию.
    let best = [];

    // Стратегия 1: классические блоки .g
    let nodes = [
      ...document.querySelectorAll('#rso .g'),
      ...document.querySelectorAll('#search .g'),
      ...document.querySelectorAll('.g'),
    ];
    nodes = [...new Set(nodes)];
    const results1 = extractFromNodes(nodes);
    if (results1.length > best.length) best = results1;

    // Стратегия 2: от h3 поднимаемся к блоку результата
    const root = document.querySelector('#search') || document.querySelector('#main') || document.body;
    const blockNodes = [...root.querySelectorAll('h3')].map((h3) => {
      let node = h3;
      for (let i = 0; i < 10; i++) {
        if (!node.parentElement) break;
        node = node.parentElement;
        if (node.classList.contains('g') || node.id === 'rso') break;
      }
      return node;
    });
    const results2 = extractFromNodes([...new Set(blockNodes)]);
    if (results2.length > best.length) best = results2;

    // Стратегия 3 (запасная): разметка Google могла смениться —
    // просто берём все внешние ссылки со страницы как есть
    const seen3 = new Set();
    const raw = [];
    for (const a of document.querySelectorAll('a[href^="http"]')) {
      const url = a.href;
      if (
        url.includes('google.com') ||
        url.includes('webcache.') ||
        url.includes('translate.') ||
        url.includes('maps.')
      ) continue;
      if (seen3.has(url)) continue;
      seen3.add(url);
      const title = a.textContent.trim();
      if (title.length < 3) continue;
      raw.push({ url, title, description: '' });
      if (raw.length >= 30) break;
    }
    if (raw.length > best.length) best = raw;

    return best;
  });
}

// Настоящая блокировка/капча Google определяется по редиректу, а не по числу результатов
function isGoogleBlocked(page) {
  const url = page.url();
  return /google\.[a-z.]+\/sorry\//i.test(url) || /recaptcha/i.test(url);
}

async function debugDumpSearchPage(page, pageNum) {
  try {
    const dir = path.join(SCRIPT_DIR, 'debug');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const html = await page.content();
    fs.writeFileSync(path.join(dir, `search_page_${pageNum}.html`), html, 'utf8');
    console.log(`  🔬 Дамп страницы для диагностики → debug/search_page_${pageNum}.html`);
  } catch (e) {
    console.warn(`  ⚠️  Не удалось сохранить дамп: ${e.message}`);
  }
}

// Открывает headful-браузер, настроенный для поиска в Google (куки, UA, антидетект)
async function createSearchBrowserAndPage() {
  const cookies = loadGoogleCookies();
  console.log(cookies.length
    ? `🍪 Загружено ${cookies.length} куки Google`
    : '⚠️  Куки Google не найдены (scripts/cookies/google.json) — риск капчи выше');

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1920, height: 1080 });
  if (cookies.length) await page.setCookie(...cookies);

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  return { browser, page };
}

// Проходит по первым maxPages страницам выдачи Google по запросу query на уже
// открытой странице (переиспользуется между несколькими запросами подряд —
// не пересоздаёт браузер на каждую комбинацию домен+слово)
async function collectSearchUrlsForPage(page, query, maxPages) {
  console.log(`\n🔎 Ищу в Google: "${query}"`);
  console.log(`📑 Страниц выдачи: ${maxPages}\n`);

  const collected = [];
  const seen = new Set();

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const start = (pageNum - 1) * 10;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=ru&num=10&start=${start}`;

    console.log(`  📄 Страница выдачи ${pageNum}/${maxPages}...`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    try {
      await page.waitForSelector('#search, #rso, .g, h3', { timeout: 12000 });
    } catch {
      // не загрузилось — проверим по количеству результатов ниже
    }

    await delay(800 + Math.random() * 600);

    let results = await extractSearchResults(page);

    if (isGoogleBlocked(page)) {
      // Настоящая капча/блокировка — Google сам редиректнул на /sorry/
      console.warn(`  ⚠️  Google показал капчу (редирект: ${page.url()})`);
      await waitForEnter(`  Решите капчу в открытом окне браузера (страница ${pageNum}), затем вернитесь сюда.`);
      await saveGoogleCookies(page);
      // После капчи возвращаемся на нужный URL — Google мог оставить нас на /sorry/
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(800 + Math.random() * 600);
      results = await extractSearchResults(page);
      console.log(`     После капчи: ${results.length} результатов`);
    } else if (results.length < CONFIG.minSearchResultsThreshold) {
      // Капчи нет, но и результатов почти нет — вероятно, разметка Google не совпала
      // с нашими селекторами. Не блокируем скрипт, а сохраняем дамп для диагностики.
      console.warn(`  ⚠️  Мало результатов (${results.length}), капча не обнаружена — возможно, изменилась разметка страницы.`);
      await debugDumpSearchPage(page, pageNum);
    }

    for (const { url, title, description } of results) {
      if (seen.has(url)) continue;
      seen.add(url);
      const snippetDate = extractSnippetDateFromText(description);
      collected.push({ url, title, snippetDate, page: pageNum });
    }

    console.log(`     Найдено на странице: ${results.length}, всего уникальных: ${collected.length}`);

    if (results.length === 0) {
      console.log('  ⏹  Пустая страница — выдача закончилась.');
      break;
    }

    await delay(CONFIG.searchPageDelay[0] + Math.random() * (CONFIG.searchPageDelay[1] - CONFIG.searchPageDelay[0]));
  }

  return collected;
}

// Проходит по первым maxPages страницам выдачи Google и собирает URL результатов
// (одноразовый запуск: сам открывает и закрывает браузер — для одного запроса)
async function collectSearchUrls(query, maxPages) {
  const { browser, page } = await createSearchBrowserAndPage();
  try {
    return await collectSearchUrlsForPage(page, query, maxPages);
  } finally {
    await browser.close();
  }
}

function saveCollectedUrls(dir, slug, dateStr, collected) {
  const file = path.join(dir, `search_urls_${slug}_${dateStr}.csv`);
  const s = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
  const header = 'page,url,title,snippet_date\n';
  const body = collected.map(({ page, url, title, snippetDate }) => [page, s(url), s(title), s(snippetDate)].join(',')).join('\n');
  fs.writeFileSync(file, header + body + '\n', 'utf8');
  console.log(`📄 Список найденных URL → ${path.basename(file)}`);
}

// ─── РЕЖИМ «ДОМЕНЫ × СЛОВА» ─────────────────────────────────────────────────────

// Сырой список того, что нашли по каждой паре домен+слово — до подтверждения
// (в самих найденных страницах слово ещё не проверялось, только то, что Google
// его увидел в индексе по site:-запросу)
function saveDomainsWordsRawList(dir, dateStr, aggregated) {
  const file = path.join(dir, `search_urls_domains_words_${dateStr}.csv`);
  const s = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
  const header = 'domain,matched_words,url,title,snippet_date\n';
  const body = aggregated
    .map(({ domain, words, url, title, snippetDate }) =>
      [s(domain), s([...words].join('; ')), s(url), s(title), s(snippetDate)].join(','))
    .join('\n');
  fs.writeFileSync(file, header + body + '\n', 'utf8');
  console.log(`📄 Список найденных URL (домены × слова) → ${path.basename(file)}`);
}

// Для каждой пары (домен, слово) ищет в Google "site:домен слово" и собирает
// URL из выдачи — это и есть "ссылки на которых есть упоминание" из этого домена.
// Затем заходит на каждую найденную страницу и подтверждает, что слово реально
// встречается в тексте (в т.ч. если оно стоит в тексте самой ссылки — тогда
// в итоговый результат попадёт именно URL этой ссылки, а не страницы).
async function runDomainsWordsMode(rawDomains, words) {
  const domains = rawDomains.map(normalizeDomainForSiteSearch);
  const maxPagesPerCombo = resolvePagesCount();
  const totalCombos = domains.length * words.length;

  console.log(`\n🎯 Домены для проверки (${domains.length}): ${domains.join(', ')}`);
  console.log(`🔤 Слова для проверки (${words.length}): ${words.join(', ')}`);
  console.log(`📑 Комбинаций домен×слово: ${totalCombos}, страниц выдачи на комбинацию: ${maxPagesPerCombo}\n`);

  // ── Шаг 1: собираем URL из Google по каждой паре домен+слово ──────────────
  const { browser: searchBrowser, page: searchPage } = await createSearchBrowserAndPage();
  const allCollected = [];
  let comboIndex = 0;

  try {
    for (const domain of domains) {
      for (const word of words) {
        comboIndex++;
        const query = buildSiteQuery(domain, word);
        console.log(`\n═══ [${comboIndex}/${totalCombos}] ${query} ═══`);
        const collected = await collectSearchUrlsForPage(searchPage, query, maxPagesPerCombo);
        for (const item of collected) {
          allCollected.push({ ...item, domain, word });
        }
      }
    }
  } finally {
    await searchBrowser.close();
  }

  if (allCollected.length === 0) {
    console.error('❌ Ни по одной комбинации домен+слово ничего не найдено в Google.');
    process.exit(1);
  }

  // Агрегируем по URL — один и тот же URL мог найтись по нескольким словам
  const byUrl = new Map();
  for (const item of allCollected) {
    if (!byUrl.has(item.url)) {
      byUrl.set(item.url, {
        url: item.url,
        title: item.title,
        domain: item.domain,
        snippetDate: item.snippetDate,
        words: new Set(),
      });
    }
    byUrl.get(item.url).words.add(item.word);
  }
  const aggregated = [...byUrl.values()];

  const dateStr = new Date().toISOString().slice(0, 10);
  const RESULTS_DIR = ensureResultsDir();
  saveDomainsWordsRawList(RESULTS_DIR, dateStr, aggregated);

  // ── Шаг 2: заходим на каждую найденную страницу и подтверждаем упоминание ──
  const OUTPUT_FILENAME = `results_domains_words_${dateStr}.csv`;
  const ERRORS_FILENAME = `errors_domains_words_${dateStr}.csv`;
  const LINKS_PATH = path.join(RESULTS_DIR, OUTPUT_FILENAME);
  const ERRORS_PATH = path.join(RESULTS_DIR, ERRORS_FILENAME);
  initCSV(LINKS_PATH, ERRORS_PATH);
  console.log(`\n📄 Ссылки  → ${OUTPUT_FILENAME}`);
  console.log(`📄 Ошибки  → ${ERRORS_FILENAME}\n`);

  const checkBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let countOk = 0;
  let countErr = 0;
  let countConfirmed = 0;

  for (const item of aggregated) {
    const page = await checkBrowser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    try {
      console.log(`🔍 Проверяю [${item.domain}]: ${item.url}`);

      const response = await page.goto(item.url, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.pageTimeout,
      });

      const status = response?.status();

      if (status && status >= 400) {
        console.warn(`  ⚠️  HTTP ${status} — записываю в лог ошибок`);
        appendError(ERRORS_PATH, item.url, `HTTP_${status}`, `Сервер вернул статус ${status}`);
        countErr++;
        await page.close();
        continue;
      }

      if (isCaptchaOrBlock(page)) {
        appendError(ERRORS_PATH, item.url, 'BLOCKED', `Редирект на: ${page.url()}`);
        countErr++;
        await page.close();
        continue;
      }

      const checkedAt = new Date().toISOString();
      const pageDate = await resolvePageDate(page, response);

      const wordsForUrl = [...item.words];
      const wordPatternSources = wordsForUrl.map(escapeRegExp);
      // skipInsideLinks: false — слово в тексте самой ссылки тоже считается
      // (и тогда в url попадёт href этой ссылки, а не страницы)
      const mentions = await findTextMentions(page, wordPatternSources, { skipInsideLinks: false });

      if (mentions.length === 0) {
        console.log('  ⚠️  Слово(-а) не подтвердились на странице (индекс Google мог устареть)');
      } else {
        const rows = mentions.map(({ context, patternIndex, linkHref }) => ({
          sourcePage: item.domain,
          url: linkHref || item.url,
          text: context,
          matchedDomain: wordsForUrl[patternIndex],
          pageDate,
          snippetDate: item.snippetDate,
          checkedAt,
        }));

        rows.forEach(({ url, matchedDomain }) => {
          console.log(`     → [${matchedDomain}] ${url}`);
        });

        appendLinks(LINKS_PATH, rows);
        countConfirmed += rows.length;
      }

      countOk++;
    } catch (err) {
      const errorType = err.name === 'TimeoutError' ? 'TIMEOUT' : 'ERROR';
      console.warn(`  ❌ ${errorType}: ${err.message} — записываю в лог ошибок`);
      appendError(ERRORS_PATH, item.url, errorType, err.message);
      countErr++;
    } finally {
      await page.close();
    }

    await delay(CONFIG.delayBetweenPages);
  }

  await checkBrowser.close();

  console.log('\n════════════════════════════════════════════════');
  console.log(`✅ Проверено страниц       : ${countOk}`);
  console.log(`✅ Подтверждено упоминаний : ${countConfirmed}`);
  console.log(`❌ Ошибок                  : ${countErr}`);
  console.log(`📄 Результаты сохранены    : ${OUTPUT_FILENAME}`);
  if (countErr > 0) {
    console.log(`📄 Лог ошибок              : ${ERRORS_FILENAME}`);
  }
  console.log('════════════════════════════════════════════════\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  // ── Приоритетный режим: domains.txt + words.txt заполнены ──────────────────
  const domains = loadOptionalList(CONFIG.domainsFile);
  const words = loadOptionalList(CONFIG.wordsFile);

  if (domains.length > 0 && words.length > 0) {
    await runDomainsWordsMode(domains, words);
    return;
  }

  const query = resolveQuery();
  let pages;
  let outputSlug = null;
  const snippetDateByUrl = new Map();

  if (query) {
    // ── Режим поиска: сами собираем URL из первых N страниц выдачи Google ──
    const maxPages = resolvePagesCount();
    const collected = await collectSearchUrls(query, maxPages);

    if (collected.length === 0) {
      console.error('❌ Не удалось собрать ни одного URL из выдачи Google (капча/блокировка/пустая выдача).');
      process.exit(1);
    }

    outputSlug = slugify(query);
    const dateStr = new Date().toISOString().slice(0, 10);
    saveCollectedUrls(ensureResultsDir(), outputSlug, dateStr, collected);

    for (const { url, snippetDate } of collected) {
      if (snippetDate) snippetDateByUrl.set(url, snippetDate);
    }

    pages = filterExcludedPages(collected.map((c) => c.url));
  } else {
    // ── Старый режим: список URL из pages.txt ──
    const rawPages = loadPages(CONFIG.pagesFile);
    pages = filterExcludedPages(rawPages);
  }

  if (pages.length === 0) {
    console.error('❌ После фильтрации не осталось страниц для проверки.');
    process.exit(1);
  }

  const OUTPUT_FILENAME = outputSlug
    ? `results_${outputSlug}_${new Date().toISOString().slice(0, 10)}.csv`
    : generateOutputFilename(pages);
  const ERRORS_FILENAME = OUTPUT_FILENAME.replace('results_', 'errors_');
  const RESULTS_DIR = ensureResultsDir();
  const LINKS_PATH = path.join(RESULTS_DIR, OUTPUT_FILENAME);
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

      // ── Дата страницы: meta/JSON-LD/Last-Modified + сниппет из выдачи (если есть) ──
      const pageDate = await resolvePageDate(page, response);
      const snippetDate = snippetDateByUrl.get(pageUrl) || '';
      if (pageDate) console.log(`  📅 Дата страницы: ${pageDate}`);

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
        rows.push({ sourcePage: pageUrl, url: href, text, matchedDomain: domain, pageDate, snippetDate, checkedAt });
      }

      console.log(`  🔗 Найдено ссылок на домены: ${rows.length}`);

      // ── 2. Ищем текстовые упоминания (без ссылки) ─────────────────────────
      const textMentions = await findTextMentions(page, TEXT_PATTERNS.map((r) => r.source));

      console.log(`  🔤 Найдено текстовых упоминаний: ${textMentions.length}`);

      for (const { context } of textMentions) {
        rows.push({
          sourcePage: pageUrl,
          url: 'Нет ссылки',
          text: context,
          matchedDomain: 'текстовое упоминание',
          pageDate,
          snippetDate,
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
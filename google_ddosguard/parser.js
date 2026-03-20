import puppeteer from 'puppeteer';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ═══════════════════════════════════════════════
//  КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════

const SEARCH_QUERY = '"DDoS-Guard" -site:ddos-guard.net -site:ddos-guard.ru';

const CONFIG = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  minResultsThreshold: 3,
  pageDelay: [2000, 4500],
  debug: true,   // сохраняет HTML + JSON-дамп в папку debug/
};

const COOKIES_FILE = path.join(__dirname, 'scripts', 'cookies', 'google.json');
const RESULTS_DIR  = path.join(__dirname, 'results');
const DEBUG_DIR    = path.join(__dirname, 'debug');

const MODES = { COOKIE: 'cookie', INCOGNITO: 'incognito' };

// Периоды фильтрации Google
const DATE_PERIODS = [
  { key: '1', label: 'Без фильтра',          tbs: null },
  { key: '2', label: 'Последний час',         tbs: 'qdr:h' },
  { key: '3', label: 'Последние 24 часа',     tbs: 'qdr:d' },
  { key: '4', label: 'Последняя неделя',      tbs: 'qdr:w' },
  { key: '5', label: 'Последний месяц',       tbs: 'qdr:m' },
  { key: '6', label: 'Последний год',         tbs: 'qdr:y' },
  { key: '7', label: 'Произвольный диапазон', tbs: 'custom' },
];

// ═══════════════════════════════════════════════
//  ПАУЗА (горячая клавиша P)
// ═══════════════════════════════════════════════

let _paused = false;
let _prefix = '';

const isPaused    = () => _paused;
const pausePrefix = () => _prefix;

function initHotkeys() {
  if (!process.stdin.isTTY) return;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') return;
    if (key.name === 'return') return;
    if (key.name === 'p' || key.name === 'з') {
      _paused = !_paused;
      if (_paused) {
        console.log('\n⏸️  СКРИПТ ПРИОСТАНОВЛЕН. Нажмите P для возобновления\n');
        _prefix = '⏸️  [ПАУЗА] ';
      } else {
        console.log('\n▶️  СКРИПТ ВОЗОБНОВЛЁН\n');
        _prefix = '';
      }
    }
    if (key.name === 'h' || key.name === 'р') {
      console.log('\n📋 P — пауза, H — справка, Ctrl+C — выход\n');
    }
  });

  console.log('⌨️  Горячие клавиши: P — пауза, H — справка, Ctrl+C — выход\n');
}

// ═══════════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════════

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sleepWithPauseCheck(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    while (isPaused()) await sleep(100);
    await sleep(Math.min(100, end - Date.now()));
  }
}

function waitForEnter(msg = 'После устранения проблемы') {
  return new Promise(resolve => {
    console.log(`\n${msg}`);
    console.log('Нажмите Enter для продолжения...');
    let done = false;
    const handler = (str, key) => {
      if (!done && key.name === 'return') {
        done = true;
        process.stdin.removeListener('keypress', handler);
        console.log('✓ Продолжаем...\n');
        resolve();
      }
    };
    process.stdin.on('keypress', handler);
  });
}

async function randomMouseMovement(page, durationMs) {
  const vp  = page.viewport();
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    while (isPaused()) await sleep(100);
    const x = Math.floor(Math.random() * vp.width);
    const y = Math.floor(Math.random() * vp.height);
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
    await sleep(50 + Math.random() * 150);
    if (Math.random() > 0.75) {
      const r = 20 + Math.random() * 30;
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        if (isPaused()) { await sleep(100); continue; }
        await page.mouse.move(x + Math.cos(a) * r, y + Math.sin(a) * r, { steps: 2 });
        await sleep(30);
      }
    }
  }
}

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

// ═══════════════════════════════════════════════
//  ДИАГНОСТИКА
// ═══════════════════════════════════════════════

async function debugDump(page, pageNum) {
  if (!CONFIG.debug) return;
  try {
    await ensureDir(DEBUG_DIR);

    const html = await page.content();
    const htmlFile = path.join(DEBUG_DIR, `page_${pageNum}.html`);
    await writeFile(htmlFile, html, 'utf-8');

    const info = await page.evaluate(() => {
      const root = document.querySelector('#search') ||
                   document.querySelector('#main')   ||
                   document.querySelector('#rcnt')   ||
                   document.body;

      // Собираем все уникальные классы
      const classes = new Set();
      root.querySelectorAll('*').forEach(el => el.classList.forEach(c => classes.add(c)));

      // Первые блоки внутри #rso / #search
      const container = document.querySelector('#rso') || document.querySelector('#search') || root;
      const blocks = [...container.children].slice(0, 30).map(el => ({
        tag: el.tagName,
        id: el.id,
        classes: [...el.classList].join(' '),
        dataKeys: Object.keys(el.dataset).join(' '),
        childCount: el.children.length,
        text: el.textContent.trim().slice(0, 100),
      }));

      // Все ссылки на странице (не google.com)
      const links = [...document.querySelectorAll('a[href]')]
        .map(a => ({ href: a.href, text: a.textContent.trim().slice(0, 60) }))
        .filter(l => l.href.startsWith('http') && !l.href.includes('google.com'))
        .slice(0, 20);

      return {
        title: document.title,
        url: location.href,
        hasSearch: !!document.querySelector('#search'),
        hasRso:    !!document.querySelector('#rso'),
        hasMain:   !!document.querySelector('#main'),
        hasRcnt:   !!document.querySelector('#rcnt'),
        allH3:     [...document.querySelectorAll('h3')].map(h => h.textContent.trim().slice(0,80)),
        topBlocks: blocks,
        externalLinks: links,
        sampleClasses: [...classes].sort().slice(0, 60),
      };
    });

    const infoFile = path.join(DEBUG_DIR, `page_${pageNum}_info.json`);
    await writeFile(infoFile, JSON.stringify(info, null, 2), 'utf-8');

    console.log(`  🔬 Debug сохранён: debug/page_${pageNum}.html  +  page_${pageNum}_info.json`);
    console.log(`  🔬 Заголовок страницы: "${info.title}"`);
    console.log(`  🔬 Есть #search:${info.hasSearch} #rso:${info.hasRso} #main:${info.hasMain}`);
    console.log(`  🔬 Всего h3 на странице: ${info.allH3.length}`);
    if (info.allH3.length) {
      console.log('  🔬 Первые h3:');
      info.allH3.slice(0, 5).forEach(t => console.log(`       "${t}"`));
    }
    console.log(`  🔬 Внешних ссылок: ${info.externalLinks.length}`);
    if (info.externalLinks.length) {
      info.externalLinks.slice(0, 5).forEach(l => console.log(`       ${l.href}  "${l.text}"`));
    }
  } catch (e) {
    console.warn('  ⚠️  Debug dump error:', e.message);
  }
}

// ═══════════════════════════════════════════════
//  ВЫБОР ПЕРИОДА
// ═══════════════════════════════════════════════

function selectPeriod() {
  return new Promise(resolve => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║       ВЫБОР ПЕРИОДА ПОИСКА                   ║');
    console.log('╚══════════════════════════════════════════════╝\n');
    DATE_PERIODS.forEach(p => console.log(`${p.key}. ${p.label}`));
    console.log('\nВыберите период (1–7): ');

    let done = false;
    const valid = DATE_PERIODS.map(p => p.key);
    const handler = (str) => {
      if (!done && valid.includes(str)) {
        done = true;
        process.stdin.removeListener('keypress', handler);
        const period = DATE_PERIODS.find(p => p.key === str);
        console.log(`\n✓ Период: ${period.label}\n`);
        resolve(period);
      }
    };
    process.stdin.on('keypress', handler);
  });
}

// Ввод произвольных дат через readline (построчный ввод, не raw)
function inputCustomDates() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('Введите даты в формате ДД.ММ.ГГГГ\n');

    rl.question('  Дата начала (например 01.01.2024): ', (from) => {
      rl.question('  Дата конца  (например 31.12.2024): ', (to) => {
        rl.close();

        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
          process.stdin.resume();
        }

        const toGoogleDate = (str) => {
          const [d, m, y] = str.trim().split('.');
          return `${m}/${d}/${y}`;
        };

        const fromClean = from.trim();
        const toClean   = to.trim();
        const tbs = `cdr:1,cd_min:${toGoogleDate(fromClean)},cd_max:${toGoogleDate(toClean)}`;

        console.log(`\n✓ Диапазон: ${fromClean} — ${toClean}`);
        console.log(`  tbs параметр: ${tbs}\n`);
        resolve({ tbs, dateFrom: fromClean, dateTo: toClean });
      });
    });
  });
}

// Вычисляем читаемые даты начала/конца для фиксированных периодов
function calcPeriodDates(periodTbs) {
  const fmt = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  const now  = new Date();
  const today = fmt(now);

  if (!periodTbs || periodTbs === null) return { dateFrom: '', dateTo: '' };

  const map = {
    'qdr:h': () => { const d = new Date(now - 3600*1000);       return { dateFrom: fmt(d), dateTo: today }; },
    'qdr:d': () => { const d = new Date(now - 86400*1000);      return { dateFrom: fmt(d), dateTo: today }; },
    'qdr:w': () => { const d = new Date(now - 7*86400*1000);    return { dateFrom: fmt(d), dateTo: today }; },
    'qdr:m': () => { const d = new Date(now); d.setMonth(d.getMonth()-1);       return { dateFrom: fmt(d), dateTo: today }; },
    'qdr:y': () => { const d = new Date(now); d.setFullYear(d.getFullYear()-1); return { dateFrom: fmt(d), dateTo: today }; },
  };

  return map[periodTbs] ? map[periodTbs]() : { dateFrom: '', dateTo: '' };
}

// ═══════════════════════════════════════════════
//  ВЫБОР РЕЖИМА
// ═══════════════════════════════════════════════

function selectMode() {
  return new Promise(resolve => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║       ВЫБОР РЕЖИМА РАБОТЫ ПАРСЕРА            ║');
    console.log('╚══════════════════════════════════════════════╝\n');
    console.log('1. 🍪 С куками  — использует сохранённую сессию');
    console.log('2. 🕶️  Инкогнито — анонимный режим без куков\n');
    console.log('Выберите режим (1 или 2): ');

    let done = false;
    const handler = (str) => {
      if (!done && (str === '1' || str === '2')) {
        done = true;
        process.stdin.removeListener('keypress', handler);
        const mode = str === '2' ? MODES.INCOGNITO : MODES.COOKIE;
        console.log(`\n✓ Режим: ${mode === MODES.COOKIE ? '🍪 С куками' : '🕶️  Инкогнито'}\n`);
        resolve(mode);
      }
    };
    process.stdin.on('keypress', handler);
  });
}

// ═══════════════════════════════════════════════
//  КУКИ
// ═══════════════════════════════════════════════

async function loadCookies() {
  try {
    const raw    = await readFile(COOKIES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const arr    = Array.isArray(parsed) ? parsed : (parsed.cookies || []);
    return arr.filter(c => c.name && c.value);
  } catch {
    console.warn(`⚠️  Файл куки не найден или пуст: ${COOKIES_FILE}\n`);
    return [];
  }
}

async function saveCookies(page) {
  try {
    await ensureDir(path.dirname(COOKIES_FILE));
    const cookies = await page.cookies();
    await writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log('✓ Куки сохранены →', COOKIES_FILE);
  } catch (e) {
    console.error('Ошибка сохранения куки:', e.message);
  }
}

// ═══════════════════════════════════════════════
//  НАСТРОЙКА БРАУЗЕРА
// ═══════════════════════════════════════════════

async function configurePage(page, cookies) {
  await page.setUserAgent(CONFIG.userAgent);
  await page.setViewport(CONFIG.viewport);

  if (cookies && cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log(`✓ Установлено ${cookies.length} куки`);
  }

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver',  { get: () => false });
    Object.defineProperty(navigator, 'languages',  { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins',    { get: () => [1, 2, 3, 4, 5] });
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = p =>
      p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(p);
    window.chrome = { runtime: {} };
  });

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  });
}

// ═══════════════════════════════════════════════
//  ПАРСИНГ ОДНОЙ СТРАНИЦЫ — максимально широкие селекторы
// ═══════════════════════════════════════════════

async function scrapePage(page, pageNum) {
  try {
    await page.waitForSelector('#search, #rso, #main, #rcnt, .g, h3', { timeout: 12000 });
  } catch {
    console.log(`  ⚠️  Ничего не загрузилось за 12 сек`);
  }

  await sleep(800 + Math.random() * 600);

  // Всегда дампим для диагностики
  await debugDump(page, pageNum);

  return page.evaluate((pNum) => {

    // ── Извлечь description из узла ──────────────────────────────────
    function getDesc(node) {
      const sels = [
        '[data-sncf="1"]', '[data-content-feature="1"]',
        '.VwiC3b', '.yXK7lf', '.s3v9rd', '.st', '.lEBKkf',
        '.ITZIwc', '.FrIlee', '.x54gtf', '.MUxGbd', '.hgKElc',
        'div[style*="-webkit-line-clamp"]',
        'span[style*="-webkit-line-clamp"]',
      ];
      for (const s of sels) {
        const el = node.querySelector(s);
        if (el) {
          const t = el.textContent.trim();
          if (t.length > 15) return t.replace(/\s+/g, ' ');
        }
      }
      // Запасной: любой div без h3 внутри, с подходящей длиной
      for (const d of node.querySelectorAll('div, span')) {
        if (d.querySelector('h3')) continue;
        const t = d.textContent.trim();
        if (t.length > 40 && t.length < 600 && !t.includes('://')) {
          // Избегаем родительских дублей
          if (d.parentElement && d.parentElement.textContent.trim() === t) continue;
          return t.replace(/\s+/g, ' ');
        }
      }
      return '';
    }

    // ── Извлечь данные из набора узлов ───────────────────────────────
    function extractFromNodes(nodes) {
      const seen = new Set();
      const out  = [];
      let pos    = 1;

      for (const node of nodes) {
        // Фильтр рекламы
        if (
          node.closest('[data-text-ad]') ||
          node.querySelector('[data-text-ad]') ||
          node.classList.contains('ads-ad') ||
          node.querySelector('[data-ad-slot]')
        ) continue;

        // Ссылка
        const linkEl =
          node.querySelector('a[href][jsname]') ||
          node.querySelector('a[ping]')          ||
          node.querySelector('a[data-ved]')      ||
          node.querySelector('h3 a')             ||
          node.querySelector('a[href^="https"]:not([role="button"])');

        const url = linkEl ? linkEl.href : '';
        if (!url || !url.startsWith('http')) continue;
        if (
          url.includes('google.com') ||
          url.includes('webcache.')  ||
          url.includes('translate.') ||
          url.includes('maps.')
        ) continue;
        if (seen.has(url)) continue;
        seen.add(url);

        const titleEl = node.querySelector('h3') || node.querySelector('[role="heading"]');
        const title   = titleEl ? titleEl.textContent.trim() : '';
        if (title.length < 3) continue;

        out.push({ page: pNum, position: pos++, url, title, description: getDesc(node) });
      }
      return out;
    }

    // ── Стратегия 1: классические .g внутри #rso / #search ───────────
    let nodes = [
      ...document.querySelectorAll('#rso .g'),
      ...document.querySelectorAll('#search .g'),
      ...document.querySelectorAll('.g[data-hveid]'),
      ...document.querySelectorAll('.g'),
    ];
    // Убираем дубли (один и тот же DOM-узел может матчиться несколькими селекторами)
    nodes = [...new Set(nodes)];
    let results = extractFromNodes(nodes);
    if (results.length > 0) return results;

    // ── Стратегия 2: ищем через h3 → поднимаемся к блоку результата ──
    const root = document.querySelector('#search') ||
                 document.querySelector('#main')   ||
                 document.querySelector('#rcnt')   ||
                 document.body;

    const blockNodes = [...root.querySelectorAll('h3')].map(h3 => {
      let node = h3;
      for (let i = 0; i < 10; i++) {
        if (!node.parentElement) break;
        node = node.parentElement;
        if (
          node.dataset.hveid    ||
          node.dataset.sokoban  ||
          node.classList.contains('g') ||
          node.id === 'rso'
        ) break;
      }
      return node;
    });
    results = extractFromNodes([...new Set(blockNodes)]);
    if (results.length > 0) return results;

    // ── Стратегия 3: грубый сбор всех внешних ссылок со страницы ─────
    // (последний резерв — не идеально, но хоть что-то)
    const seen3 = new Set();
    const raw   = [];
    let pos3    = 1;
    for (const a of document.querySelectorAll('a[href]')) {
      const url = a.href;
      if (!url.startsWith('http') || url.includes('google.com') || seen3.has(url)) continue;
      seen3.add(url);
      const title = a.textContent.trim();
      if (title.length < 5) continue;
      raw.push({ page: pNum, position: pos3++, url, title, description: '' });
      if (raw.length >= 30) break;
    }
    return raw;
  }, pageNum);
}

// ═══════════════════════════════════════════════
//  СЛЕДУЮЩАЯ СТРАНИЦА
// ═══════════════════════════════════════════════

async function goNextPage(page) {
  try {
    const btn = await page.$(
      '#pnnext, ' +
      'a[aria-label*="Next"], ' +
      'a[aria-label*="Следующая"], ' +
      'a[aria-label*="следующая"], ' +
      'td.navend a'
    );
    if (!btn) return false;
    await btn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════
//  CSV
// ═══════════════════════════════════════════════

const escCSV = v => {
  if (v == null) return '';
  const s = String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
};

async function saveCSV(rows, periodLabel = '', dateFrom = '', dateTo = '') {
  await ensureDir(RESULTS_DIR);
  const now   = new Date();
  const stamp = `${now.toISOString().split('T')[0]}_${now.toTimeString().slice(0,8).replace(/:/g,'-')}`;
  const periodSlug = periodLabel
    ? '_' + periodLabel.replace(/[^а-яёa-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase()
    : '';
  const file = path.join(RESULTS_DIR, `ddosguard${periodSlug}_${stamp}.csv`);

  const header = 'Домен,Страница,Позиция,Начало периода,Конец периода,URL,Заголовок,Описание\n';
  const body   = rows.map(r => {
    let domain = '';
    try { domain = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    return [
      escCSV(domain),
      r.page,
      r.position,
      escCSV(dateFrom),
      escCSV(dateTo),
      escCSV(r.url),
      escCSV(r.title),
      escCSV(r.description),
    ].join(',');
  }).join('\n');

  await writeFile(file, '\uFEFF' + header + body, 'utf-8');
  console.log(`\n💾 Сохранено → ${file}`);
  console.log(`   Страниц: ${rows.length ? rows[rows.length-1].page : 0}  |  Записей: ${rows.length}`);
  return file;
}

// ═══════════════════════════════════════════════
//  ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════

async function main() {
  let browser;
  const all = [];

  // Объявляем снаружи try — чтобы были доступны в onExit и catch
  let period   = null;
  let dateFrom = '';
  let dateTo   = '';

  const cleanup = () => {
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
      process.stdin.pause();
    }
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('keypress');
  };

  const onExit = async () => {
    console.log('\n⚠️  Прерывание — сохраняем собранное...');
    if (all.length) await saveCSV(all, period ? period.label : '', dateFrom, dateTo);
    if (browser) await browser.close();
    cleanup();
    process.exit(0);
  };
  process.on('SIGINT',  onExit);
  process.on('SIGTERM', onExit);

  try {
    initHotkeys();
    const mode = await selectMode();
    period = await selectPeriod();

    // Строим tbs-параметр и вычисляем даты периода
    let tbsParam = '';

    if (period.tbs === 'custom') {
      const custom = await inputCustomDates();
      tbsParam = custom.tbs;
      dateFrom = custom.dateFrom;
      dateTo   = custom.dateTo;
    } else if (period.tbs) {
      tbsParam = period.tbs;
      ({ dateFrom, dateTo } = calcPeriodDates(period.tbs));
    }

    let cookies = [];
    if (mode === MODES.COOKIE) {
      cookies = await loadCookies();
      console.log(cookies.length ? `✓ Загружено ${cookies.length} куки\n` : '⚠️  Куки пусты, работаем без них\n');
    } else {
      console.log('🕶️  Режим инкогнито, куки не используются\n');
    }

    const args = [
      '--no-sandbox', '--start-maximized', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ];
    if (mode === MODES.INCOGNITO) args.push('--incognito');

    browser = await puppeteer.launch({ headless: false, args });
    const page = await browser.newPage();
    await configurePage(page, mode === MODES.COOKIE ? cookies : []);

    const tbsQuery = tbsParam ? `&tbs=${encodeURIComponent(tbsParam)}` : '';
    const startUrl = `https://www.google.com/search?q=${encodeURIComponent(SEARCH_QUERY)}&hl=ru&num=10${tbsQuery}`;
    console.log(`🔍 Запрос: ${SEARCH_QUERY}`);
    console.log(`📅 Период: ${period.label}`);
    console.log(`🌐 URL:    ${startUrl}\n`);
    await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    let pageNum = 1;

    while (true) {
      if (isPaused()) {
        console.log(`\n${pausePrefix()}Ожидание возобновления...`);
        while (isPaused()) await sleep(100);
      }

      console.log(`\n${pausePrefix()}┌─── Страница ${pageNum} ${'─'.repeat(35)}`);

      const vp = page.viewport();
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
        await page.mouse.move(
          Math.floor(Math.random() * vp.width),
          Math.floor(Math.random() * vp.height),
          { steps: 10 + Math.floor(Math.random() * 10) }
        );
        await sleep(100 + Math.random() * 200);
      }

      const pageRows = await scrapePage(page, pageNum);
      console.log(`${pausePrefix()}│  Найдено: ${pageRows.length} результатов`);

      if (pageRows.length < CONFIG.minResultsThreshold) {
        console.warn(`\n${pausePrefix()}│  ⚠️  Мало результатов (${pageRows.length}).`);
        console.warn(`${pausePrefix()}│     Проверьте debug/page_${pageNum}_info.json`);
        console.warn(`${pausePrefix()}│     Если в браузере видна капча — пройдите её и нажмите Enter.`);
        console.warn(`${pausePrefix()}│     Если результаты видны — напишите мне содержимое page_${pageNum}_info.json\n`);

        await waitForEnter('После проверки / прохождения капчи');

        if (mode === MODES.COOKIE) {
          await saveCookies(page);
        }

        console.log('🔄 Повторная попытка...');
        const retry = await scrapePage(page, pageNum);
        console.log(`   Повтор: ${retry.length} результатов`);

        if (retry.length >= CONFIG.minResultsThreshold) {
          all.push(...retry);
        } else {
          console.warn(`   Страница ${pageNum} пропущена.`);
        }
      } else {
        all.push(...pageRows);
      }

      console.log(`${pausePrefix()}│  📊 Всего собрано: ${all.length}`);
      console.log(`${pausePrefix()}└${'─'.repeat(50)}`);

      const delay = CONFIG.pageDelay[0] + Math.random() * (CONFIG.pageDelay[1] - CONFIG.pageDelay[0]);
      console.log(`${pausePrefix()}⏱  Пауза ${(delay / 1000).toFixed(1)} сек...`);

      await Promise.all([
        randomMouseMovement(page, delay),
        sleepWithPauseCheck(delay),
      ]);

      const hasNext = await goNextPage(page);
      if (!hasNext) {
        console.log('\n✅ Конец пагинации.');
        break;
      }
      pageNum++;
    }

    if (all.length > 0) {
      await saveCSV(all, period.label, dateFrom, dateTo);
    } else {
      console.log('\n⚠️  Ничего не собрано.');
      console.log('   Скиньте содержимое файла debug/page_1_info.json — исправим селекторы.');
    }

    console.log(`\n✅ Готово! Страниц: ${pageNum} | Записей: ${all.length}\n`);

  } catch (err) {
    console.error('\n❌ Критическая ошибка:', err.message);
    if (all.length) await saveCSV(all, period ? period.label : '', dateFrom, dateTo);
  } finally {
    if (browser) await browser.close();
    cleanup();
  }
}

main();
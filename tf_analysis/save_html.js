// Автоматически сохраняет HTML страниц по списку URL (и/или поисковым запросам)
// в tf_analysis/input/<папка>/ — заменяет ручной шаг "открыть в браузере →
// Ctrl+S → Веб-страница, только HTML" из README для сайтов, которые не
// блокируют автоматические заходы. Если сайт блокирует (капча/бот-защита) —
// используйте ручной способ, как раньше.
//
// Запуск:
//   node tf_analysis/save_html.js
//
// Имя папки берётся прямо из scripts/save_html_urls.txt: строка, которая НЕ
// похожа на URL и не является меткой query:/url: — это название группы
// (= имя папки в input/). Всё, что идёт после нового заголовка, относится к
// этой группе — до следующего такого заголовка. Пустые строки не важны.
//
// Внутри группы:
//   own: https://...   — своя страница (сохранится как own.html)
//   query:              — дальше идут поисковые запросы, по одному на строку;
//                         для каждого берётся ТОП-10 Google+Яндекс (через уже
//                         существующий tf_analysis/lib/fetchTop10.js) — их
//                         результаты добавляются к списку страниц для сохранения
//   url:                — дальше идут URL напрямую, по одному на строку
//                         (закрывает секцию query: — без явного url: следующая
//                         не-URL строка внутри query: тоже считалась бы запросом)
// Без меток query:/url: работает как раньше — просто список URL под заголовком.
//
// Пример:
//   защищённый сервер от ddos
//   own: https://ddos-guard.ru/
//   query:
//   защита сервера от ddos
//   аренда сервера с защитой
//   url:
//   https://firstvds.ru/technology/antiddos
//   https://k2.cloud/products/anti-ddos/

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { INPUT_DIR, SAVE_HTML_URLS_FILE } from './config.js';
import { fetchTop10 } from './lib/fetchTop10.js';

puppeteer.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Разбор списка на группы ────────────────────────────────────────────────

const URL_RE = /^https?:\/\//i;
const QUERY_MARKER_RE = /^query:/i;
const URL_MARKER_RE = /^url:/i;
const OWN_RE = /^own:\s*(.+)$/i;

// Windows не разрешает \ / : * ? " < > | в имени папки — остальное (кириллица,
// пробелы) можно оставлять как есть
function sanitizeFolderName(title) {
  return title.replace(/[\\/:*?"<>|]/g, '_').trim();
}

// Простой автомат состояний, а не "не-URL строка = новая группа" — иначе
// строки самих запросов внутри query: (тоже не похожие на URL) ломали бы
// парсинг. Режим 'url' — умолчание (в т.ч. сразу после заголовка, для
// обратной совместимости со старым плоским форматом), 'query' включается
// меткой "query:" и выключается только меткой "url:".
async function readUrlGroups(filePath) {
  if (!existsSync(filePath)) {
    console.error(`❌ Файл со списком URL не найден: ${filePath}`);
    console.error('   Создайте его (см. пример в save_html_urls.txt) и запустите снова.');
    process.exit(1);
  }

  const lines = (await readFile(filePath, 'utf-8'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const groups = [];
  let current = null;
  let mode = 'url';

  for (const line of lines) {
    const ownMatch = line.match(OWN_RE);
    if (ownMatch) {
      if (!current) {
        console.warn(`⚠️  "own:" встретилась раньше первой строки-названия папки, пропускаю: ${line}`);
        continue;
      }
      if (current.ownUrl) {
        console.warn(`⚠️  В группе "${current.title}" уже есть "own:" — доп. строку считаю конкурентом`);
        current.competitorUrls.push(ownMatch[1].trim());
      } else {
        current.ownUrl = ownMatch[1].trim();
      }
      continue;
    }

    if (QUERY_MARKER_RE.test(line)) {
      if (!current) {
        console.warn(`⚠️  "query:" встретилась раньше первой строки-названия папки, пропускаю`);
        continue;
      }
      mode = 'query';
      continue;
    }

    if (URL_MARKER_RE.test(line)) {
      if (!current) {
        console.warn(`⚠️  "url:" встретилась раньше первой строки-названия папки, пропускаю`);
        continue;
      }
      mode = 'url';
      continue;
    }

    if (mode === 'query') {
      current.queries.push(line);
      continue;
    }

    // mode === 'url'
    if (!URL_RE.test(line)) {
      // Не похоже на URL и мы не внутри query: — это заголовок новой группы
      current = { title: line, folderName: sanitizeFolderName(line), ownUrl: null, competitorUrls: [], queries: [] };
      groups.push(current);
      mode = 'url';
      continue;
    }

    if (!current) {
      console.warn(`⚠️  URL встретился раньше первой строки-названия папки, пропускаю: ${line}`);
      continue;
    }

    current.competitorUrls.push(line);
  }

  return groups.filter((g) => g.ownUrl || g.competitorUrls.length > 0 || g.queries.length > 0);
}

// ─── Имена файлов ───────────────────────────────────────────────────────────

// example.ru/path -> example-ru.html; при повторе домена — example-ru_2.html
function filenameFromUrl(url, usedNames) {
  let base;
  try {
    base = new URL(url).hostname.replace(/^www\./i, '').replace(/[^a-zA-Z0-9]+/g, '-');
  } catch {
    base = 'page';
  }
  base = base.replace(/^-+|-+$/g, '') || 'page';

  let name = `${base}.html`;
  let counter = 2;
  while (usedNames.has(name)) {
    name = `${base}_${counter}.html`;
    counter++;
  }
  usedNames.add(name);
  return name;
}

// ─── Сохранение одной страницы ──────────────────────────────────────────────

async function saveOne(page, url, destPath) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const html = await page.content();
  await writeFile(destPath, html, 'utf-8');
}

// ─── Обработка одной группы (= одна папка) ──────────────────────────────────

async function processGroup(page, group) {
  const targetDir = path.join(INPUT_DIR, group.folderName);

  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
    console.log(`📁 Создана папка: ${targetDir}`);
  } else {
    console.log(`📁 Папка уже существует, сохраняю в неё: ${targetDir}`);
  }

  if (!group.ownUrl) {
    console.warn('⚠️  Нет строки "own:" — own.html сохранён не будет (для tf_analysis/index.js он обязателен).');
  }

  // Собираем URL со всех источников: явные url: + ТОП-10 по каждому query:
  const allUrls = [...group.competitorUrls];

  if (group.queries.length > 0) {
    console.log(`🔎 Запросов: ${group.queries.length} — получаю ТОП-10 по каждому...`);
    for (const query of group.queries) {
      console.log(`   "${query}"`);
      let found = [];
      try {
        found = await fetchTop10(page, query);
      } catch (error) {
        console.warn(`   ⚠️  Не удалось получить ТОП-10 по запросу "${query}": ${error.message}`);
      }
      allUrls.push(...found.map((r) => r.url));
    }
    // fetchTop10 переопределяет UA/заголовки под Google/Яндекс — возвращаем свой перед сохранением HTML
    await page.setUserAgent(USER_AGENT);
  }

  // Дедуп (в т.ч. на случай, если один и тот же URL встретился в url: и в
  // результатах нескольких query:, или продублирован в самом списке) и
  // исключаем own, если он случайно попал в конкуренты
  const seenUrls = new Set();
  const dedupedUrls = allUrls.filter((url) => {
    if (url === group.ownUrl) return false;
    if (seenUrls.has(url)) return false;
    seenUrls.add(url);
    return true;
  });

  const jobs = [];
  if (group.ownUrl) jobs.push({ url: group.ownUrl, filename: 'own.html', label: 'своя страница' });

  const usedNames = new Set(['own.html']);
  for (const url of dedupedUrls) {
    jobs.push({ url, filename: filenameFromUrl(url, usedNames), label: 'конкурент' });
  }

  let ok = 0;
  let failed = 0;

  for (const { url, filename, label } of jobs) {
    const destPath = path.join(targetDir, filename);
    console.log(`🌐 [${label}] ${url}`);
    try {
      await saveOne(page, url, destPath);
      console.log(`   ✓ Сохранено → ${filename}`);
      ok++;
    } catch (error) {
      console.warn(`   ❌ Не удалось: ${error.message}`);
      console.warn(`      (сайт мог заблокировать автоматический заход — сохраните вручную: Ctrl+S → "Веб-страница, только HTML" → ${filename})`);
      failed++;
    }
  }

  return { ok, failed, hasOwn: !!group.ownUrl, targetDir };
}

// ─── Главная функция ────────────────────────────────────────────────────────

async function main() {
  const groups = await readUrlGroups(SAVE_HTML_URLS_FILE);

  if (groups.length === 0) {
    console.error(`❌ В ${SAVE_HTML_URLS_FILE} нет ни одной группы с URL.`);
    console.error('   Добавьте строку-название папки, а под ней — URL (см. пример в файле).');
    process.exit(1);
  }

  console.log(`\n📋 Групп (папок) для обработки: ${groups.length}`);
  groups.forEach((g, i) => {
    const queryPart = g.queries.length ? `, ${g.queries.length} запрос(ов)` : '';
    console.log(`   ${i + 1}. "${g.title}" — ${(g.ownUrl ? 1 : 0) + g.competitorUrls.length} URL${queryPart}`);
  });

  // headless: false — при реальном поиске (query:) headless сильно повышает
  // риск капчи, как и во всех остальных поисковых скриптах проекта
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--start-maximized', '--disable-blink-features=AutomationControlled'],
  });

  const summaries = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    for (const group of groups) {
      console.log(`\n═══ "${group.title}" ═══`);
      const result = await processGroup(page, group);
      summaries.push({ title: group.title, ...result });
    }
  } finally {
    await browser.close();
  }

  console.log('\n════════════════════════════════════════════════');
  for (const s of summaries) {
    console.log(`"${s.title}": ✅ ${s.ok} сохранено, ❌ ${s.failed} ошибок → ${s.targetDir}`);
  }
  const needsQuery = summaries.filter((s) => s.hasOwn).map((s) => s.title);
  if (needsQuery.length > 0) {
    console.log(`\nДобавьте query.txt в каждую готовую папку и запустите: node tf_analysis/index.js`);
  }
  console.log('════════════════════════════════════════════════\n');
}

main().catch((error) => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});

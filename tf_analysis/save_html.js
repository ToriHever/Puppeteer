// Автоматически сохраняет HTML страниц по списку URL в tf_analysis/input/<папка>/ —
// заменяет ручной шаг "открыть в браузере → Ctrl+S → Веб-страница, только HTML"
// из README для сайтов, которые не блокируют автоматические заходы. Если сайт
// блокирует (капча/бот-защита) — используйте ручной способ, как раньше.
//
// Запуск:
//   node tf_analysis/save_html.js
//
// Имя папки берётся прямо из scripts/save_html_urls.txt: строка, которая НЕ
// похожа на URL — это название группы (= имя папки в input/), все URL после
// неё и до следующего такого названия относятся к этой группе. Пустые строки
// внутри группы не важны. Опционально одну строку в группе можно пометить
// префиксом "own:" — она сохранится как own.html, остальные — как <домен>.html.
//
// Пример:
//   защищённый сервер
//   https://ddos-guard.ru/
//   https://servero.ru/articles-and-sales/server-bezopasnosti.html
//
//   защищённый сервер от ddos
//   own: https://ddos-guard.ru/blog/kak-zashchitit-server-ot-ddos
//   https://firstvds.ru/ddos-protection

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { INPUT_DIR, SAVE_HTML_URLS_FILE } from './config.js';

puppeteer.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Разбор списка на группы ────────────────────────────────────────────────

const URL_RE = /^https?:\/\//i;

// Windows не разрешает \ / : * ? " < > | в имени папки — остальное (кириллица,
// пробелы) можно оставлять как есть
function sanitizeFolderName(title) {
  return title.replace(/[\\/:*?"<>|]/g, '_').trim();
}

// Строка вида "own: https://..." внутри группы — своя страница, остальные —
// конкуренты. Не-URL строка начинает новую группу (её текст = имя папки).
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

  for (const line of lines) {
    const ownMatch = line.match(/^own:\s*(.+)$/i);
    const isUrlLine = ownMatch ? URL_RE.test(ownMatch[1].trim()) : URL_RE.test(line);

    if (!isUrlLine) {
      // Строка не похожа на URL — это заголовок новой группы (имя папки)
      current = { title: line, folderName: sanitizeFolderName(line), ownUrl: null, competitorUrls: [] };
      groups.push(current);
      continue;
    }

    if (!current) {
      console.warn(`⚠️  URL встретился раньше первой строки-названия папки, пропускаю: ${line}`);
      continue;
    }

    if (ownMatch) {
      if (current.ownUrl) {
        console.warn(`⚠️  В группе "${current.title}" уже есть "own:" — доп. строку считаю конкурентом`);
        current.competitorUrls.push(ownMatch[1].trim());
      } else {
        current.ownUrl = ownMatch[1].trim();
      }
    } else {
      current.competitorUrls.push(line);
    }
  }

  return groups.filter((g) => g.ownUrl || g.competitorUrls.length > 0);
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

  const jobs = [];
  if (group.ownUrl) jobs.push({ url: group.ownUrl, filename: 'own.html', label: 'своя страница' });

  const usedNames = new Set(['own.html']);
  for (const url of group.competitorUrls) {
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
  groups.forEach((g, i) => console.log(`   ${i + 1}. "${g.title}" — ${(g.ownUrl ? 1 : 0) + g.competitorUrls.length} URL`));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
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

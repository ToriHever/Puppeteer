// Автоматически сохраняет HTML страниц по списку URL в tf_analysis/input/<DS>/ —
// заменяет ручной шаг "открыть в браузере → Ctrl+S → Веб-страница, только HTML"
// из README для сайтов, которые не блокируют автоматические заходы. Если сайт
// блокирует (капча/бот-защита) — используйте ручной способ, как раньше.
//
// Запуск:
//   node tf_analysis/save_html.js <имя_папки>
//   node tf_analysis/save_html.js            (спросит имя папки в консоли)
//
// URL берутся из tf_analysis/scripts/save_html_urls.txt — строка с префиксом
// "own:" сохранится как own.html, остальные — как <домен>.html (конкуренты).

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import readline from 'readline';
import { INPUT_DIR, SAVE_HTML_URLS_FILE } from './config.js';

puppeteer.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Имя папки DS ───────────────────────────────────────────────────────────

function askFolderName() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Введите имя папки для сохранения (tf_analysis/input/<имя>): ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function resolveFolderName() {
  const fromArg = process.argv[2]?.trim();
  if (fromArg) return fromArg;

  const fromPrompt = await askFolderName();
  if (!fromPrompt) {
    console.error('❌ Имя папки не указано.');
    process.exit(1);
  }
  return fromPrompt;
}

// ─── Список URL ─────────────────────────────────────────────────────────────

// Строка вида "own: https://..." — своя страница, остальные — конкуренты
async function readUrlList(filePath) {
  if (!existsSync(filePath)) {
    console.error(`❌ Файл со списком URL не найден: ${filePath}`);
    console.error('   Создайте его (см. пример в save_html_urls.txt) и запустите снова.');
    process.exit(1);
  }

  const lines = (await readFile(filePath, 'utf-8'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  let ownUrl = null;
  const competitorUrls = [];

  for (const line of lines) {
    const ownMatch = line.match(/^own:\s*(.+)$/i);
    if (ownMatch) {
      if (ownUrl) {
        console.warn(`⚠️  Найдено больше одной строки "own:" — использую первую, остальные считаю конкурентами`);
        competitorUrls.push(ownMatch[1].trim());
        continue;
      }
      ownUrl = ownMatch[1].trim();
    } else {
      competitorUrls.push(line);
    }
  }

  return { ownUrl, competitorUrls };
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

// ─── Главная функция ────────────────────────────────────────────────────────

async function main() {
  const folderName = await resolveFolderName();
  const targetDir = path.join(INPUT_DIR, folderName);

  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
    console.log(`📁 Создана папка: ${targetDir}`);
  } else {
    console.log(`📁 Папка уже существует, сохраняю в неё: ${targetDir}`);
  }

  const { ownUrl, competitorUrls } = await readUrlList(SAVE_HTML_URLS_FILE);

  if (!ownUrl && competitorUrls.length === 0) {
    console.error(`❌ В ${SAVE_HTML_URLS_FILE} нет ни одного URL.`);
    process.exit(1);
  }
  if (!ownUrl) {
    console.warn('⚠️  Нет строки "own:" — own.html сохранён не будет (для tf_analysis/index.js он обязателен).');
  }

  const jobs = [];
  if (ownUrl) jobs.push({ url: ownUrl, filename: 'own.html', label: 'своя страница' });

  const usedNames = new Set(['own.html']);
  for (const url of competitorUrls) {
    jobs.push({ url, filename: filenameFromUrl(url, usedNames), label: 'конкурент' });
  }

  console.log(`\n🔎 К сохранению: ${jobs.length} страниц(ы)\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  let ok = 0;
  let failed = 0;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

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
  } finally {
    await browser.close();
  }

  console.log('\n════════════════════════════════════════════════');
  console.log(`✅ Сохранено : ${ok}`);
  console.log(`❌ Ошибок    : ${failed}`);
  console.log(`📁 Папка     : ${targetDir}`);
  if (failed === 0 && ownUrl) {
    console.log('\nДобавьте query.txt в эту папку и запустите: node tf_analysis/index.js');
  }
  console.log('════════════════════════════════════════════════\n');
}

main().catch((error) => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});

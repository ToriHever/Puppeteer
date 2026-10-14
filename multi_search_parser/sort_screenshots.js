import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Раскладывает скриншоты multi_search_parser по папкам-заголовкам.
//
// Список (файл, по умолчанию groups.txt в текущей папке):
//   Заголовок: запрос, запрос, запрос. Заголовок: запрос, запрос.
// Группы можно разделять точкой или переносом строки.
//
// Скриншоты берутся из results/google/screenshots и results/yandex/screenshots;
// папки-заголовки создаются внутри той же папки скриншотов, откуда взят файл.
// Всё, что не нашлось в списке запросов, остаётся на месте.
//
// Запуск: node sort_screenshots.js [файл_списка] [--copy] [--src <папка>]...

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINES = ['google', 'yandex'];

// Та же чистка имени, что и в utils/screenshot.js
function sanitizeForFilename(text) {
  return text
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

const norm = (q) => sanitizeForFilename(q).toLowerCase();

// "запрос ДД ММ ГГГГ[ google|yandex].png" -> "запрос"
const queryFromFile = (file) =>
  file.replace(/\.png$/i, '').replace(/\s(google|yandex)$/i, '').replace(/\s\d{2} \d{2} \d{4}$/, '');

function parseArgs(argv) {
  const opts = { listFile: 'groups.txt', copy: false, srcs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--copy') opts.copy = true;
    else if (argv[i] === '--src') opts.srcs.push(argv[++i]);
    else opts.listFile = argv[i];
  }
  return opts;
}

// Возвращает Map: нормализованный запрос -> имя папки
function parseGroups(text) {
  const map = new Map();
  const groups = text.split(/\r?\n|\.(?=\s|$)/);
  for (const raw of groups) {
    const idx = raw.indexOf(':');
    if (idx === -1) continue;
    const title = sanitizeForFilename(raw.slice(0, idx));
    if (!title) continue;
    const queries = raw.slice(idx + 1).split(/[,;]/).map((q) => q.trim()).filter(Boolean);
    for (const q of queries) map.set(norm(q), title);
  }
  return map;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const listPath = path.resolve(cwd, opts.listFile);

  if (!fs.existsSync(listPath)) {
    console.error(`Не найден файл со списком: ${listPath}`);
    console.error('Формат: Заголовок: запрос, запрос. Заголовок: запрос, запрос.');
    process.exit(1);
  }

  const groups = parseGroups(fs.readFileSync(listPath, 'utf8').replace(/^﻿/, ''));
  if (groups.size === 0) {
    console.error('В списке не найдено ни одной группы вида "Заголовок: запрос, запрос".');
    process.exit(1);
  }

  const sources = opts.srcs.length
    ? opts.srcs.map((s) => ({ engine: path.basename(path.dirname(path.resolve(cwd, s))), dir: path.resolve(cwd, s) }))
    : ENGINES.map((e) => ({ engine: e, dir: path.join(__dirname, 'results', e, 'screenshots') }));

  // Собираем совпадения: запрос + дата из имени файла
  const found = [];
  for (const { engine, dir } of sources) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.png$/i.test(file)) continue;
      const base = queryFromFile(file);
      const title = groups.get(norm(base));
      if (title) found.push({ engine, dir, file, title });
    }
  }

  // Папки создаются внутри папки скриншотов своего поисковика
  const matchedQueries = new Set();
  let done = 0;
  for (const f of found) {
    const destDir = path.join(f.dir, f.title);
    fs.mkdirSync(destDir, { recursive: true });

    const dest = path.join(destDir, f.file);
    const src = path.join(f.dir, f.file);
    if (fs.existsSync(dest)) {
      console.log(`Пропуск (уже есть): [${f.engine}] ${f.title}/${f.file}`);
      continue;
    }
    if (opts.copy) fs.copyFileSync(src, dest);
    else fs.renameSync(src, dest);
    console.log(`${opts.copy ? 'Копия' : 'Перенос'}: [${f.engine}] ${f.file} -> ${f.title}/`);
    matchedQueries.add(norm(queryFromFile(f.file)));
    done++;
  }

  const missing = [...groups.keys()].filter((q) => !matchedQueries.has(q));
  console.log(`\nГотово: ${done} файл(ов). Запросов без скриншота: ${missing.length}`);
  for (const q of missing) console.log(`  не найдено: ${q}`);
}

main();

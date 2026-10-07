// Собирает все CSV из папки результатов в одну книгу Excel: каждый CSV — отдельная вкладка.
//
// Запуск вручную:
//   node merge_to_xlsx.js              — последняя папка results/<дата>/
//   node merge_to_xlsx.js 2026-10-06   — конкретная дата (или путь к любой папке с CSV)
//
// Автоматически вызывается в конце index.js для папки текущего запуска.
// Книга сохраняется в ту же папку: <дата>_все.xlsx

import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { RESULTS_DIR } from './config.js';

const MAX_SHEET_NAME = 31; // лимит Excel
const INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;

// Разбор CSV с кавычками (формат, который пишет report.js); BOM отбрасывается
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

// Числа пишем как числа, чтобы работали сортировка и фильтры; "5/5" и т.п. остаются текстом
function toCell(value) {
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

// Сокращает строку до max символов, убирая середину: «защита от ddos…слова) Яндекс».
// Начало и конец сохраняются — именно в конце обычно отличаются варианты (Яндекс, +=4 слова).
function ellipsize(str, max) {
  if (str.length <= max) return str;
  const head = Math.ceil((max - 1) / 2), tail = Math.floor((max - 1) / 2);
  return str.slice(0, head) + '…' + (tail > 0 ? str.slice(-tail) : '');
}

// Имя вкладки ≤ 31 символа и уникальное. Суффикс типа файла (_результат/_summary/_кластеры)
// сохраняем, сокращаем только имя папки; при совпадении добавляем номер.
function makeSheetName(fileBase, used) {
  const clean = fileBase.replace(INVALID_SHEET_CHARS, '');
  const cut = clean.lastIndexOf('_');
  const suffix = cut > 0 ? clean.slice(cut) : '';
  const stem = cut > 0 ? clean.slice(0, cut) : clean;

  let name = ellipsize(stem, Math.max(1, MAX_SHEET_NAME - suffix.length)) + suffix;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const tail = `${suffix}~${n}`;
    name = ellipsize(stem, Math.max(1, MAX_SHEET_NAME - tail.length)) + tail;
  }
  used.add(name.toLowerCase());
  return name;
}

function addSheet(workbook, name, rows) {
  const sheet = workbook.addWorksheet(name);
  rows.forEach(r => sheet.addRow(r.map(toCell)));
  if (rows.length === 0) return sheet;

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rows[0].length } };
  sheet.columns.forEach((col, i) => {
    const longest = rows.reduce((m, r) => Math.max(m, String(r[i] ?? '').length), 0);
    col.width = Math.min(60, Math.max(10, longest + 2));
  });
  return sheet;
}

// Объединяет все *.csv из dir в dir/<имя папки>_все.xlsx. Возвращает путь к файлу или null.
export async function mergeCsvToXlsx(dir) {
  const files = (await readdir(dir)).filter(f => f.toLowerCase().endsWith('.csv')).sort((a, b) => a.localeCompare(b, 'ru'));
  if (files.length === 0) {
    console.warn(`⚠️ В ${dir} нет CSV-файлов, книга Excel не создана`);
    return null;
  }

  const workbook = new ExcelJS.Workbook();
  const used = new Set(['оглавление']);
  const index = [['Вкладка', 'Файл']];
  const sheets = [];

  for (const file of files) {
    const rows = parseCSV(await readFile(path.join(dir, file), 'utf-8'));
    const sheetName = makeSheetName(path.basename(file, path.extname(file)), used);
    sheets.push({ sheetName, rows });
    index.push([sheetName, file]);
  }

  // Первая вкладка — оглавление: короткие имена вкладок могут быть обрезаны, здесь полные имена файлов
  addSheet(workbook, 'Оглавление', index);
  for (const { sheetName, rows } of sheets) addSheet(workbook, sheetName, rows);

  const outPath = path.join(dir, `${path.basename(dir)}_все.xlsx`);
  try {
    await workbook.xlsx.writeFile(outPath);
  } catch (error) {
    if (error.code === 'EBUSY' || error.code === 'EPERM') {
      throw new Error(`файл ${outPath} открыт в Excel — закройте его и запустите "node merge_to_xlsx.js" снова`);
    }
    throw error;
  }
  console.log(`✓ Книга Excel сохранена (${files.length} вкладок): ${outPath}`);
  return outPath;
}

async function latestResultsDir() {
  const entries = await readdir(RESULTS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name)).map(e => e.name).sort();
  if (dirs.length === 0) throw new Error(`В ${RESULTS_DIR} нет папок с результатами`);
  return path.join(RESULTS_DIR, dirs[dirs.length - 1]);
}

// CLI: срабатывает только при прямом запуске файла, не при импорте из index.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const arg = process.argv[2];
    let dir = arg ? (path.isAbsolute(arg) ? arg : path.join(RESULTS_DIR, arg)) : await latestResultsDir();
    await stat(dir);
    await mergeCsvToXlsx(dir);
  })().catch(error => {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  });
}

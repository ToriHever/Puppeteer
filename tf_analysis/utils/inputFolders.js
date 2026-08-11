import { readdir, readFile } from 'fs/promises';
import path from 'path';

const MAIN_SECTION_NAMES = new Set(['главные', 'главное', 'основные', 'main']);
const LSI_SECTION_NAMES = new Set(['lsi', 'лси']);

// Разбирает query.txt: первая строка — запрос, дальше опциональные секции
// [Главные] и [LSI] со словами/фразами в исходной форме (по одной на строку или через запятую).
function parseQueryFile(content) {
  const lines = content.split('\n').map(l => l.trim());

  let query = '';
  let section = null;
  const mainPhrases = [];
  const lsiPhrases = [];

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      const name = sectionMatch[1].trim().toLowerCase();
      if (MAIN_SECTION_NAMES.has(name)) section = 'main';
      else if (LSI_SECTION_NAMES.has(name)) section = 'lsi';
      else section = null;
      continue;
    }

    if (!query && !section) {
      query = line;
      continue;
    }

    const phrases = line.split(',').map(p => p.trim()).filter(Boolean);
    if (section === 'main') mainPhrases.push(...phrases);
    else if (section === 'lsi') lsiPhrases.push(...phrases);
  }

  return { query, mainPhrases, lsiPhrases };
}

// Сканирует tf_analysis/input/<любая-папка>/ — в каждой ожидается query.txt и own.html,
// остальные *.html в этой же папке считаются страницами конкурентов.
export async function readInputTasks(inputDir) {
  let entries;
  try {
    entries = await readdir(inputDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const tasks = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(inputDir, entry.name);
    const queryPath = path.join(dir, 'query.txt');
    const ownPath = path.join(dir, 'own.html');

    let query, mainPhrases, lsiPhrases;
    try {
      const content = await readFile(queryPath, 'utf-8');
      ({ query, mainPhrases, lsiPhrases } = parseQueryFile(content));
    } catch {
      console.warn(`⚠️ Пропущена папка ${dir}: нет query.txt`);
      continue;
    }

    if (!query) {
      console.warn(`⚠️ Пропущена папка ${dir}: query.txt пуст`);
      continue;
    }

    const files = await readdir(dir);
    const hasOwn = files.includes('own.html');
    if (!hasOwn) {
      console.warn(`⚠️ Пропущена папка ${dir}: нет own.html`);
      continue;
    }

    const competitorPaths = files
      .filter(f => f.toLowerCase().endsWith('.html') && f !== 'own.html')
      .map(f => path.join(dir, f));

    if (competitorPaths.length === 0) {
      console.warn(`⚠️ Пропущена папка ${dir}: нет ни одного HTML-файла конкурента`);
      continue;
    }

    tasks.push({ query, folder: entry.name, ownPath, competitorPaths, mainPhrases, lsiPhrases });
  }

  return tasks;
}

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

// Запрос из имени папки: убираем пометки в скобках «(+=4 слова)» и суффикс поисковика («Яндекс»/«Google»)
function queryFromFolderName(name) {
  const cleaned = name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+(яндекс|google|гугл)\s*$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || name;
}

// Сканирует tf_analysis/input/<любая-папка>/ — в каждой ожидается файл запроса
// (необязателен; любое имя, расширение .txt) и own.html, остальные *.html в этой
// же папке считаются страницами конкурентов.
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
    const ownPath = path.join(dir, 'own.html');

    const files = await readdir(dir);

    // Файл запроса необязателен. Если .txt есть — берём его (при нескольких первый по алфавиту);
    // нет файла или в нём нет запроса — запросом становится имя папки, а главные/LSI-слова
    // скрипт определит сам по страницам ТОП-10.
    const txtFiles = files.filter(f => f.toLowerCase().endsWith('.txt')).sort();
    if (txtFiles.length > 1) {
      console.warn(`⚠️ В папке ${dir} несколько .txt файлов (${txtFiles.join(', ')}) — использую "${txtFiles[0]}"`);
    }

    let query = '', mainPhrases = [], lsiPhrases = [];
    if (txtFiles.length > 0) {
      try {
        const content = await readFile(path.join(dir, txtFiles[0]), 'utf-8');
        ({ query, mainPhrases, lsiPhrases } = parseQueryFile(content));
      } catch (error) {
        console.warn(`⚠️ Не удалось прочитать "${txtFiles[0]}" в ${dir} (${error.message}) — запрос возьмём из имени папки`);
      }
    }
    if (!query) {
      query = queryFromFolderName(entry.name);
      console.log(`ℹ️ ${entry.name}: файла запроса нет — запрос "${query}" взят из имени папки, главные/LSI-слова определяются автоматически`);
    }

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

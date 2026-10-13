import { readdir, readFile, rename } from 'fs/promises';
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

// Переименовывает *.html в *.txt во всех папках input/*/ (содержимое не меняется — это тот же HTML-код).
// В папке со старым форматом файл запроса мог называться как угодно; чтобы он не превратился в «страницу»,
// первый такой .txt (по алфавиту, как и раньше) переименовывается в query.txt.
export async function convertHtmlToTxt(inputDir) {
  let entries;
  try {
    entries = await readdir(inputDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(inputDir, entry.name);
    const files = await readdir(dir);
    const htmlFiles = files.filter(f => f.toLowerCase().endsWith('.html'));
    if (htmlFiles.length === 0) continue;

    if (!files.includes('own.txt')) {
      const legacyQuery = files.filter(f => f.toLowerCase().endsWith('.txt')).sort();
      if (legacyQuery.length > 0 && !files.includes('query.txt')) {
        await rename(path.join(dir, legacyQuery[0]), path.join(dir, 'query.txt'));
        console.log(`↻ ${entry.name}: файл запроса "${legacyQuery[0]}" → query.txt`);
        legacyQuery.shift();
      }
      if (legacyQuery.length > 0 && !(legacyQuery.length === 1 && legacyQuery[0] === 'query.txt')) {
        console.warn(`⚠️ ${entry.name}: лишние .txt (${legacyQuery.filter(f => f !== 'query.txt').join(', ')}) будут считаться страницами конкурентов`);
      }
    }

    let renamed = 0;
    for (const file of htmlFiles) {
      const target = file.replace(/\.html$/i, '.txt');
      if (files.includes(target)) {
        console.warn(`⚠️ ${entry.name}: ${target} уже есть — ${file} не переименован`);
        continue;
      }
      await rename(path.join(dir, file), path.join(dir, target));
      renamed++;
    }
    console.log(`↻ ${entry.name}: переименовано .html → .txt: ${renamed}`);
  }
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
    const files = await readdir(dir);

    // Страницы могут храниться как .html (тогда файл запроса — любой .txt) или как .txt с HTML-кодом
    // (own.txt + <домен>.txt; тогда файл запроса — только query.txt)
    const txtPages = files.includes('own.txt');
    const pageExt = txtPages ? '.txt' : '.html';
    const ownName = `own${pageExt}`;
    const ownPath = path.join(dir, ownName);

    // Файл запроса необязателен. Если .txt есть — берём его (при нескольких первый по алфавиту);
    // нет файла или в нём нет запроса — запросом становится имя папки, а главные/LSI-слова
    // скрипт определит сам по страницам ТОП-10.
    const txtFiles = files.filter(f => f.toLowerCase().endsWith('.txt') && (!txtPages || f.toLowerCase() === 'query.txt')).sort();
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

    if (!files.includes(ownName)) {
      console.warn(`⚠️ Пропущена папка ${dir}: нет ${ownName}`);
      continue;
    }

    const competitorPaths = files
      .filter(f => f.toLowerCase().endsWith(pageExt) && f !== ownName && !(txtPages && f.toLowerCase() === 'query.txt'))
      .map(f => path.join(dir, f));

    if (competitorPaths.length === 0) {
      console.warn(`⚠️ Пропущена папка ${dir}: нет ни одной страницы конкурента`);
      continue;
    }

    tasks.push({ query, folder: entry.name, ownPath, competitorPaths, mainPhrases, lsiPhrases });
  }

  return tasks;
}

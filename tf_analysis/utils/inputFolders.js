import { readdir, readFile } from 'fs/promises';
import path from 'path';

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

    let query;
    try {
      query = (await readFile(queryPath, 'utf-8')).trim();
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

    tasks.push({ query, folder: entry.name, ownPath, competitorPaths });
  }

  return tasks;
}

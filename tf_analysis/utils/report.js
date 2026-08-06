import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function writeCSV(filePath, header, rows) {
  await ensureDir(filePath);
  const bom = '﻿';
  const content = bom + header + '\n' + rows.join('\n');
  await writeFile(filePath, content, 'utf-8');
  console.log(`✓ Отчёт сохранён: ${filePath}`);
}

// Сохраняет леммы (свои/мин/среднее/медиана/макс/покрытие/рекомендация)
export async function saveLemmaReport(filePath, lemmaComparison) {
  const header = 'Лемма,У вас,Мин ТОП-10,Среднее ТОП-10,Медиана ТОП-10,Макс ТОП-10,Покрытие,Рекомендация';
  const rows = lemmaComparison.map(row => [
    escapeCSV(row.lemma),
    row.ownCount,
    row.minCompetitor,
    row.avgCompetitor,
    row.medianCompetitor,
    row.maxCompetitor,
    escapeCSV(row.coverage),
    escapeCSV(row.recommendation)
  ].join(','));

  await writeCSV(filePath, header, rows);
}

// Сохраняет сводку по длине текста и списку проанализированных страниц
export async function saveSummaryReport(filePath, { query, ownUrl, lengthSummary, competitorPages }) {
  const header = 'Параметр,Значение';
  const rows = [
    ['Запрос', query],
    ['Своя страница', ownUrl],
    ['Кол-во конкурентов', competitorPages.length],
    ['Слов у вас', lengthSummary.ownWordCount],
    ['Символов у вас', lengthSummary.ownCharCount],
    ['Мин слов у конкурентов', lengthSummary.competitorWordStats.min],
    ['Среднее слов у конкурентов', lengthSummary.competitorWordStats.avg.toFixed(1)],
    ['Макс слов у конкурентов', lengthSummary.competitorWordStats.max],
    ['Вердикт по кол-ву слов', lengthSummary.wordCountVerdict],
    ['Мин символов у конкурентов', lengthSummary.competitorCharStats.min],
    ['Среднее символов у конкурентов', lengthSummary.competitorCharStats.avg.toFixed(1)],
    ['Макс символов у конкурентов', lengthSummary.competitorCharStats.max],
    ['Вердикт по кол-ву символов', lengthSummary.charCountVerdict]
  ].map(([k, v]) => `${escapeCSV(k)},${escapeCSV(v)}`);

  await writeCSV(filePath, header, rows);
}

export function slugifyQuery(query) {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'query';
}

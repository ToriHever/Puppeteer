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
  const header = 'Лемма,Важность,У вас,Мин ТОП-10,Среднее ТОП-10,Медиана ТОП-10,Макс ТОП-10,Покрытие,Рекомендация';
  const rows = lemmaComparison.map(row => [
    escapeCSV(row.lemma),
    escapeCSV(row.importance),
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

// Сохраняет кластеры лемм (темы): по одной строке на лемму, с пометкой «Главное/LSI».
// clusters — { words: [...], lsi: [...] } из clusterLemmas; в файл попадают оба разбиения.
export async function saveClusterReport(filePath, clusters, lemmaComparison) {
  const stat = new Map(lemmaComparison.map(r => [r.lemma, r]));
  const header = 'Разбиение,Кластер,Тема,Лемма,Важность,Среднее ТОП-10,Покрытие,У вас';
  const rows = [];
  for (const [mode, label] of [['words', 'По словам (TF-IDF)'], ['lsi', 'По LSI (SVD)']]) {
    for (const cluster of clusters[mode]) {
      for (const item of cluster.items) {
        const s = stat.get(item.lemma);
        rows.push([
          escapeCSV(label), cluster.id, escapeCSV(cluster.name), escapeCSV(item.lemma),
          escapeCSV(item.importance), s ? s.avgCompetitor : '', escapeCSV(s ? s.coverage : ''), s ? s.ownCount : ''
        ].join(','));
      }
    }
  }
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

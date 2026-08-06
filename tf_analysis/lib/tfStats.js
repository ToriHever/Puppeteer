import { LEMMA_MIN_COVERAGE_RATIO } from '../config.js';

// Короткий список служебных частей речи, не несущих SEO-значимости
const STOPWORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все',
  'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по',
  'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из',
  'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или',
  'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж', 'вам',
  'сказать', 'этот', 'который', 'весь', 'этого', 'для', 'мы', 'тот', 'себя',
  'под', 'при', 'также', 'без', 'над', 'между'
]);

// Строит частотную карту лемм из токенов { word, lemma }
export function buildLemmaFreq(tokens) {
  const freq = new Map();
  for (const { lemma } of tokens) {
    if (STOPWORDS.has(lemma)) continue;
    freq.set(lemma, (freq.get(lemma) || 0) + 1);
  }
  return freq;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stats(values) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    median: median(values)
  };
}

// Возвращает множество лемм из токенов { word, lemma }, без фильтрации стоп-слов —
// используется для вручную помеченных главных/LSI-слов из query.txt
export function lemmasFromTokens(tokens) {
  return new Set(tokens.map(t => t.lemma));
}

// Агрегирует частоты лемм и длину текста по страницам конкурентов.
// forcedLemmas — леммы, которые нужно включить в отчёт независимо от порога покрытия
// (вручную помеченные главные/LSI-слова из query.txt)
export function aggregateCompetitors(competitorPages, forcedLemmas = new Set()) {
  // competitorPages: [{ url, lemmaFreq: Map, wordCount, charCount }]
  const allLemmas = new Set();
  for (const page of competitorPages) {
    for (const lemma of page.lemmaFreq.keys()) allLemmas.add(lemma);
  }
  for (const lemma of forcedLemmas) allLemmas.add(lemma);

  const lemmaStats = new Map();
  const minCoverage = Math.ceil(competitorPages.length * LEMMA_MIN_COVERAGE_RATIO);

  for (const lemma of allLemmas) {
    const counts = competitorPages.map(p => p.lemmaFreq.get(lemma) || 0);
    const coverage = counts.filter(c => c > 0).length;
    if (coverage < minCoverage && !forcedLemmas.has(lemma)) continue; // отфильтровываем редкие/шумовые леммы

    lemmaStats.set(lemma, { ...stats(counts), coverage, totalPages: competitorPages.length });
  }

  const wordCounts = competitorPages.map(p => p.wordCount);
  const charCounts = competitorPages.map(p => p.charCount);

  return {
    lemmaStats,
    lengthStats: {
      words: stats(wordCounts),
      chars: stats(charCounts)
    }
  };
}

function classifyByRange(value, { min, max }) {
  if (value < min) return 'Недостаточно';
  if (value > max) return 'Избыточно';
  return 'Норма';
}

// Сравнивает свою страницу с агрегированной статистикой ТОП-10.
// markedLemmas — леммы главных/LSI-слов, вручную заданных в query.txt: { main: Set, lsi: Set }
export function compareOwnPage(ownPage, aggregated, markedLemmas = { main: new Set(), lsi: new Set() }) {
  const lemmaComparison = [];

  for (const [lemma, competitorStat] of aggregated.lemmaStats.entries()) {
    const ownCount = ownPage.lemmaFreq.get(lemma) || 0;
    const importance = markedLemmas.main.has(lemma) ? 'Главное' : markedLemmas.lsi.has(lemma) ? 'LSI' : '';
    lemmaComparison.push({
      lemma,
      importance,
      ownCount,
      minCompetitor: competitorStat.min,
      avgCompetitor: Number(competitorStat.avg.toFixed(1)),
      medianCompetitor: competitorStat.median,
      maxCompetitor: competitorStat.max,
      coverage: `${competitorStat.coverage}/${competitorStat.totalPages}`,
      recommendation: classifyByRange(ownCount, competitorStat)
    });
  }

  // Сортируем: сначала вручную помеченные слова (Главное, потом LSI), внутри группы — недо/переоптимизированные
  lemmaComparison.sort((a, b) => {
    const importanceRank = { 'Главное': 0, 'LSI': 1, '': 2 };
    if (importanceRank[a.importance] !== importanceRank[b.importance]) {
      return importanceRank[a.importance] - importanceRank[b.importance];
    }
    const rank = { 'Недостаточно': 0, 'Избыточно': 1, 'Норма': 2 };
    return rank[a.recommendation] - rank[b.recommendation];
  });

  const lengthSummary = {
    ownWordCount: ownPage.wordCount,
    ownCharCount: ownPage.charCount,
    wordCountVerdict: classifyByRange(ownPage.wordCount, aggregated.lengthStats.words),
    charCountVerdict: classifyByRange(ownPage.charCount, aggregated.lengthStats.chars),
    competitorWordStats: aggregated.lengthStats.words,
    competitorCharStats: aggregated.lengthStats.chars
  };

  return { lemmaComparison, lengthSummary };
}

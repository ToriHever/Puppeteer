import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';

puppeteer.use(StealthPlugin());

import { readInputTasks, convertHtmlToTxt } from './utils/inputFolders.js';
import { saveLemmaReport, saveSummaryReport, saveClusterReport } from './utils/report.js';
import { clusterLemmas, findLsiTerms } from './lib/cluster.js';
import { saveWordCloud } from './lib/cloud.js';
import { mergeCsvToXlsx } from './merge_to_xlsx.js';
import { fetchPageText } from './lib/fetchPageText.js';
import { lemmatizeText } from './lib/lemmatizer.js';
import { buildLemmaFreq, aggregateCompetitors, compareOwnPage, lemmasFromTokens } from './lib/tfStats.js';
import { RESULTS_DIR, INPUT_DIR, CLOUD_MAX_WORDS, AUTO_LSI_MAX_TERMS, AUTO_LSI_MIN_SIMILARITY, AUTO_LSI_MIN_COVERAGE, HEADING_WEIGHT } from './config.js';

async function analyzePage(page, source) {
  const pageText = await fetchPageText(page, source);
  const tokens = await lemmatizeText(pageText.text);
  const lemmaFreq = buildLemmaFreq(tokens);
  // Заголовки H1–H3 — отдельная частотная карта (их слова входят и в общий текст)
  const headingFreq = buildLemmaFreq(await lemmatizeText(pageText.headings));
  return { source, lemmaFreq, headingFreq, wordCount: pageText.wordCount, charCount: pageText.charCount };
}

// Лемматизирует вручную заданные фразы (главные/LSI-слова из query.txt) и возвращает множество их лемм
async function lemmasOfPhrases(phrases) {
  if (!phrases || phrases.length === 0) return new Set();
  const tokens = await lemmatizeText(phrases.join('. '));
  return lemmasFromTokens(tokens);
}

async function runTask(browser, page, { query, folder, ownPath, competitorPaths, mainPhrases, lsiPhrases }, dateStr) {
  console.log(`\n┌─────────────────────────────────────────`);
  console.log(`│ Запрос: "${query}" (папка: ${folder})`);
  console.log(`│ Конкурентов: ${competitorPaths.length}`);
  console.log(`└─────────────────────────────────────────`);

  const competitorPages = [];
  for (const filePath of competitorPaths) {
    try {
      const analyzed = await analyzePage(page, filePath);
      competitorPages.push(analyzed);
      console.log(`  ✓ ${path.basename(filePath)} — ${analyzed.wordCount} слов`);
    } catch (error) {
      console.warn(`  ⚠️ Пропущен файл ${filePath}: ${error.message}`);
    }
  }

  if (competitorPages.length === 0) {
    console.warn(`⚠️ Ни один HTML-файл конкурента не был успешно обработан для "${query}", пропускаем`);
    return;
  }

  let ownPage;
  try {
    ownPage = await analyzePage(page, ownPath);
  } catch (error) {
    console.warn(`⚠️ Не удалось обработать свою страницу ${ownPath}: ${error.message}, пропускаем задачу`);
    return;
  }

  const [mainLemmas, lsiLemmas] = await Promise.all([
    lemmasOfPhrases(mainPhrases),
    lemmasOfPhrases(lsiPhrases)
  ]);
  const markedLemmas = { main: mainLemmas, lsi: lsiLemmas };
  console.log(`  Главных слов: ${mainLemmas.size}, LSI-слов: ${lsiLemmas.size}`);

  const forcedLemmas = new Set([...mainLemmas, ...lsiLemmas]);
  const aggregated = aggregateCompetitors(competitorPages, forcedLemmas);

  // Автоматическое определение главных и LSI-слов — работает и без query.txt.
  // Центр темы (якоря) — леммы запроса и главные слова; если ни одного из них нет на страницах
  // ТОП-10, берутся самые частотные слова. Если главные слова не заданы вручную, якоря и есть
  // автоматические «Главные»; LSI — слова, ближайшие к якорям в LSI-пространстве.
  // Ручная разметка из query.txt всегда приоритетнее авто-определения.
  const anchorLemmas = new Set([...mainLemmas, ...await lemmasOfPhrases([query])]);
  const lsiSearch = findLsiTerms([...aggregated.lemmaStats.keys()], competitorPages, anchorLemmas, {
    minSimilarity: AUTO_LSI_MIN_SIMILARITY, maxTerms: AUTO_LSI_MAX_TERMS, minCoverage: AUTO_LSI_MIN_COVERAGE
  });
  const autoMain = mainLemmas.size > 0 ? [] : lsiSearch.anchors;
  const autoLsi = lsiSearch.terms.map(x => x.lemma).filter(l => !lsiLemmas.has(l));
  markedLemmas.autoMain = new Set(autoMain);
  markedLemmas.autoLsi = new Set(autoLsi);
  console.log(`  Центр темы (${lsiSearch.fallback ? 'слов запроса нет в текстах — самые частотные' : 'запрос/главные'}): ${lsiSearch.anchors.join(', ')}`);
  console.log(`  Авто-главных: ${autoMain.length}, авто-LSI: ${autoLsi.length}${autoLsi.length ? ` (${autoLsi.slice(0, 8).join(', ')}…)` : ''}`);

  const { lemmaComparison, lengthSummary } = compareOwnPage(ownPage, aggregated, markedLemmas);

  // Все результаты запуска — в одну папку results/<дата проверки>/, файлы
  // именуются по имени папки input/<folder>/, из которой взяты данные
  // (folder — уже валидное имя для файловой системы, доп. санитизация не нужна)
  // + суффикс "результат"/"summary"
  const dir = path.join(RESULTS_DIR, dateStr);
  await saveLemmaReport(path.join(dir, `${folder}_результат.csv`), lemmaComparison);
  await saveSummaryReport(path.join(dir, `${folder}_summary.csv`), {
    query, ownUrl: ownPath, lengthSummary, competitorPages
  });

  // Кластеры слов (KMeans) и облака слов: по обычным TF-IDF-векторам и по LSI
  const items = lemmaComparison
    .map(r => ({ lemma: r.lemma, weight: r.avgCompetitor + (HEADING_WEIGHT - 1) * r.avgHeadingCompetitor, importance: r.importance }))
    .sort((a, b) => (b.importance !== '') - (a.importance !== '') || b.weight - a.weight)
    .slice(0, Math.max(CLOUD_MAX_WORDS, mainLemmas.size + lsiLemmas.size + autoMain.length + autoLsi.length))
    .filter(i => i.weight > 0);
  if (items.length >= 6) {
    const clusters = clusterLemmas(items, competitorPages);
    await saveClusterReport(path.join(dir, `${folder}_кластеры.csv`), clusters, lemmaComparison);
    await saveWordCloud(browser, path.join(dir, `${folder}_облако.png`), clusters.words, `${query} — кластеры слов`);
    await saveWordCloud(browser, path.join(dir, `${folder}_облако_LSI.png`), clusters.lsi, `${query} — кластеры LSI`);
  } else {
    console.warn('  ⚠️ Слишком мало лемм для кластеризации, пропускаем облако слов');
  }
}

async function main() {
  await convertHtmlToTxt(INPUT_DIR);
  const tasks = await readInputTasks(INPUT_DIR);
  if (tasks.length === 0) {
    console.log(`Нет задач в ${INPUT_DIR}.`);
    console.log('Создайте подпапку tf_analysis/input/<любое-имя>/ с файлами: query.txt, own.html (или own.txt) и страницами конкурентов (.html или .txt с HTML-кодом).');
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  // Одна дата на весь запуск — все задачи из этого прогона попадают в одну
  // папку results/<дата>/, даже если анализ займёт какое-то время после полуночи
  const dateStr = new Date().toISOString().slice(0, 10);

  try {
    const page = await browser.newPage();

    for (const task of tasks) {
      try {
        await runTask(browser, page, task, dateStr);
      } catch (error) {
        console.error(`❌ Ошибка при обработке задачи "${task.query}": ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  // Все CSV запуска — в одну книгу Excel (вкладка на файл), в ту же папку results/<дата>/.
  // Сбой здесь не должен ломать основной результат: CSV уже сохранены.
  try {
    await mergeCsvToXlsx(path.join(RESULTS_DIR, dateStr));
  } catch (error) {
    console.warn(`⚠️ Не удалось собрать книгу Excel: ${error.message}`);
  }

  console.log(`\n✓ TF-анализ завершён. Результаты — в results/${dateStr}/`);
}

main().catch(error => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});

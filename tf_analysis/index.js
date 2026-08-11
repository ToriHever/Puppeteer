import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';

puppeteer.use(StealthPlugin());

import { readInputTasks } from './utils/inputFolders.js';
import { saveLemmaReport, saveSummaryReport, slugifyQuery } from './utils/report.js';
import { fetchPageText } from './lib/fetchPageText.js';
import { lemmatizeText } from './lib/lemmatizer.js';
import { buildLemmaFreq, aggregateCompetitors, compareOwnPage, lemmasFromTokens } from './lib/tfStats.js';
import { RESULTS_DIR, INPUT_DIR } from './config.js';

async function analyzePage(page, source) {
  const pageText = await fetchPageText(page, source);
  const tokens = await lemmatizeText(pageText.text);
  const lemmaFreq = buildLemmaFreq(tokens);
  return { source, lemmaFreq, wordCount: pageText.wordCount, charCount: pageText.charCount };
}

// Лемматизирует вручную заданные фразы (главные/LSI-слова из query.txt) и возвращает множество их лемм
async function lemmasOfPhrases(phrases) {
  if (!phrases || phrases.length === 0) return new Set();
  const tokens = await lemmatizeText(phrases.join('. '));
  return lemmasFromTokens(tokens);
}

async function runTask(page, { query, folder, ownPath, competitorPaths, mainPhrases, lsiPhrases }) {
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
  const { lemmaComparison, lengthSummary } = compareOwnPage(ownPage, aggregated, markedLemmas);

  const slug = slugifyQuery(query);
  const dir = path.join(RESULTS_DIR, slug);
  await saveLemmaReport(path.join(dir, 'lemma_report.csv'), lemmaComparison);
  await saveSummaryReport(path.join(dir, 'summary.csv'), {
    query, ownUrl: ownPath, lengthSummary, competitorPages
  });
}

async function main() {
  const tasks = await readInputTasks(INPUT_DIR);
  if (tasks.length === 0) {
    console.log(`Нет задач в ${INPUT_DIR}.`);
    console.log('Создайте подпапку tf_analysis/input/<любое-имя>/ с файлами: query.txt, own.html и HTML-файлами конкурентов.');
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  try {
    const page = await browser.newPage();

    for (const task of tasks) {
      try {
        await runTask(page, task);
      } catch (error) {
        console.error(`❌ Ошибка при обработке задачи "${task.query}": ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log('\n✓ TF-анализ завершён.');
}

main().catch(error => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});

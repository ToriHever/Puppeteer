import GoogleParser from '../../multi_search_parser/parsers/google.js';
import YandexParser from '../../multi_search_parser/parsers/yandex.js';
import { configureBrowser } from '../../multi_search_parser/utils/browser.js';

const ENGINES = [
  { name: 'google', Parser: GoogleParser },
  { name: 'yandex', Parser: YandexParser }
];

// Получает ТОП-10 органических конкурентов по запросу из Google и Яндекс
export async function fetchTop10(page, query) {
  const competitors = [];
  const seenUrls = new Set();

  for (const { name, Parser } of ENGINES) {
    const parser = new Parser();

    try {
      await configureBrowser(page, [], parser.getConfig());
      const results = await parser.searchQuery(page, query);

      const top10 = results
        .filter(r => r.type === 'Органика' && r.organicPosition !== null && r.organicPosition <= 10);

      for (const r of top10) {
        if (!r.url || seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        competitors.push({
          url: r.url,
          title: r.title,
          searchEngine: name,
          organicPosition: r.organicPosition
        });
      }

      console.log(`  [tf_analysis] ✓ ${name}: ${top10.length} результатов ТОП-10`);
    } catch (error) {
      console.error(`  [tf_analysis] ⚠️ Не удалось получить ТОП-10 из ${name}: ${error.message}`);
    }
  }

  return competitors;
}

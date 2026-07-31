import BaseParser from './base.js';
import { sleep } from '../utils/helpers.js';
import { INFO_DOMAINS, INFO_PATH_PATTERNS, COMMERCE_PATH_PATTERNS } from '../utils/pageClassifier.js';

class YandexParser extends BaseParser {
  constructor() {
    super('yandex');
  }

  getConfig() {
    return {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      extraHeaders: {
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    };
  }

  async searchQuery(page, query) {
    const searchUrl = `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;

    // Переходим на страницу поиска
    await page.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Небольшая задержка после загрузки страницы
    await sleep(500 + Math.random() * 500);

    // Делаем несколько случайных движений мыши по странице
    const viewport = page.viewport();
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      const x = Math.floor(Math.random() * viewport.width);
      const y = Math.floor(Math.random() * viewport.height);
      await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
      await sleep(100 + Math.random() * 200);
    }

    // Ждем загрузки результатов
    await page.waitForSelector('.serp-item, .OrganicTitle', { timeout: 10000 }).catch(() => {});

    // Извлекаем органические результаты
    const results = await page.evaluate((searchQuery, infoDomains, infoPathPatterns, commercePathPatterns) => {

      // Функция определения типа страницы (см. utils/pageClassifier.js —
      // здесь та же логика, продублированная, т.к. в page.evaluate можно
      // передать только данные, а не импортировать функции)
      function determinePageType(url) {
        if (!url) return 'Непонятная';

        let hostname = '';
        let pathname = '';
        try {
          const parsed = new URL(url);
          hostname = parsed.hostname.toLowerCase();
          pathname = parsed.pathname.toLowerCase();
        } catch {
          return 'Непонятная';
        }

        const isInfoDomain = infoDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
        if (isInfoDomain) return 'Информационная';

        const isInfoPath = infoPathPatterns.some((p) => pathname.includes(p));
        if (isInfoPath) return 'Информационная';

        const isCommercePath = commercePathPatterns.some((p) => pathname.includes(p));
        if (isCommercePath) return 'Коммерческая';

        if (pathname === '' || pathname === '/') return 'Коммерческая';

        return 'Непонятная';
      }
      
      // Функция извлечения description для Yandex
      function extractYandexDescription(item) {
        // Варианты селекторов для description в Yandex
        const descriptionSelectors = [
          '.OrganicTextContentSpan',
          '.text-container',
          '.Organic-ContentText',
          '.VanillaReact.OrganicText',
          '.TextContainer',
          '.snippet__text',
          '.text'
        ];
        
        for (const selector of descriptionSelectors) {
          const descElement = item.querySelector(selector);
          if (descElement) {
            // Получаем текст, убираем лишние пробелы
            const text = descElement.textContent.trim();
            if (text && text.length > 10) {
              return text.replace(/\s+/g, ' ');
            }
          }
        }
        
        // Если не нашли через селекторы, пробуем найти любой текстовый блок
        const textBlocks = item.querySelectorAll('div[class*="text"], span[class*="text"]');
        for (const block of textBlocks) {
          const text = block.textContent.trim();
          // Исключаем заголовки и короткие фрагменты
          if (text && text.length > 30 && text.length < 500) {
            return text.replace(/\s+/g, ' ');
          }
        }
        
        return '';
      }
      
      const organicResults = [];
      const resultItems = document.querySelectorAll('.serp-item[data-cid]');

      let position = 1;
      let organicPosition = 0;

      resultItems.forEach((item) => {
        const isAd = item.querySelector('.label_theme_direct, .ExtendedSerpItem-Label') !== null;
        const linkElement = item.querySelector('.OrganicTitle-Link, .Link.organic__url');
        const url = linkElement ? linkElement.href : '';
        const title = linkElement ? linkElement.textContent.trim() : '';
        
        // Извлекаем description
        const description = extractYandexDescription(item);

        if (url && title) {
          const linkType = url.includes('yabs.yandex.ru') || isAd ? 'Реклама' : 'Органика';

          if (linkType === 'Органика') {
            organicPosition++;
          }

          const pageType = determinePageType(url);

          organicResults.push({
            query: searchQuery,
            position: position,
            organicPosition: linkType === 'Органика' ? organicPosition : null,
            type: linkType,
            pageType: pageType,
            title: title,
            description: description,
            url: url
          });
          position++;
        }
      });

      return organicResults;
    }, query, INFO_DOMAINS, INFO_PATH_PATTERNS, COMMERCE_PATH_PATTERNS);

    console.log(`  [${this.name}] 📊 Найдено ${results.length} результатов`);
    
    // Подсчитываем сколько результатов имеют description
    const withDescription = results.filter(r => r.description && r.description.length > 0).length;
    console.log(`  [${this.name}] 📝 Description найден у ${withDescription}/${results.length} результатов`);
    
    return results;
  }
}

export default YandexParser;
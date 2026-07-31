import BaseParser from './base.js';
import { sleep } from '../utils/helpers.js';
import { INFO_DOMAINS, INFO_PATH_PATTERNS, COMMERCE_PATH_PATTERNS } from '../utils/pageClassifier.js';
import { detectGoogleSerpFeatures } from '../utils/serpFeatures.js';

class GoogleParser extends BaseParser {
  constructor(options = {}) {
    super('google', options);
    // Google иногда показывает меньше результатов, снижаем порог
    this.minResultsThreshold = 5;
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

  async detectSerpFeatures(page) {
    return detectGoogleSerpFeatures(page);
  }

  async searchQuery(page, query) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=ru`;

    // Переходим на страницу поиска
    await page.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Делаем несколько случайных движений мыши по странице
    const viewport = page.viewport();
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      const x = Math.floor(Math.random() * viewport.width);
      const y = Math.floor(Math.random() * viewport.height);
      await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
      await sleep(100 + Math.random() * 200);
    }

    // Ждем загрузки результатов с несколькими вариантами селекторов
    try {
      await page.waitForSelector('#search, #rso, .g', { timeout: 10000 });
    } catch (e) {
      console.log(`  [${this.name}] ⚠️ Стандартные селекторы не найдены, пробуем альтернативные...`);
    }

    // Даем странице время на полную загрузку
    await sleep(1000);

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
      
      // Функция извлечения description для Google
      function extractGoogleDescription(item) {
        // Варианты селекторов для description в Google
        const descriptionSelectors = [
          '[data-sncf="1"]',
          '[data-content-feature="1"]',
          '.VwiC3b',
          '.yXK7lf',
          '.s3v9rd',
          '.st',
          'div[style*="-webkit-line-clamp"]',
          'span[style*="-webkit-line-clamp"]',
          '.lEBKkf'
        ];
        
        for (const selector of descriptionSelectors) {
          const descElement = item.querySelector(selector);
          if (descElement) {
            const text = descElement.textContent.trim();
            if (text && text.length > 10) {
              return text.replace(/\s+/g, ' ');
            }
          }
        }
        
        // Пробуем найти элемент по атрибутам data
        const dataElements = item.querySelectorAll('[data-sncf], [data-content-feature]');
        for (const elem of dataElements) {
          const text = elem.textContent.trim();
          if (text && text.length > 30 && text.length < 500) {
            return text.replace(/\s+/g, ' ');
          }
        }
        
        // Ищем div/span с ограничением строк
        const clampedElements = item.querySelectorAll('div[style*="line-clamp"], span[style*="line-clamp"]');
        for (const elem of clampedElements) {
          const text = elem.textContent.trim();
          if (text && text.length > 30 && text.length < 500) {
            // Проверяем что это не заголовок
            if (!elem.closest('h1, h2, h3, h4, h5, h6')) {
              return text.replace(/\s+/g, ' ');
            }
          }
        }
        
        // Последняя попытка - ищем любой текстовый блок рядом с заголовком
        const titleElement = item.querySelector('h3');
        if (titleElement) {
          const parent = titleElement.closest('div');
          if (parent) {
            const textDivs = parent.querySelectorAll('div');
            for (const div of textDivs) {
              const text = div.textContent.trim();
              if (text && 
                  text.length > 30 && 
                  text.length < 500 && 
                  !div.querySelector('h3') &&
                  !text.includes('http')) {
                return text.replace(/\s+/g, ' ');
              }
            }
          }
        }
        
        return '';
      }
      
      const organicResults = [];
      
      // Пробуем разные селекторы для поиска результатов
      let resultItems = [];
      
      // Вариант 1: Современный селектор Google
      resultItems = document.querySelectorAll('#rso > div > div > div > div');
      
      // Вариант 2: Классический селектор
      if (resultItems.length === 0) {
        resultItems = document.querySelectorAll('#search .g');
      }
      
      // Вариант 3: Альтернативный селектор
      if (resultItems.length === 0) {
        resultItems = document.querySelectorAll('.g[data-hveid]');
      }
      
      // Вариант 4: Еще один вариант
      if (resultItems.length === 0) {
        resultItems = document.querySelectorAll('[data-sokoban-container]');
      }

      console.log('Google: найдено элементов результатов:', resultItems.length);

      let position = 1;
      let organicPosition = 0;

      resultItems.forEach((item) => {
        // Проверяем, что это не реклама
        const isAd = item.closest('[data-text-ad]') !== null || 
                     item.querySelector('[data-text-ad]') !== null ||
                     item.classList.contains('ads-ad') ||
                     item.querySelector('.ad_cclk') !== null ||
                     item.querySelector('[data-ad-slot]') !== null ||
                     item.closest('.cu-container') !== null;

        // Ищем ссылку разными способами
        let linkElement = item.querySelector('a[href][jsname]');
        if (!linkElement) linkElement = item.querySelector('a[href]:not([role="button"])');
        if (!linkElement) linkElement = item.querySelector('a[ping]');
        
        const url = linkElement ? linkElement.href : '';
        
        // Ищем заголовок разными способами
        let titleElement = item.querySelector('h3');
        if (!titleElement) titleElement = item.querySelector('[role="heading"]');
        if (!titleElement && linkElement) {
          const parent = linkElement.closest('div');
          if (parent) titleElement = parent.querySelector('h3, [role="heading"]');
        }
        
        const title = titleElement ? titleElement.textContent.trim() : '';
        
        // Извлекаем description
        const description = extractGoogleDescription(item);

        // Пропускаем пустые результаты и служебные ссылки Google
        if (url && title && 
            url.startsWith('http') &&
            !url.includes('google.com/search') && 
            !url.includes('webcache.googleusercontent.com') &&
            !url.includes('translate.google.com') &&
            !url.includes('maps.google.com') &&
            !url.includes('support.google.com') &&
            title.length > 3) {
          
          const linkType = isAd ? 'Реклама' : 'Органика';

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
    
    // Если результатов мало, выводим отладочную информацию
    if (results.length < 5) {
      console.log(`  [${this.name}] 🔍 Мало результатов, возможно нужно обновить селекторы`);
      
      // Делаем скриншот для отладки
      try {
        await page.screenshot({ path: `./results/google/debug_${Date.now()}.png`, fullPage: true });
        console.log(`  [${this.name}] 📸 Скриншот сохранен для отладки`);
      } catch (e) {
        // Игнорируем ошибки скриншота
      }
    }
    
    return results;
  }
}

export default GoogleParser;
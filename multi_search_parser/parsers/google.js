import BaseParser from './base.js';
import { sleep } from '../utils/helpers.js';
import { INFO_PATTERNS, COMMERCE_PATTERNS } from '../utils/pageClassifier.js';

class GoogleParser extends BaseParser {
  constructor() {
    super('google');
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
    const results = await page.evaluate((searchQuery, infoPatterns, commercePatterns) => {
      
      // Функция определения типа страницы
      function determinePageType(url) {
        if (!url) return 'Непонятная';
        const lowerUrl = url.toLowerCase();
        
        const isInfo = infoPatterns.some(pattern => lowerUrl.includes(pattern));
        if (isInfo) return 'Информационная';
        
        const isCommerce = commercePatterns.some(pattern => lowerUrl.includes(pattern));
        if (isCommerce) return 'Коммерческая';
        
        return 'Непонятная';
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
          // Пробуем найти заголовок рядом со ссылкой
          const parent = linkElement.closest('div');
          if (parent) titleElement = parent.querySelector('h3, [role="heading"]');
        }
        
        const title = titleElement ? titleElement.textContent.trim() : '';

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
            url: url
          });
          position++;
        }
      });

      return organicResults;
    }, query, INFO_PATTERNS, COMMERCE_PATTERNS);

    console.log(`  [${this.name}] 📊 Найдено ${results.length} результатов`);
    
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
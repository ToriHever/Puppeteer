import BaseParser from './base.js';
import { sleep } from '../utils/helpers.js';

export default class YandexParser extends BaseParser {
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
    const results = await page.evaluate((searchQuery) => {
      
      // Функция определения типа страницы
      function determinePageType(url) {
        const lowerUrl = url.toLowerCase();

        // Паттерны для информационных страниц
        const infoPatterns = [
          '/blog', '/article', '/articles', '/news', '/help', '/faq', '/guide',
          '/tutorial', '/wiki', '/knowledge', '/learn', 'education', '/tips',
          '/advice', '/howto', '/how-to', 'id=', '?p=', '/post', '/posts',
          '/story', '/stories', '/review', '/reviews', '/info', '/informacia',
          '/stati', '/statya', '/novosti', '/obzor', '/analytics', '/support',
          '/docs', '/links', '/opinions', '/technology', '/technologies',
          '/kursfinder', '/actions', 'jetinfo.ru', 'xakep.ru', 'vc.ru',
          'ru.hostings.info', 'pro-hosting.online', 'hostradar.ru',
          'ru.tophosts.net', 'dtf.ru', 'medium.com', '/press-centr'
        ];

        const isInfo = infoPatterns.some(pattern => lowerUrl.includes(pattern));
        if (isInfo) return 'Информационная';

        // Паттерны для коммерческих страниц
        const commercePatterns = [
          '/shop', '/store', '/buy', '/product', '/catalog', '/cart',
          '/checkout', '/order', '/purchase', '/price', '/kupit', '/magazin',
          '/tovar', '/katalog', '/services', '/solutions', '/pricing', '/', '/protection'
        ];

        const isCommerce = commercePatterns.some(pattern => lowerUrl.includes(pattern));
        if (isCommerce) return 'Коммерческая';

        return 'Непонятная';
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
            url: url
          });
          position++;
        }
      });

      return organicResults;
    }, query);

    console.log(`  [${this.name}] 📊 Найдено ${results.length} результатов`);
    return results;
  }
}
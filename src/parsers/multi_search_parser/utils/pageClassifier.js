// Паттерны для определения типа страницы

// Паттерны для информационных страниц
export const INFO_PATTERNS = [
  // Блоги и статьи
  '/blog',
  '/article',
  '/articles',
  '/post',
  '/posts',
  '/stati',
  '/statya',
  
  // Новости
  '/news',
  '/novosti',
  
  // Справка и документация
  '/help',
  '/faq',
  '/guide',
  '/tutorial',
  '/docs',
  '/support',
  'uploads',
  'erp25doc',
  'manuals',
  
  // Образовательный контент
  '/wiki',
  '/knowledge',
  '/learn',
  'education',
  '/tips',
  '/advice',
  '/howto',
  '/how-to',
  
  // Обзоры и аналитика
  '/review',
  '/reviews',
  '/obzor',
  '/analytics',
  '/opinions',
  
  // Информационные разделы
  '/info',
  '/informacia',
  '/story',
  '/stories',
  '/links',
  '/press-centr',
  
  // Технологии
  '/technology',
  '/technologies',
  '/kursfinder',
  '/actions',
  
  // URL параметры
  'id=',
  '?p=',
  
  // Известные информационные домены
  'jetinfo.ru',
  'xakep.ru',
  'vc.ru',
  'ru.hostings.info',
  'pro-hosting.online',
  'hostradar.ru',
  'ru.tophosts.net',
  'dtf.ru',
  'medium.com',
  'wikipedia.org',
  'habr.com',
  'reddit.com',
  'rezbez.ru',
  'support.kaspersky.com',
  'base.garant.ru',
  'infowatch.ru',

];

// Паттерны для коммерческих страниц
export const COMMERCE_PATTERNS = [
  // Магазины и покупки
  '/shop',
  '/store',
  '/buy',
  '/kupit',
  '/magazin',
  
  // Товары и каталоги
  '/product',
  '/catalog',
  '/tovar',
  '/katalog',
  
  // Корзина и оформление
  '/cart',
  '/checkout',
  '/order',
  '/purchase',
  
  // Цены и услуги
  '/price',
  '/pricing',
  '/services',
  '/solutions',
  
  // Защита/безопасность (часто коммерческие предложения)
  '/protection',
  
  // Главная страница (часто коммерческая)
  '/'
];

/**
 * Определяет тип страницы на основе URL
 * @param {string} url - URL страницы
 * @returns {string} - 'Информационная', 'Коммерческая' или 'Непонятная'
 */
export function determinePageType(url) {
  if (!url) return 'Непонятная';
  
  const lowerUrl = url.toLowerCase();

  // Проверяем информационные паттерны
  const isInfo = INFO_PATTERNS.some(pattern => lowerUrl.includes(pattern));
  if (isInfo) return 'Информационная';

  // Проверяем коммерческие паттерны
  const isCommerce = COMMERCE_PATTERNS.some(pattern => lowerUrl.includes(pattern));
  if (isCommerce) return 'Коммерческая';

  return 'Непонятная';
}

/**
 * Добавляет новый паттерн в список информационных
 * @param {string} pattern - Паттерн для добавления
 */
export function addInfoPattern(pattern) {
  if (!INFO_PATTERNS.includes(pattern)) {
    INFO_PATTERNS.push(pattern);
  }
}

/**
 * Добавляет новый паттерн в список коммерческих
 * @param {string} pattern - Паттерн для добавления
 */
export function addCommercePattern(pattern) {
  if (!COMMERCE_PATTERNS.includes(pattern)) {
    COMMERCE_PATTERNS.push(pattern);
  }
}

/**
 * Получает статистику по типам страниц в результатах
 * @param {Array} results - Массив результатов поиска
 * @returns {Object} - Статистика по типам
 */
export function getPageTypeStats(results) {
  const stats = {
    total: results.length,
    info: 0,
    commerce: 0,
    unknown: 0
  };

  results.forEach(result => {
    switch (result.pageType) {
      case 'Информационная':
        stats.info++;
        break;
      case 'Коммерческая':
        stats.commerce++;
        break;
      default:
        stats.unknown++;
    }
  });

  return {
    ...stats,
    infoPercent: ((stats.info / stats.total) * 100).toFixed(1),
    commercePercent: ((stats.commerce / stats.total) * 100).toFixed(1),
    unknownPercent: ((stats.unknown / stats.total) * 100).toFixed(1)
  };
}
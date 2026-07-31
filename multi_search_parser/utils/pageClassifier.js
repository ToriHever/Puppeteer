// Паттерны для определения типа страницы по URL

// Известные информационные домены (сравниваются с hostname целиком, не подстрокой)
export const INFO_DOMAINS = [
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

// Паттерны для информационных страниц (сравниваются с pathname)
export const INFO_PATH_PATTERNS = [
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
];

// Паттерны для коммерческих страниц (сравниваются с pathname)
// Раньше сюда входил '/' как «главная страница часто коммерческая» — но это
// совпадало с ЛЮБЫМ URL (у каждого http(s)-адреса есть хотя бы один '/'),
// из-за чего ветка «Непонятная» никогда не срабатывала. Главная страница
// теперь обрабатывается отдельно, только когда путь реально пустой.
export const COMMERCE_PATH_PATTERNS = [
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
];

/**
 * Определяет тип страницы на основе URL.
 * Разбирает URL на hostname/pathname вместо подстрокового поиска по всей
 * строке — иначе, например, '/blog' у 'https://shop.ru/catalog/blog-stand'
 * ложно матчился бы как инфо-страница просто из-за совпадения символов.
 * @param {string} url - URL страницы
 * @returns {string} - 'Информационная', 'Коммерческая' или 'Непонятная'
 */
export function determinePageType(url) {
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

  const isInfoDomain = INFO_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  if (isInfoDomain) return 'Информационная';

  const isInfoPath = INFO_PATH_PATTERNS.some((p) => pathname.includes(p));
  if (isInfoPath) return 'Информационная';

  const isCommercePath = COMMERCE_PATH_PATTERNS.some((p) => pathname.includes(p));
  if (isCommercePath) return 'Коммерческая';

  // Настоящая главная страница домена (не подкаталог) — частый коммерческий
  // лендинг. В отличие от старого паттерна '/', здесь матчится только
  // реально пустой путь, а не любой URL.
  if (pathname === '' || pathname === '/') return 'Коммерческая';

  return 'Непонятная';
}

/**
 * Добавляет новый паттерн в список информационных путей
 * @param {string} pattern - Паттерн для добавления
 */
export function addInfoPattern(pattern) {
  if (!INFO_PATH_PATTERNS.includes(pattern)) {
    INFO_PATH_PATTERNS.push(pattern);
  }
}

/**
 * Добавляет новый паттерн в список коммерческих путей
 * @param {string} pattern - Паттерн для добавления
 */
export function addCommercePattern(pattern) {
  if (!COMMERCE_PATH_PATTERNS.includes(pattern)) {
    COMMERCE_PATH_PATTERNS.push(pattern);
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

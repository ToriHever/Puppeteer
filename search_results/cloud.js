import puppeteer from 'puppeteer';
import { readFile, writeFile } from 'fs/promises';

// Конфигурация браузера
const CONFIG = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 }
};

// Основная функция парсера
async function parseYandexSearch() {
  let browser;

  try {
    // Читаем список запросов
    const queries = await readQueries('queries.txt');
    console.log(`Загружено ${queries.length} запросов`);

    // Читаем куки из файла
    const cookies = await readCookies('cookiesWordstat.json');
    console.log(`Загружено ${cookies.length} куки`);

    // Запускаем браузер с настройками
    browser = await puppeteer.launch({
      headless: false, // Установите true для фонового режима
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    const page = await browser.newPage();

    // Настраиваем браузер
    await configureBrowser(page, cookies);

    // Массив для результатов
    const results = [];

    // Парсим каждый запрос
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`\nОбработка запроса ${i + 1}/${queries.length}: "${query}"`);

      try {
        const searchResults = await searchQuery(page, query);
        results.push(...searchResults);

        // Случайная задержка между запросами (3-7 секунд)
        const delay = 3000 + Math.random() * 4000;
        console.log(`Пауза ${Math.round(delay / 1000)} сек...`);
        await sleep(delay);

      } catch (error) {
        console.error(`Ошибка при обработке запроса "${query}":`, error.message);
      }
    }

    // Сохраняем результаты в CSV
    await saveToCSV(results, 'results.csv');
    console.log('\n✓ Парсинг завершен! Результаты сохранены в results.csv');

  } catch (error) {
    console.error('Критическая ошибка:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Настройка браузера
async function configureBrowser(page, cookies) {
  // Устанавливаем User-Agent
  await page.setUserAgent(CONFIG.userAgent);

  // Устанавливаем viewport
  await page.setViewport(CONFIG.viewport);

  // Устанавливаем куки из файла
  if (cookies && cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log('Куки успешно установлены');
  }

  // Скрываем признаки автоматизации
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['ru-RU', 'ru', 'en-US', 'en']
    });

    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
  });

  // Устанавливаем дополнительные заголовки
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  });
}

// Поиск по запросу
async function searchQuery(page, query) {
  const searchUrl = `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;

  // Переходим на страницу поиска
  await page.goto(searchUrl, {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // Ждем загрузки результатов
  await page.waitForSelector('.serp-item, .OrganicTitle', { timeout: 10000 }).catch(() => {});

  // Извлекаем органические результаты
  const results = await page.evaluate((searchQuery) => {
    // --------------------------------------------------------------------------------------------------
    // ИСПРАВЛЕНИЕ: Функция determinePageType была перемещена в начало блока evaluate 
    // для корректного обеспечения области видимости и "поднятия" (hoisting)
    // --------------------------------------------------------------------------------------------------
    
    // Функция определения типа страницы
    function determinePageType(url) {
      const lowerUrl = url.toLowerCase();

      // Паттерны для информационных страниц
      const infoPatterns = [
        '/blog',
        '/article',
        '/articles',
        '/news',
        '/help',
        '/faq',
        '/guide',
        '/tutorial',
        '/wiki',
        '/knowledge',
        '/learn',
        'education', // Добавил пробел для 'education'
        '/tips',
        '/advice',
        '/howto',
        '/how-to',
        'id=',
        '?p=',
        '/post',
        '/posts',
        '/story',
        '/stories',
        '/review',
        '/reviews',
        '/info',
        '/informacia',
        '/stati',
        '/statya',
        '/novosti',
        '/obzor'
      ];

      // Проверяем наличие информационных паттернов
      const isInfo = infoPatterns.some(pattern => lowerUrl.includes(pattern));

      if (isInfo) {
        return 'Информационная';
      }

      // Паттерны для коммерческих страниц
      const commercePatterns = [
        '/shop',
        '/store',
        '/buy',
        '/product',
        '/catalog',
        '/cart',
        '/checkout',
        '/order',
        '/purchase',
        '/price',
        '/kupit',
        '/magazin',
        '/tovar',
        '/katalog'
      ];

      const isCommerce = commercePatterns.some(pattern => lowerUrl.includes(pattern));

      if (isCommerce) {
        return 'Коммерческая';
      }

      return 'Непонятная';
    }
    
    // --------------------------------------------------------------------------------------------------
    
    const organicResults = [];

    // Селекторы для органической выдачи (могут меняться)
    const resultItems = document.querySelectorAll('.serp-item[data-cid]');

    let position = 1;

    resultItems.forEach((item) => {
      // Проверяем, что это не реклама
      const isAd = item.querySelector('.label_theme_direct, .ExtendedSerpItem-Label') !== null;

      if (!isAd) {
        // Извлекаем URL
        const linkElement = item.querySelector('.OrganicTitle-Link, .Link.organic__url');
        const url = linkElement ? linkElement.href : '';

        // Извлекаем заголовок
        const title = linkElement ? linkElement.textContent.trim() : '';

        if (url && title) {
          // Определяем тип ссылки
          const linkType = url.includes('yabs.yandex.ru') ? 'Реклама' : 'Органика';

          // Определяем тип страницы
          const pageType = determinePageType(url); // <-- Теперь функция доступна

          organicResults.push({
            query: searchQuery,
            position: position,
            type: linkType,
            pageType: pageType,
            title: title,
            url: url
          });
          position++;
        }
      }
    });

    return organicResults;
  }, query);

  console.log(`  Найдено ${results.length} результатов`);
  return results;
}

// Чтение запросов из файла
async function readQueries(filename) {
  try {
    const content = await readFile(filename, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  } catch (error) {
    throw new Error(`Не удалось прочитать файл ${filename}: ${error.message}`);
  }
}

// Чтение куки из JSON файла
async function readCookies(filename) {
  try {
    const content = await readFile(filename, 'utf-8');
    const cookies = JSON.parse(content);

    // Проверяем формат куки
    if (Array.isArray(cookies)) {
      return cookies;
    } else if (typeof cookies === 'object') {
      // Если это объект, пробуем извлечь массив куки
      return cookies.cookies || Object.values(cookies);
    }

    return [];
  } catch (error) {
    console.warn(`Предупреждение: не удалось загрузить куки из ${filename}: ${error.message}`);
    return [];
  }
}

// Сохранение результатов в CSV
async function saveToCSV(results, filename) {
  // Заголовок CSV
  const header = 'Запрос,Позиция,Тип,Тип страницы,Заголовок,URL\n';

  // Формируем строки CSV
  const rows = results.map(result => {
    return [
      escapeCSV(result.query),
      result.position,
      escapeCSV(result.type),
      escapeCSV(result.pageType),
      escapeCSV(result.title),
      escapeCSV(result.url)
    ].join(',');
  }).join('\n');

  // Добавляем BOM для корректного отображения кириллицы в Excel
  const bom = '\uFEFF';
  const csvContent = bom + header + rows;

  await writeFile(filename, csvContent, 'utf-8');
}

// Экранирование значений для CSV
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Если содержит запятую, кавычки или перенос строки - оборачиваем в кавычки
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Функция задержки
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Запуск парсера
parseYandexSearch();
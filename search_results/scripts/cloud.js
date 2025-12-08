import puppeteer from 'puppeteer';
import { readFile, writeFile, access } from 'fs/promises';
import { existsSync } from 'fs';
import readline from 'readline';
import path from 'path';

// Конфигурация браузера
const CONFIG = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  minResultsThreshold: 10 // Минимальное количество результатов
};

// Функция сохранения промежуточных результатов
async function saveIntermediateResults(results, incompleteQueries) {
  try {
    // Сохраняем результаты
    if (results.length > 0) {
      const resultsFilename = getUniqueFilename('results/results_intermediate.csv');
      await saveToCSV(results, resultsFilename);
      console.log(`\n💾 Промежуточные результаты сохранены: ${resultsFilename}`);
      console.log(`   Сохранено результатов: ${results.length}`);
    }
    
    // Сохраняем неполные запросы
    if (incompleteQueries.length > 0) {
      await saveIncompleteQueries(incompleteQueries, 'results/incomplete_queries_intermediate.txt');
    }
  } catch (error) {
    console.error('Ошибка при сохранении промежуточных результатов:', error.message);
  }
}

// Функция хаотичного движения мыши
async function randomMouseMovement(page, duration = 2000) {
  const viewport = page.viewport();
  const startTime = Date.now();
  
  console.log('🖱️  Имитация движения мыши...');
  
  while (Date.now() - startTime < duration) {
    // Генерируем случайные координаты
    const x = Math.floor(Math.random() * viewport.width);
    const y = Math.floor(Math.random() * viewport.height);
    
    // Двигаем мышь с небольшой задержкой
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
    
    // Случайная пауза между движениями (50-200мс)
    await sleep(50 + Math.random() * 150);
    
    // Иногда делаем небольшие круговые движения
    if (Math.random() > 0.7) {
      const radius = 20 + Math.random() * 30;
      for (let angle = 0; angle < Math.PI * 2; angle += 0.3) {
        const newX = x + Math.cos(angle) * radius;
        const newY = y + Math.sin(angle) * radius;
        await page.mouse.move(newX, newY, { steps: 2 });
        await sleep(30);
      }
    }
  }
}
// Функция ожидания нажатия Enter
  async function waitForUserInput(message) { 
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question(`\n${message}\nНажмите Enter для продолжения...`, () => {
        rl.close();
        resolve();
      });
    });
  }

// Функция сохранения куки
async function saveCookies(page, filename) {
  try {
    const cookies = await page.cookies();
    await writeFile(filename, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log('✓ Куки успешно сохранены');
    return true;
  } catch (error) {
    console.error('Ошибка при сохранении куки:', error.message);
    return false;
  }
}

// Функция генерации имени файла с датой
function generateFilenameWithDate(baseName, extension) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  
  const nameWithoutExt = baseName.replace(new RegExp(`\\${extension}$`), '');
  return `${nameWithoutExt}_${dateStr}_${timeStr}${extension}`;
}

// Функция получения уникального имени файла
function getUniqueFilename(filename) {
  if (!existsSync(filename)) {
    return filename;
  }
  
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const dir = path.dirname(filename);
  
  return path.join(dir, generateFilenameWithDate(base, ext));
}

// Функция сохранения запросов с недостаточными результатами
async function saveIncompleteQueries(queries, filename) {
  try {
    const uniqueFilename = getUniqueFilename(filename);
    const content = queries.join('\n');
    await writeFile(uniqueFilename, content, 'utf-8');
    console.log(`\n✓ Запросы с недостаточными результатами сохранены в: ${uniqueFilename}`);
    console.log(`  Всего запросов: ${queries.length}`);
  } catch (error) {
    console.error('Ошибка при сохранении неполных запросов:', error.message);
  }
}

// Основная функция парсера
async function parseYandexSearch() {
  let browser;
  let results = [];
  let incompleteQueries = [];

  // Обработчик прерывания (Ctrl+C)
  const handleInterrupt = async (signal) => {
    console.log(`\n\n⚠️ Получен сигнал прерывания (${signal})`);
    console.log('Сохранение промежуточных результатов...');
    
    await saveIntermediateResults(results, incompleteQueries);
    
    if (browser) {
      console.log('Закрытие браузера...');
      await browser.close();
    }
    
    console.log('✓ Скрипт остановлен');
    process.exit(0);
  };

  // Регистрируем обработчики сигналов
  process.on('SIGINT', handleInterrupt);  // Ctrl+C
  process.on('SIGTERM', handleInterrupt); // Kill команда

  try {
    // Читаем список запросов
    const queries = await readQueries('scripts/queries.txt');
    console.log(`Загружено ${queries.length} запросов`);

    // Читаем куки из файла
    const cookies = await readCookies('./scripts/cookiesWordstat.json');
    console.log(`Загружено ${cookies.length} куки`);

    // Запускаем браузер с настройками
    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--start-maximized',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    const page = await browser.newPage();

    // Настраиваем браузер
    await configureBrowser(page, cookies);

    // Парсим каждый запрос
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Обработка запроса ${i + 1}/${queries.length}: "${query}"`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      try {
        const searchResults = await searchQuery(page, query);
        
        // Проверяем количество результатов
        if (searchResults.length < CONFIG.minResultsThreshold) {
          console.warn(`⚠️ ВНИМАНИЕ: Найдено только ${searchResults.length} результатов (ожидалось минимум ${CONFIG.minResultsThreshold})`);
          console.log('Возможная причина: КАПЧА или блокировка');
          console.log('📍 Откройте браузер и пройдите капчу вручную');
          
          // Добавляем в список неполных запросов
          incompleteQueries.push(query);
          
          // Ждем действия пользователя
          await waitForUserInput('После прохождения капчи');
          
          // Сохраняем обновленные куки
          console.log('Сохранение обновленных куки...');
          await saveCookies(page, './scripts/cookiesWordstat.json');
          
          // Повторяем попытку для того же запроса
          console.log(`Повторная попытка для запроса "${query}"...`);
          const retryResults = await searchQuery(page, query);
          
          if (retryResults.length < CONFIG.minResultsThreshold) {
            console.warn(`⚠️ Результатов по-прежнему недостаточно: ${retryResults.length}`);
            console.log('Пропускаем запрос и продолжаем...');
          } else {
            console.log(`✓ Успешно получено ${retryResults.length} результатов`);
            // Удаляем из списка неполных, если повторная попытка успешна
            const index = incompleteQueries.indexOf(query);
            if (index > -1) {
              incompleteQueries.splice(index, 1);
            }
          }
          
          results.push(...retryResults);
        } else {
          console.log(`✓ Найдено ${searchResults.length} результатов`);
          results.push(...searchResults);
        }

        // Случайная задержка между запросами (2-5 секунд) с одновременным движением мыши
        const delay = 2000 + Math.random() * 3000;
        console.log(`⏱ Пауза ${Math.round(delay / 1000)} сек с имитацией движения мыши...`);
        
        // Запускаем движение мыши и паузу одновременно
        await Promise.all([
          randomMouseMovement(page, delay),
          sleep(delay)
        ]);

      } catch (error) {
        console.error(`❌ Ошибка при обработке запроса "${query}":`, error.message);
        incompleteQueries.push(query);
      }
    }

    // Генерируем уникальное имя файла для результатов
    const resultsFilename = getUniqueFilename('results/results.csv');
    
    // Сохраняем результаты в CSV
    await saveToCSV(results, resultsFilename);
    console.log(`\n✓ Парсинг завершен! Результаты сохранены в: ${resultsFilename}`);
    console.log(`  Всего обработано запросов: ${queries.length}`);
    console.log(`  Всего найдено результатов: ${results.length}`);

    // Сохраняем запросы с недостаточными результатами
    if (incompleteQueries.length > 0) {
      await saveIncompleteQueries(incompleteQueries, 'results/incomplete_queries.txt');
    } else {
      console.log('\n✓ Все запросы обработаны успешно!');
    }

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    
    // Сохраняем промежуточные результаты при ошибке
    console.log('\n💾 Сохранение промежуточных результатов из-за ошибки...');
    await saveIntermediateResults(results, incompleteQueries);
    
  } finally {
    if (browser) {
      await browser.close();
    }
    
    // Удаляем обработчики сигналов
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
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
    console.log('✓ Куки успешно установлены');
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
        'education',
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
        '/obzor',
        '/analytics',
        '/support',
        '/docs',
        '/links',
        '/opinions',
        '/technology',
        '/technologies',
        '/kursfinder',
        '/actions',
        'jetinfo.ru',
        'xakep.ru'
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
        '/katalog',
        '/services',
        '/solutions',
        '/pricing',
        '/',
        '/protection'
      ];

      const isCommerce = commercePatterns.some(pattern => lowerUrl.includes(pattern));

      if (isCommerce) {
        return 'Коммерческая';
      }

      return 'Непонятная';
    }
    
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
          const pageType = determinePageType(url);

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

  console.log(`  📊 Найдено ${results.length} результатов`);
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
    console.warn(`⚠️ Предупреждение: не удалось загрузить куки из ${filename}: ${error.message}`);
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
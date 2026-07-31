import puppeteer from 'puppeteer';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import readline from 'readline';
import path from 'path';
import { detectQueryIntentByKeywords } from '../utils/queryIntent.js';

// Глобальная переменная для управления паузой
let isPaused = false;
let pauseMessage = '';

// Функция проверки и создания папки
async function ensureDirectoryExists(dirPath) {
  try {
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
      console.log(`✓ Создана папка: ${dirPath}`);
    }
  } catch (error) {
    console.error(`Ошибка при создании папки ${dirPath}:`, error.message);
    throw error;
  }
}

// Конфигурация браузера
const CONFIG = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  minResultsThreshold: 10 // Минимальное количество результатов
};

// Функция инициализации обработчика горячих клавиш
function initializeHotkeys() {
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume(); // Важно: активируем stdin
    
    process.stdin.on('keypress', (str, key) => {
      // Обработка Ctrl+C для корректного завершения
      if (key.ctrl && key.name === 'c') {
        return; // Позволяем обработчику SIGINT сработать
      }
      
      // Игнорируем Enter если он не обрабатывается waitForUserInput
      if (key.name === 'return') {
        return; // Enter обрабатывается отдельной логикой
      }
      
      // Горячая клавиша 'p' для паузы/возобновления
      if (key.name === 'p' || key.name === 'з') {
        isPaused = !isPaused;
        if (isPaused) {
          console.log('\n\n⏸️  ═══════════════════════════════════════════════════');
          console.log('⏸️  СКРИПТ ПРИОСТАНОВЛЕН');
          console.log('⏸️  Нажмите "P" для возобновления работы');
          console.log('⏸️  ═══════════════════════════════════════════════════\n');
          pauseMessage = '⏸️  [ПАУЗА] ';
        } else {
          console.log('\n▶️  ═══════════════════════════════════════════════════');
          console.log('▶️  СКРИПТ ВОЗОБНОВЛЕН');
          console.log('▶️  ═══════════════════════════════════════════════════\n');
          pauseMessage = '';
        }
      }
      
      // Горячая клавиша 'h' для справки
      if (key.name === 'h' || key.name === 'р') {
        console.log('\n📋 ═══════════════════════════════════════════════════');
        console.log('📋 ГОРЯЧИЕ КЛАВИШИ:');
        console.log('📋 ═══════════════════════════════════════════════════');
        console.log('   P - Пауза/Возобновление работы скрипта');
        console.log('   H - Показать эту справку');
        console.log('   Ctrl+C - Сохранить результаты и выйти');
        console.log('📋 ═══════════════════════════════════════════════════\n');
      }
    });
    
    console.log('\n⌨️  Горячие клавиши активированы:');
    console.log('   • P - Пауза/Возобновление');
    console.log('   • H - Справка');
    console.log('   • Ctrl+C - Выход с сохранением\n');
  }
}

// Функция ожидания с проверкой паузы
async function sleepWithPauseCheck(ms) {
  const startTime = Date.now();
  const checkInterval = 100; // Проверяем каждые 100мс
  
  while (Date.now() - startTime < ms) {
    if (isPaused) {
      // Ждем пока пауза не будет снята
      while (isPaused) {
        await sleep(checkInterval);
      }
      // После снятия паузы продолжаем с того места где остановились
    }
    await sleep(Math.min(checkInterval, ms - (Date.now() - startTime)));
  }
}

// Функция движения мыши с проверкой паузы
async function randomMouseMovementWithPause(page, duration = 2000) {
  const viewport = page.viewport();
  const startTime = Date.now();
  
  console.log(`${pauseMessage}🖱️  Имитация движения мыши...`);
  
  while (Date.now() - startTime < duration) {
    // Проверяем паузу
    if (isPaused) {
      while (isPaused) {
        await sleep(100);
      }
    }
    
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
        if (isPaused) {
          while (isPaused) {
            await sleep(100);
          }
        }
        const newX = x + Math.cos(angle) * radius;
        const newY = y + Math.sin(angle) * radius;
        await page.mouse.move(newX, newY, { steps: 2 });
        await sleep(30);
      }
    }
  }
}

// Режимы работы
const MODES = {
  COOKIE: 'cookie',
  INCOGNITO: 'incognito'
};

// Функция выбора режима работы (совместимая с горячими клавишами)
function selectMode() {
  return new Promise((resolve) => {
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║         ВЫБОР РЕЖИМА РАБОТЫ ПАРСЕРА              ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');
    console.log('1. 🍪 Режим с куками (сохранение сессии)');
    console.log('   - Использует сохраненные куки');
    console.log('   - Пересохраняет куки после прохождения капчи');
    console.log('   - Рекомендуется для больших объемов');
    console.log('\n2. 🕶️  Режим инкогнито (без куков)');
    console.log('   - Каждый запрос как новый пользователь');
    console.log('   - Не сохраняет куки');
    console.log('   - Полностью анонимный режим\n');
    console.log('Выберите режим (1 или 2): ');

    let resolved = false;
    const onKeypress = (str, key) => {
      if (!resolved && (str === '1' || str === '2')) {
        resolved = true;
        process.stdin.removeListener('keypress', onKeypress);
        const mode = str === '2' ? MODES.INCOGNITO : MODES.COOKIE;
        console.log(`\n✓ Выбран режим: ${mode === MODES.COOKIE ? '🍪 С куками' : '🕶️  Инкогнито'}\n`);
        resolve(mode);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

// Функция ожидания нажатия Enter (совместимая с горячими клавишами)
function waitForUserInput(message) {
  return new Promise((resolve) => {
    console.log(`\n${message}`);
    console.log('Нажмите Enter для продолжения...');
    
    let resolved = false;
    const onKeypress = (str, key) => {
      if (!resolved && key.name === 'return') {
        resolved = true;
        process.stdin.removeListener('keypress', onKeypress);
        console.log('✓ Продолжение работы...\n');
        resolve();
      }
    };
    
    process.stdin.on('keypress', onKeypress);
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

// Функция определения типа запроса.
// Сначала — явные ключевые слова в тексте запроса ("купить", "что такое"),
// это прямой сигнал. Если их нет — запасной вариант: доля коммерческих
// страниц среди органики в выдаче.
function determineQueryType(results, query) {
  const byKeyword = detectQueryIntentByKeywords(query);
  if (byKeyword) return byKeyword;

  // Фильтруем только органические результаты для данного запроса
  const organicResults = results.filter(r => r.query === query && r.type === 'Органика');
  
  if (organicResults.length === 0) {
    return 'Неопределенный';
  }
  
  // Подсчитываем коммерческие страницы
  const commercialCount = organicResults.filter(r => r.pageType === 'Коммерческая').length;
  
  // Вычисляем соотношение
  const ratio = commercialCount / organicResults.length;
  
  // Определяем тип запроса по условиям
  if (ratio > 0.4 && ratio <= 0.6) {
    return 'Полукоммерческий';
  } else if (ratio <= 0.4) {
    return 'Информационный';
  } else { // ratio > 0.6
    return 'Коммерческий';
  }
}

// Функция добавления типа запроса к результатам
function addQueryTypeToResults(results) {
  // Получаем уникальные запросы
  const uniqueQueries = [...new Set(results.map(r => r.query))];
  
  // Создаем карту типов запросов
  const queryTypeMap = {};
  uniqueQueries.forEach(query => {
    queryTypeMap[query] = determineQueryType(results, query);
  });
  
  // Добавляем тип запроса к каждому результату
  return results.map(result => ({
    ...result,
    queryType: queryTypeMap[result.query]
  }));
}

// Функция сохранения промежуточных результатов
async function saveIntermediateResults(results, incompleteQueries) {
  try {
    // Сохраняем результаты
    if (results.length > 0) {
      const resultsFilename = getUniqueFilename('results/results_intermediate.csv');
      // Добавляем тип запроса к промежуточным результатам
      const resultsWithQueryType = addQueryTypeToResults(results);
      await saveToCSV(resultsWithQueryType, resultsFilename);
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
  return randomMouseMovementWithPause(page, duration);
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
    // Проверяем и создаем папку results если нужно
    const dir = path.dirname(filename);
    await ensureDirectoryExists(dir);
    
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
  let mode;

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
    // Инициализируем горячие клавиши ПЕРЕД выбором режима
    initializeHotkeys();

    // Проверяем и создаем необходимые папки
    await ensureDirectoryExists('results');
    await ensureDirectoryExists('scripts');

    // Выбор режима работы
    mode = await selectMode();

    // Читаем список запросов
    const queries = await readQueries('scripts/queries.txt');
    console.log(`Загружено ${queries.length} запросов`);

    let cookies = [];
    
    // Читаем куки только в режиме с куками
    if (mode === MODES.COOKIE) {
      cookies = await readCookies('./scripts/cookiesWordstat.json');
      console.log(`Загружено ${cookies.length} куки`);
    } else {
      console.log('🕶️  Режим инкогнито: куки не используются');
    }

    // Запускаем браузер с настройками
    const launchOptions = {
      headless: false,
      args: [
        '--no-sandbox',
        '--start-maximized',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    };

    // В режиме инкогнито добавляем соответствующий флаг
    if (mode === MODES.INCOGNITO) {
      launchOptions.args.push('--incognito');
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();

    // Настраиваем браузер (куки передаются только в режиме с куками)
    await configureBrowser(page, mode === MODES.COOKIE ? cookies : []);

    // Парсим каждый запрос
    for (let i = 0; i < queries.length; i++) {
      // Проверяем паузу перед началом обработки запроса
      if (isPaused) {
        console.log(`\n${pauseMessage}Ожидание возобновления...`);
        while (isPaused) {
          await sleep(100);
        }
      }

      const query = queries[i];
      console.log(`\n${pauseMessage}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`${pauseMessage}Обработка запроса ${i + 1}/${queries.length}: "${query}"`);
      console.log(`${pauseMessage}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

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
          
          // Сохраняем обновленные куки ТОЛЬКО в режиме с куками
          if (mode === MODES.COOKIE) {
            console.log('🍪 Сохранение обновленных куки...');
            await saveCookies(page, './scripts/cookiesWordstat.json');
          } else {
            console.log('🕶️  Режим инкогнито: куки не сохраняются');
          }
          
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
          console.log(`${pauseMessage}✓ Найдено ${searchResults.length} результатов`);
          results.push(...searchResults);
        }

        // Случайная задержка между запросами (2-5 секунд) с одновременным движением мыши
        const delay = 2000 + Math.random() * 3000;
        console.log(`${pauseMessage}⏱ Пауза ${Math.round(delay / 1000)} сек с имитацией движения мыши...`);
        
        // Запускаем движение мыши и паузу одновременно с проверкой паузы
        await Promise.all([
          randomMouseMovement(page, delay),
          sleepWithPauseCheck(delay)
        ]);

      } catch (error) {
        console.error(`❌ Ошибка при обработке запроса "${query}":`, error.message);
        incompleteQueries.push(query);
      }
    }

    // Генерируем уникальное имя файла для результатов
    const resultsFilename = getUniqueFilename('results/results.csv');
    
    // Добавляем тип запроса к результатам перед сохранением
    const resultsWithQueryType = addQueryTypeToResults(results);
    
    // Сохраняем результаты в CSV
    await saveToCSV(resultsWithQueryType, resultsFilename);
    console.log(`\n✓ Парсинг завершен! Результаты сохранены в: ${resultsFilename}`);
    console.log(`  Режим работы: ${mode === MODES.COOKIE ? '🍪 С куками' : '🕶️  Инкогнито'}`);
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
    
    // Восстанавливаем нормальный режим терминала
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    
    // Удаляем обработчики сигналов
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('keypress');
  }
}

// Настройка браузера
async function configureBrowser(page, cookies) {
  // Устанавливаем User-Agent
  await page.setUserAgent(CONFIG.userAgent);

  // Устанавливаем viewport
  await page.setViewport(CONFIG.viewport);

  // Устанавливаем куки из файла (если есть)
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
    // ВАЖНО: раньше среди commercePatterns был '/' — он совпадает с ЛЮБЫМ
    // http(s)-URL (там всегда есть хотя бы один слэш), из-за чего ветка
    // 'Непонятная' была фактически недостижима, а почти все страницы,
    // не попавшие в info-паттерны, автоматически считались коммерческими.
    // Теперь URL разбирается на hostname/pathname, а главная страница
    // домена (пустой путь) обрабатывается отдельным явным условием.
    function determinePageType(url) {
      let hostname = '';
      let pathname = '';
      try {
        const parsed = new URL(url);
        hostname = parsed.hostname.toLowerCase();
        pathname = parsed.pathname.toLowerCase();
      } catch {
        return 'Непонятная';
      }

      const infoDomains = [
        'jetinfo.ru',
        'xakep.ru',
        'vc.ru',
        'ru.hostings.info',
        'pro-hosting.online',
        'hostradar.ru',
        'ru.tophosts.net',
        'dtf.ru',
        'medium.com',
      ];

      const infoPathPatterns = [
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
        '/press-centr'
      ];

      const isInfoDomain = infoDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
      if (isInfoDomain) return 'Информационная';

      const isInfoPath = infoPathPatterns.some((p) => pathname.includes(p));
      if (isInfoPath) return 'Информационная';

      // Паттерны для коммерческих страниц
      const commercePathPatterns = [
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
        '/protection'
      ];

      const isCommercePath = commercePathPatterns.some((p) => pathname.includes(p));
      if (isCommercePath) return 'Коммерческая';

      if (pathname === '' || pathname === '/') return 'Коммерческая';

      return 'Непонятная';
    }
    
    const organicResults = [];

    // Селекторы для органической выдачи (могут меняться)
    const resultItems = document.querySelectorAll('.serp-item[data-cid]');

    let position = 1;
    let organicPosition = 0; // Счетчик только для органических результатов

    resultItems.forEach((item) => {
      // Проверяем, что это не реклама
      const isAd = item.querySelector('.label_theme_direct, .ExtendedSerpItem-Label') !== null;

      // Извлекаем URL
      const linkElement = item.querySelector('.OrganicTitle-Link, .Link.organic__url');
      const url = linkElement ? linkElement.href : '';

      // Извлекаем заголовок
      const title = linkElement ? linkElement.textContent.trim() : '';

      if (url && title) {
        // Определяем тип ссылки
        const linkType = url.includes('yabs.yandex.ru') || isAd ? 'Реклама' : 'Органика';

        // Увеличиваем счетчик органической позиции только для органики
        if (linkType === 'Органика') {
          organicPosition++;
        }

        // Определяем тип страницы
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
  try {
    // Проверяем и создаем папку results если нужно
    const dir = path.dirname(filename);
    await ensureDirectoryExists(dir);
    
    // Заголовок CSV
    const header = 'Запрос,Тип запроса,Позиция,Поз.Органика,Тип,Тип страницы,Заголовок,URL\n';

    // Формируем строки CSV
    const rows = results.map(result => {
      return [
        escapeCSV(result.query),
        escapeCSV(result.queryType || 'Неопределенный'),
        result.position,
        result.organicPosition !== null ? result.organicPosition : '-',
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
  } catch (error) {
    console.error('Ошибка при сохранении CSV:', error.message);
    throw error;
  }
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
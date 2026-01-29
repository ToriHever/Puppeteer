import puppeteer from 'puppeteer';
import { readQueries, readCookies, saveCookies, saveToCSV, saveIncompleteQueries } from '../utils/files.js';
import { configureBrowser } from '../utils/browser.js';
import { sleep, sleepWithPauseCheck, randomMouseMovement, waitForUserInput, selectMode } from '../utils/helpers.js';
import { isPaused, pauseMessage } from '../utils/hotkeys.js';

export const MODES = {
  COOKIE: 'cookie',
  INCOGNITO: 'incognito'
};

export default class BaseParser {
  constructor(name) {
    this.name = name;
    this.results = [];
    this.incompleteQueries = [];
    this.browser = null;
    this.mode = null;
    this.minResultsThreshold = 10;
  }

  // Метод для получения конфигурации (переопределяется в наследниках)
  getConfig() {
    throw new Error('getConfig() должен быть реализован в дочернем классе');
  }

  // Метод для поиска (переопределяется в наследниках)
  async searchQuery(page, query) {
    throw new Error('searchQuery() должен быть реализован в дочернем классе');
  }

  // Метод для получения путей к файлам
  getPaths() {
    return {
      queries: './scripts/queries.txt',
      cookies: `./scripts/cookies/${this.name}.json`,
      results: `./results/${this.name}/results.csv`,
      incomplete: `./results/${this.name}/incomplete_queries.txt`,
      intermediateResults: `./results/${this.name}/results_intermediate.csv`,
      intermediateIncomplete: `./results/${this.name}/incomplete_queries_intermediate.txt`
    };
  }

  // Определение типа запроса
  determineQueryType(results, query) {
    const organicResults = results.filter(r => r.query === query && r.type === 'Органика');
    
    if (organicResults.length === 0) {
      return 'Неопределенный';
    }
    
    const commercialCount = organicResults.filter(r => r.pageType === 'Коммерческая').length;
    const ratio = commercialCount / organicResults.length;
    
    if (ratio > 0.4 && ratio <= 0.6) {
      return 'Полукоммерческий';
    } else if (ratio <= 0.4) {
      return 'Информационный';
    } else {
      return 'Коммерческий';
    }
  }

  // Добавление типа запроса к результатам
  addQueryTypeToResults(results) {
    const uniqueQueries = [...new Set(results.map(r => r.query))];
    const queryTypeMap = {};
    
    uniqueQueries.forEach(query => {
      queryTypeMap[query] = this.determineQueryType(results, query);
    });
    
    return results.map(result => ({
      ...result,
      queryType: queryTypeMap[result.query],
      searchEngine: this.name
    }));
  }

  // Сохранение промежуточных результатов
  async saveIntermediateResults() {
    try {
      const paths = this.getPaths();
      
      if (this.results.length > 0) {
        const resultsWithQueryType = this.addQueryTypeToResults(this.results);
        await saveToCSV(resultsWithQueryType, paths.intermediateResults, this.name);
        console.log(`\n💾 [${this.name}] Промежуточные результаты сохранены`);
        console.log(`   Сохранено результатов: ${this.results.length}`);
      }
      
      if (this.incompleteQueries.length > 0) {
        await saveIncompleteQueries(this.incompleteQueries, paths.intermediateIncomplete);
      }
    } catch (error) {
      console.error(`[${this.name}] Ошибка при сохранении промежуточных результатов:`, error.message);
    }
  }

  // Главный метод парсинга
  async parse() {
    try {
      console.log(`\n🚀 Инициализация парсера ${this.name.toUpperCase()}...`);

      // Выбор режима работы
      this.mode = await selectMode();

      // Читаем список запросов
      const paths = this.getPaths();
      const queries = await readQueries(paths.queries);
      console.log(`[${this.name}] Загружено ${queries.length} запросов`);

      let cookies = [];
      
      // Читаем куки только в режиме с куками
      if (this.mode === MODES.COOKIE) {
        cookies = await readCookies(paths.cookies);
        console.log(`[${this.name}] Загружено ${cookies.length} куки`);
      } else {
        console.log(`[${this.name}] 🕶️ Режим инкогнито: куки не используются`);
      }

      // Запускаем браузер
      const config = this.getConfig();
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

      if (this.mode === MODES.INCOGNITO) {
        launchOptions.args.push('--incognito');
      }

      this.browser = await puppeteer.launch(launchOptions);
      const page = await this.browser.newPage();

      // Настраиваем браузер
      await configureBrowser(page, this.mode === MODES.COOKIE ? cookies : [], config);

      // Парсим каждый запрос
      for (let i = 0; i < queries.length; i++) {
        // Проверяем паузу перед началом обработки запроса
        if (isPaused()) {
          console.log(`\n${pauseMessage()}[${this.name}] Ожидание возобновления...`);
          while (isPaused()) {
            await sleep(100);
          }
        }

        const query = queries[i];
        console.log(`\n${pauseMessage()}[${this.name}] ┌────────────────────────────────────────`);
        console.log(`${pauseMessage()}[${this.name}] │ Обработка запроса ${i + 1}/${queries.length}: "${query}"`);
        console.log(`${pauseMessage()}[${this.name}] └────────────────────────────────────────`);

        try {
          const searchResults = await this.searchQuery(page, query);
          
          // Проверяем количество результатов
          if (searchResults.length < this.minResultsThreshold) {
            console.warn(`[${this.name}] ⚠️ ВНИМАНИЕ: Найдено только ${searchResults.length} результатов (ожидалось минимум ${this.minResultsThreshold})`);
            console.log('Возможная причина: КАПЧА или блокировка');
            console.log('🔓 Откройте браузер и пройдите капчу вручную');
            
            this.incompleteQueries.push(query);
            
            // Ждем действия пользователя
            await waitForUserInput('После прохождения капчи');
            
            // Сохраняем обновленные куки ТОЛЬКО в режиме с куками
            if (this.mode === MODES.COOKIE) {
              console.log(`[${this.name}] 🍪 Сохранение обновленных куки...`);
              await saveCookies(page, paths.cookies);
            } else {
              console.log(`[${this.name}] 🕶️ Режим инкогнито: куки не сохраняются`);
            }
            
            // Повторяем попытку для того же запроса
            console.log(`[${this.name}] Повторная попытка для запроса "${query}"...`);
            const retryResults = await this.searchQuery(page, query);
            
            if (retryResults.length < this.minResultsThreshold) {
              console.warn(`[${this.name}] ⚠️ Результатов по-прежнему недостаточно: ${retryResults.length}`);
              console.log('Пропускаем запрос и продолжаем...');
            } else {
              console.log(`[${this.name}] ✓ Успешно получено ${retryResults.length} результатов`);
              // Удаляем из списка неполных, если повторная попытка успешна
              const index = this.incompleteQueries.indexOf(query);
              if (index > -1) {
                this.incompleteQueries.splice(index, 1);
              }
            }
            
            this.results.push(...retryResults);
          } else {
            console.log(`${pauseMessage()}[${this.name}] ✓ Найдено ${searchResults.length} результатов`);
            this.results.push(...searchResults);
          }

          // Случайная задержка между запросами
          const delay = 2000 + Math.random() * 3000;
          console.log(`${pauseMessage()}[${this.name}] ⏱ Пауза ${Math.round(delay / 1000)} сек с имитацией движения мыши...`);
          
          await Promise.all([
            randomMouseMovement(page, delay),
            sleepWithPauseCheck(delay)
          ]);

        } catch (error) {
          console.error(`[${this.name}] ❌ Ошибка при обработке запроса "${query}":`, error.message);
          this.incompleteQueries.push(query);
        }
      }

      // Сохраняем результаты
      const resultsWithQueryType = this.addQueryTypeToResults(this.results);
      await saveToCSV(resultsWithQueryType, paths.results, this.name);
      
      console.log(`\n[${this.name}] ✓ Парсинг завершен! Результаты сохранены в: ${paths.results}`);
      console.log(`  Режим работы: ${this.mode === MODES.COOKIE ? '🍪 С куками' : '🕶️ Инкогнито'}`);
      console.log(`  Всего обработано запросов: ${queries.length}`);
      console.log(`  Всего найдено результатов: ${this.results.length}`);

      // Сохраняем запросы с недостаточными результатами
      if (this.incompleteQueries.length > 0) {
        await saveIncompleteQueries(this.incompleteQueries, paths.incomplete);
      } else {
        console.log(`\n[${this.name}] ✓ Все запросы обработаны успешно!`);
      }

    } catch (error) {
      console.error(`[${this.name}] ❌ Критическая ошибка:`, error);
      
      console.log(`\n[${this.name}] 💾 Сохранение промежуточных результатов из-за ошибки...`);
      await this.saveIntermediateResults();
      
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }
}
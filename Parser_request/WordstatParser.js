import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { AuthManager } from './authManager.js';
import { StateManager } from './stateManager.js';
import { 
  generateRequestsWithOperators, 
  getRandomDelay, 
  delay, 
  normalizeQueryKey,
  hasAllMetrics,
  formatProgress,
  retryWithBackoff
} from './utils.js';

puppeteer.use(StealthPlugin());

/**
 * Основной класс парсера Wordstat
 */
export class WordstatParser {
  constructor() {
    this.browser = null;
    this.page = null;
    this.authManager = null;
    this.stateManager = new StateManager();
    this.csvWriter = null;
    this.isPaused = false;
    this.tasks = [];
  }

  /**
   * Инициализация парсера
   */
  async initialize() {
    logger.info('Инициализация парсера...');

    // Создаём папку для результатов
    if (!fs.existsSync(CONFIG.paths.outputDir)) {
      fs.mkdirSync(CONFIG.paths.outputDir, { recursive: true });
    }

    // Настройка CSV-писателя
    this.csvWriter = createCsvWriter({
      path: CONFIG.paths.outputFile,
      header: [
        { id: 'query', title: 'Запрос' },
        { id: 'frequency', title: 'Частота' },
        { id: 'frequencyWithQuotes', title: 'Частота с кавычками' },
        { id: 'frequencyWithExclamation', title: 'Частота с восклицаниями' }
      ],
      append: fs.existsSync(CONFIG.paths.outputFile)
    });

    // Запуск браузера
    this.browser = await puppeteer.launch({
      headless: CONFIG.browser.headless,
      defaultViewport: CONFIG.browser.viewport,
      args: CONFIG.browser.args
    });

    this.page = await this.browser.newPage();
    this.authManager = new AuthManager(this.page);

    // Добавляем UI панель управления
    await this.setupControlPanel();

    logger.success('Парсер инициализирован');
  }

  /**
   * Настройка панели управления в браузере
   */
  async setupControlPanel() {
    await this.page.exposeFunction('pauseParser', () => this.pause());
    await this.page.exposeFunction('resumeParser', () => this.resume());
    await this.page.exposeFunction('getParserStatus', () => this.getStatus());

    await this.page.evaluateOnNewDocument(() => {
      window.addEventListener('load', () => {
        const panel = document.createElement('div');
        panel.id = 'parser-control-panel';
        panel.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          z-index: 99999;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 15px;
          border-radius: 10px;
          font-family: 'Segoe UI', sans-serif;
          box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          color: white;
          min-width: 200px;
        `;

        const title = document.createElement('div');
        title.textContent = '🤖 Parser Control';
        title.style.cssText = 'font-weight: bold; margin-bottom: 10px; font-size: 14px;';
        panel.appendChild(title);

        const status = document.createElement('div');
        status.id = 'parser-status';
        status.style.cssText = 'margin-bottom: 10px; font-size: 12px;';
        status.textContent = 'Status: Running';
        panel.appendChild(status);

        const createButton = (text, callback) => {
          const btn = document.createElement('button');
          btn.textContent = text;
          btn.style.cssText = `
            margin: 5px 5px 0 0;
            padding: 8px 15px;
            background: white;
            color: #667eea;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            font-size: 12px;
            transition: all 0.3s;
          `;
          btn.onmouseover = () => btn.style.transform = 'scale(1.05)';
          btn.onmouseout = () => btn.style.transform = 'scale(1)';
          btn.onclick = callback;
          return btn;
        };

        panel.appendChild(createButton('⏸ Pause', () => window.pauseParser()));
        panel.appendChild(createButton('▶️ Resume', () => window.resumeParser()));

        document.body.appendChild(panel);

        // Обновление статуса каждые 2 секунды
        setInterval(async () => {
          const statusInfo = await window.getParserStatus();
          if (statusInfo) {
            status.textContent = `Status: ${statusInfo}`;
          }
        }, 2000);
      });
    });
  }

  /**
   * Загрузка задач из файла
   */
  loadTasks() {
    logger.info('Загрузка запросов...');
    
    if (!fs.existsSync(CONFIG.paths.requests)) {
      throw new Error(`Файл с запросами не найден: ${CONFIG.paths.requests}`);
    }

    const lines = fs.readFileSync(CONFIG.paths.requests, 'utf-8')
      .split('\n')
      .filter(Boolean);

    this.tasks = generateRequestsWithOperators(lines);
    
    logger.info(`Загружено ${lines.length} запросов, сгенерировано ${this.tasks.length} задач`);
  }

  /**
   * Парсинг одного запроса
   */
  async parseQuery(task) {
    const { type, query } = task;
    const key = normalizeQueryKey(query);
    const taskId = `${key}_${type}`;

    // Проверяем, не обработана ли уже эта задача
    if (this.stateManager.isTaskProcessed(taskId)) {
      logger.debug(`Задача уже обработана, пропускаем: ${taskId}`);
      return;
    }

    const result = this.stateManager.getResult(key);

    return retryWithBackoff(async () => {
      // Очистка и ввод запроса
      await this.page.click(CONFIG.selectors.input, { clickCount: 3 });
      await this.page.keyboard.press('Backspace');
      await delay(getRandomDelay(CONFIG.timing.minDelay, CONFIG.timing.maxDelay));
      
      await this.page.type(CONFIG.selectors.input, query);
      await this.page.keyboard.press('Enter');

      // Ожидание результата
      try {
        await this.page.waitForSelector(CONFIG.selectors.result, { 
          timeout: CONFIG.timing.selectorTimeout 
        });
        await delay(getRandomDelay(CONFIG.timing.afterSearchMin, CONFIG.timing.afterSearchMax));

        const freq = await this.page.evaluate((selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.split(':')[1]?.trim() : '0';
        }, CONFIG.selectors.result);

        const field = type === 'original' ? 'original'
                    : type === 'withQuotes' ? 'withQuotes'
                    : 'withExclamation';

        result[field] = freq;
        this.stateManager.updateResult(key, field, freq);
        this.stateManager.addProcessedTask(taskId);

        logger.info(`✓ ${key} | ${field} = ${freq}`);

      } catch (error) {
        if (error.message.includes('Waiting for selector')) {
          logger.warn(`Результат не найден для: ${query}, устанавливаем 0`);
          
          const field = type === 'original' ? 'original'
                      : type === 'withQuotes' ? 'withQuotes'
                      : 'withExclamation';
          
          result[field] = '0';
          this.stateManager.updateResult(key, field, '0');
          this.stateManager.addProcessedTask(taskId);
        } else {
          throw error;
        }
      }

      // Сохраняем в CSV если все метрики собраны
      if (hasAllMetrics(result)) {
        await this.csvWriter.writeRecords([{
          query: key,
          frequency: result.original,
          frequencyWithQuotes: result.withQuotes,
          frequencyWithExclamation: result.withExclamation
        }]);
        logger.success(`✓ Запрос завершен: ${key}`);
      }

    }, { query, type });
  }

  /**
   * Основной цикл парсинга
   */
  async parse() {
    logger.info('Начинаем парсинг...');
    
    const totalTasks = this.tasks.length;
    const startIndex = this.stateManager.state.currentIndex;

    for (let i = startIndex; i < totalTasks; i++) {
      // Проверка паузы
      while (this.isPaused || this.stateManager.isPaused()) {
        logger.info('⏸ Парсинг на паузе...');
        await delay(1000);
      }

      const task = this.tasks[i];
      const progress = formatProgress(i + 1, totalTasks);
      
      logger.info(`\n[${progress}] Обработка: ${task.query}`);

      try {
        await this.parseQuery(task);
      } catch (error) {
        logger.error(`Ошибка при обработке запроса: ${task.query}`, { 
          error: error.message 
        });
        
        // Сохраняем состояние при ошибке
        this.stateManager.updateCurrentIndex(i);
        this.stateManager.saveState();
        
        // Пересохраняем куки
        await this.authManager.saveCookies();
      }

      // Обновляем индекс и периодически сохраняем состояние
      this.stateManager.updateCurrentIndex(i + 1);
      
      if ((i + 1) % CONFIG.batch.saveInterval === 0) {
        this.stateManager.saveState();
        logger.debug('Промежуточное сохранение состояния');
      }
    }

    logger.success('🎉 Парсинг завершён!');
  }

  /**
   * Пауза парсинга
   */
  pause() {
    this.isPaused = true;
    this.stateManager.setPaused(true);
    logger.warn('⏸ Парсинг приостановлен');
  }

  /**
   * Возобновление парсинга
   */
  resume() {
    this.isPaused = false;
    this.stateManager.setPaused(false);
    logger.info('▶️ Парсинг возобновлён');
  }

  /**
   * Получение статуса
   */
  getStatus() {
    const stats = this.stateManager.getStats();
    const status = this.isPaused ? 'Paused' : 'Running';
    return `${status} | Processed: ${stats.processedTasks}`;
  }

  /**
   * Запуск парсера
   */
  async run() {
    try {
      await this.initialize();
      await this.authManager.ensureAuthenticated();
      this.loadTasks();
      await this.parse();
      
      // Финальное сохранение
      this.stateManager.saveState();
      
      return true;
    } catch (error) {
      logger.error('Критическая ошибка парсера', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Закрытие парсера
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      logger.info('Браузер закрыт');
    }
  }
}
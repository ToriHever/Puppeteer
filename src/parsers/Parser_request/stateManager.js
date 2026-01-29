import fs from 'fs';
import { CONFIG } from './config.js';
import { logger } from './logger.js';

/**
 * Класс для управления состоянием парсера
 */
export class StateManager {
  constructor(stateFilePath = CONFIG.paths.stateFile) {
    this.stateFilePath = stateFilePath;
    this.state = this.loadState();
  }

  /**
   * Загрузка состояния из файла
   */
  loadState() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const content = fs.readFileSync(this.stateFilePath, 'utf-8');
        const state = JSON.parse(content);
        logger.info('Состояние загружено из файла', { 
          processedCount: state.processedTasks?.length || 0 
        });
        return state;
      }
    } catch (error) {
      logger.warn('Не удалось загрузить состояние, начинаем с чистого листа', {
        error: error.message
      });
    }

    return {
      processedTasks: [],
      results: {},
      currentIndex: 0,
      startedAt: new Date().toISOString(),
      lastSavedAt: null,
      isPaused: false
    };
  }

  /**
   * Сохранение состояния в файл
   */
  saveState() {
    try {
      const dir = require('path').dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.state.lastSavedAt = new Date().toISOString();
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
      logger.debug('Состояние сохранено', { 
        processedCount: this.state.processedTasks.length 
      });
      return true;
    } catch (error) {
      logger.error('Ошибка сохранения состояния', { error: error.message });
      return false;
    }
  }

  /**
   * Добавление обработанной задачи
   */
  addProcessedTask(taskId) {
    if (!this.state.processedTasks.includes(taskId)) {
      this.state.processedTasks.push(taskId);
    }
  }

  /**
   * Проверка, была ли задача обработана
   */
  isTaskProcessed(taskId) {
    return this.state.processedTasks.includes(taskId);
  }

  /**
   * Обновление результата
   */
  updateResult(key, field, value) {
    if (!this.state.results[key]) {
      this.state.results[key] = {
        original: '',
        withQuotes: '',
        withExclamation: ''
      };
    }
    this.state.results[key][field] = value;
  }

  /**
   * Получение результата
   */
  getResult(key) {
    return this.state.results[key] || {
      original: '',
      withQuotes: '',
      withExclamation: ''
    };
  }

  /**
   * Обновление текущего индекса
   */
  updateCurrentIndex(index) {
    this.state.currentIndex = index;
  }

  /**
   * Установка паузы
   */
  setPaused(isPaused) {
    this.state.isPaused = isPaused;
    this.saveState();
  }

  /**
   * Проверка паузы
   */
  isPaused() {
    return this.state.isPaused === true;
  }

  /**
   * Очистка состояния
   */
  clear() {
    this.state = {
      processedTasks: [],
      results: {},
      currentIndex: 0,
      startedAt: new Date().toISOString(),
      lastSavedAt: null,
      isPaused: false
    };
    this.saveState();
    logger.info('Состояние очищено');
  }

  /**
   * Получение статистики
   */
  getStats() {
    return {
      processedTasks: this.state.processedTasks.length,
      currentIndex: this.state.currentIndex,
      resultsCount: Object.keys(this.state.results).length,
      startedAt: this.state.startedAt,
      lastSavedAt: this.state.lastSavedAt
    };
  }
}
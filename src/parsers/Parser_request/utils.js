import { CONFIG } from './config.js';
import { logger } from './logger.js';

/**
 * Генерирует запросы с операторами (полный режим)
 */
export function generateRequestsWithOperators(queries) {
  const updated = [];
  for (const q of queries) {
    const t = q.trim();
    if (!t) continue;
    
    updated.push({ type: 'original', query: t });
    updated.push({ type: 'withQuotes', query: `"${t}"` });
    
    const excl = t.split(' ').map(w => `!${w}`).join(' ');
    updated.push({ type: 'withExclamation', query: `"${excl}"` });
  }
  return updated;
}

/**
 * Генерирует простые запросы без операторов (быстрый режим)
 */
export function generateSimpleRequests(queries) {
  const updated = [];
  for (const q of queries) {
    const t = q.trim();
    if (!t) continue;
    
    updated.push({ type: 'original', query: t });
  }
  return updated;
}

/**
 * Генерирует запросы в зависимости от режима
 * @param {string[]} queries - Массив запросов
 * @param {string} mode - Режим работы: 'full' или 'simple'
 */
export function generateRequests(queries, mode = 'full') {
  if (mode === 'simple') {
    logger.info('Режим: Простые запросы (без операторов)');
    return generateSimpleRequests(queries);
  } else {
    logger.info('Режим: Полный анализ (с операторами)');
    return generateRequestsWithOperators(queries);
  }
}

/**
 * Возвращает случайную задержку
 */
export function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Задержка выполнения
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry с экспоненциальной задержкой
 */
export async function retryWithBackoff(fn, context = {}) {
  const { maxAttempts, initialDelay, maxDelay, factor } = CONFIG.retry;
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts) {
        logger.error(`Все попытки исчерпаны (${maxAttempts})`, { 
          context, 
          error: error.message 
        });
        throw error;
      }
      
      const delayMs = Math.min(initialDelay * Math.pow(factor, attempt - 1), maxDelay);
      logger.warn(`Попытка ${attempt}/${maxAttempts} не удалась. Повтор через ${delayMs}мс`, {
        error: error.message,
        context
      });
      
      await delay(delayMs);
    }
  }
  
  throw lastError;
}

/**
 * Нормализация ключа запроса
 */
export function normalizeQueryKey(query) {
  return query.replace(/['"!]/g, '').trim();
}

/**
 * Проверка наличия всех метрик (для полного режима)
 */
export function hasAllMetrics(result) {
  return result.original !== '' && 
         result.withQuotes !== '' && 
         result.withExclamation !== '';
}

/**
 * Проверка наличия метрик для простого режима
 */
export function hasSimpleMetrics(result) {
  return result.original !== '';
}

/**
 * Проверка завершенности результата в зависимости от режима
 */
export function isResultComplete(result, mode = 'full') {
  if (mode === 'simple') {
    return hasSimpleMetrics(result);
  } else {
    return hasAllMetrics(result);
  }
}

/**
 * Форматирование прогресса
 */
export function formatProgress(current, total) {
  const percentage = ((current / total) * 100).toFixed(1);
  const bar = createProgressBar(current, total, 30);
  return `${bar} ${current}/${total} (${percentage}%)`;
}

/**
 * Создание прогресс-бара
 */
function createProgressBar(current, total, width = 30) {
  const filled = Math.floor((current / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Форматирование времени в читаемый вид
 * @param {number} ms - Время в миллисекундах
 * @returns {string} Отформатированное время (чч:мм:сс)
 */
export function formatTime(ms) {
  if (!ms || ms < 0) return '--:--:--';
  
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Безопасное чтение JSON файла
 */
export function readJsonFile(filePath, defaultValue = null) {
  try {
    if (!require('fs').existsSync(filePath)) {
      return defaultValue;
    }
    const content = require('fs').readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(`Ошибка чтения JSON файла: ${filePath}`, { error: error.message });
    return defaultValue;
  }
}

/**
 * Безопасная запись JSON файла
 */
export function writeJsonFile(filePath, data) {
  try {
    require('fs').writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    logger.error(`Ошибка записи JSON файла: ${filePath}`, { error: error.message });
    return false;
  }
}
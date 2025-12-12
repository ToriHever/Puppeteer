import { WordstatParser } from './WordstatParser.js';
import { validateConfig } from './config.js';
import { logger } from './logger.js';
import { sendTelegramMessage } from '../Notifications_Telegram.js';

/**
 * Главная функция запуска парсера
 */
async function main() {
  let parser = null;

  try {
    // Валидация конфигурации
    validateConfig();
    logger.info('🚀 Запуск Wordstat Parser v2.0');

    // Создание и запуск парсера
    parser = new WordstatParser();
    
    // Обработка сигналов завершения
    setupGracefulShutdown(parser);

    // Запуск парсинга
    await parser.run();

    // Уведомление об успехе
    await sendTelegramMessage('✅ Парсинг Wordstat успешно завершён!');
    logger.success('Программа завершена успешно');

    process.exit(0);

  } catch (error) {
    logger.error('Критическая ошибка выполнения', {
      error: error.message,
      stack: error.stack
    });

    // Уведомление об ошибке
    await sendTelegramMessage(`❌ Ошибка парсинга Wordstat: ${error.message}`);

    if (parser) {
      await parser.close();
    }

    process.exit(1);
  }
}

/**
 * Настройка корректного завершения
 */
function setupGracefulShutdown(parser) {
  const shutdown = async (signal) => {
    logger.warn(`\n⚠️ Получен сигнал ${signal}, сохраняем состояние...`);
    
    if (parser) {
      parser.pause();
      parser.stateManager.saveState();
      await parser.close();
    }

    logger.info('Состояние сохранено. Для продолжения перезапустите скрипт.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Обработка необработанных ошибок
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Необработанное отклонение промиса', {
      reason: reason?.message || reason,
      promise: promise
    });

    if (parser) {
      parser.stateManager.saveState();
      await parser.close();
    }

    await sendTelegramMessage(`❌ Критическая ошибка: ${reason?.message || reason}`);
    process.exit(1);
  });

  process.on('uncaughtException', async (error) => {
    logger.error('Необработанное исключение', {
      error: error.message,
      stack: error.stack
    });

    if (parser) {
      parser.stateManager.saveState();
      await parser.close();
    }

    await sendTelegramMessage(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

// Запуск приложения
main();
import fs from 'fs';
import readline from 'readline';
import { WordstatParser } from './WordstatParser.js';
import { validateConfig, CONFIG } from './config.js';
import { logger } from './logger.js';
import { sendTelegramMessage } from '../Notifications_Telegram.js';

/**
 * Интерактивный запрос пользователя
 */
function question(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Очистка результатов перед запуском
 */
async function clearResultsIfNeeded() {
  const outputFile = CONFIG.paths.outputFile;
  const stateFile = CONFIG.paths.stateFile;
  
  const filesToCheck = [];
  
  if (fs.existsSync(outputFile)) {
    const stats = fs.statSync(outputFile);
    const lines = fs.readFileSync(outputFile, 'utf-8').split('\n').length - 1;
    filesToCheck.push({
      path: outputFile,
      name: 'CSV файл с результатами',
      size: (stats.size / 1024).toFixed(2) + ' KB',
      lines: lines
    });
  }
  
  if (fs.existsSync(stateFile)) {
    filesToCheck.push({
      path: stateFile,
      name: 'Файл состояния'
    });
  }

  if (filesToCheck.length === 0) {
    logger.info('📄 Предыдущие результаты не найдены. Начинаем с чистого листа.');
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('📋 НАЙДЕНЫ ПРЕДЫДУЩИЕ РЕЗУЛЬТАТЫ:');
  console.log('='.repeat(60));
  
  filesToCheck.forEach((file, index) => {
    console.log(`\n${index + 1}. ${file.name}`);
    console.log(`   Путь: ${file.path}`);
    if (file.size) console.log(`   Размер: ${file.size}`);
    if (file.lines) console.log(`   Строк данных: ~${file.lines}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('⚠️  ВНИМАНИЕ: Вы можете удалить старые результаты или продолжить с места остановки');
  console.log('='.repeat(60) + '\n');

  const answer = await question('Удалить предыдущие результаты? (yes/no) [no]: ');
  
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    let deleted = 0;
    
    for (const file of filesToCheck) {
      try {
        fs.unlinkSync(file.path);
        logger.success(`✅ Удалено: ${file.name}`);
        deleted++;
      } catch (error) {
        logger.error(`❌ Ошибка при удалении ${file.name}:`, { error: error.message });
      }
    }
    
    logger.success(`\n✅ Удалено файлов: ${deleted}/${filesToCheck.length}`);
    logger.info('ℹ️  Парсинг начнётся с начала.\n');
  } else {
    logger.info('\n✅ Результаты сохранены. Парсинг продолжится с места остановки.\n');
  }
}

/**
 * Главная функция запуска парсера
 */
async function main() {
  let parser = null;

  try {
    // Валидация конфигурации
    validateConfig();
    
    console.log('\n' + '='.repeat(60));
    console.log('🚀 WORDSTAT PARSER v2.1');
    console.log('='.repeat(60) + '\n');

    // Проверка и очистка результатов
    await clearResultsIfNeeded();

    logger.info('🚀 Запуск парсера...');

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
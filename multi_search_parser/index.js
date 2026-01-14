import YandexParser from './parsers/yandex.js';
import GoogleParser from './parsers/google.js';
import { initializeHotkeys } from './utils/hotkeys.js';
import readline from 'readline';

// Функция выбора поисковой системы
function selectSearchEngine() {
  return new Promise((resolve) => {
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║     ВЫБОР ПОИСКОВОЙ СИСТЕМЫ ДЛЯ ПАРСИНГА          ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');
    console.log('1. 🔍 Yandex');
    console.log('2. 🔍 Google');
    console.log('3. 🔄 Обе системы (последовательно)');
    console.log('4. ⚡ Обе системы (параллельно)\n');
    console.log('Выберите опцию (1-4): ');

    let resolved = false;
    const onKeypress = (str, key) => {
      if (!resolved && ['1', '2', '3', '4'].includes(str)) {
        resolved = true;
        process.stdin.removeListener('keypress', onKeypress);
        
        const choices = {
          '1': 'Yandex',
          '2': 'Google',
          '3': 'Обе (последовательно)',
          '4': 'Обе (параллельно)'
        };
        
        console.log(`\n✓ Выбрано: ${choices[str]}\n`);
        resolve(str);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

// Главная функция
async function main() {
  let yandexParser;
  let googleParser;

  // Обработчик прерывания
  const handleInterrupt = async (signal) => {
    console.log(`\n\n⚠️ Получен сигнал прерывания (${signal})`);
    console.log('Сохранение промежуточных результатов...');
    
    if (yandexParser) {
      await yandexParser.saveIntermediateResults();
    }
    if (googleParser) {
      await googleParser.saveIntermediateResults();
    }
    
    console.log('✓ Скрипт остановлен');
    process.exit(0);
  };

  process.on('SIGINT', handleInterrupt);
  process.on('SIGTERM', handleInterrupt);

  try {
    // Инициализируем горячие клавиши
    initializeHotkeys();

    // Выбираем поисковую систему
    const choice = await selectSearchEngine();

    switch(choice) {
      case '1':
        console.log('🔍 Запуск парсера Yandex...\n');
        yandexParser = new YandexParser();
        await yandexParser.parse();
        break;
        
      case '2':
        console.log('🔍 Запуск парсера Google...\n');
        googleParser = new GoogleParser();
        await googleParser.parse();
        break;
        
      case '3':
        console.log('🔍 Запуск парсеров последовательно...\n');
        
        console.log('═══════════════════════════════════════');
        console.log('ЭТАП 1: Парсинг Yandex');
        console.log('═══════════════════════════════════════\n');
        yandexParser = new YandexParser();
        await yandexParser.parse();
        
        console.log('\n═══════════════════════════════════════');
        console.log('ЭТАП 2: Парсинг Google');
        console.log('═══════════════════════════════════════\n');
        googleParser = new GoogleParser();
        await googleParser.parse();
        break;
        
      case '4':
        console.log('🔍 Запуск парсеров параллельно...\n');
        console.log('⚠️ ВНИМАНИЕ: Параллельный режим требует больше ресурсов\n');
        
        yandexParser = new YandexParser();
        googleParser = new GoogleParser();
        
        await Promise.all([
          yandexParser.parse(),
          googleParser.parse()
        ]);
        break;
    }

    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║          ✓ ВСЕ ЗАДАЧИ ВЫПОЛНЕНЫ                   ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
  } finally {
    // Очистка
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('keypress');
  }
}

// Запуск
main();
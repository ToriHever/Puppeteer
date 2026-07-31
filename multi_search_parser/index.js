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

// Парсинг аргументов командной строки
function parseArgs() {
  const args = process.argv.slice(2);
  const engineArg = args.find(arg => arg.startsWith('--engine='));

  if (engineArg) {
    const engine = engineArg.split('=')[1];
    const mapping = {
      'yandex': '1',
      'google': '2',
      'both-seq': '3',
      'both-par': '4'
    };
    return mapping[engine];
  }

  return null;
}

// Флаг скриншотов из командной строки: --screenshots / --no-screenshots.
// Возвращает true/false, если флаг передан явно, иначе null (спросим интерактивно).
function parseScreenshotArg() {
  const args = process.argv.slice(2);
  if (args.includes('--screenshots')) return true;
  if (args.includes('--no-screenshots')) return false;
  return null;
}

// Интерактивный вопрос: делать ли скриншоты выдачи по каждому запросу
function selectScreenshotOption() {
  return new Promise((resolve) => {
    console.log('\n📸 Делать скриншоты выдачи по каждому запросу?');
    console.log('   (сохраняются в results/<движок>/screenshots/, подпись: "запрос ДД ММ ГГГГ")');
    console.log('1. Да');
    console.log('2. Нет\n');
    console.log('Выберите (1 или 2): ');

    let resolved = false;
    const onKeypress = (str) => {
      if (!resolved && (str === '1' || str === '2')) {
        resolved = true;
        process.stdin.removeListener('keypress', onKeypress);
        const enabled = str === '1';
        console.log(`\n✓ Скриншоты: ${enabled ? 'включены' : 'выключены'}\n`);
        resolve(enabled);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

// Флаг анализа расширенных элементов выдачи: --serp-features / --no-serp-features
function parseSerpFeaturesArg() {
  const args = process.argv.slice(2);
  if (args.includes('--serp-features')) return true;
  if (args.includes('--no-serp-features')) return false;
  return null;
}

// Интерактивный вопрос: анализировать ли расширенные элементы выдачи
function selectSerpFeaturesOption() {
  return new Promise((resolve) => {
    console.log('\n🧩 Анализировать расширенные элементы выдачи (ИИ-обзор, картинки, видео, боковая панель, похожие вопросы)?');
    console.log('   (сохраняются в results/<движок>/serp_features.csv)');
    console.log('1. Да');
    console.log('2. Нет\n');
    console.log('Выберите (1 или 2): ');

    let resolved = false;
    const onKeypress = (str) => {
      if (!resolved && (str === '1' || str === '2')) {
        resolved = true;
        process.stdin.removeListener('keypress', onKeypress);
        const enabled = str === '1';
        console.log(`\n✓ Анализ расширенных элементов: ${enabled ? 'включён' : 'выключен'}\n`);
        resolve(enabled);
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

    // Проверяем аргументы командной строки
    const argChoice = parseArgs();
    const choice = argChoice || await selectSearchEngine();

    const screenshotArg = parseScreenshotArg();
    const screenshotsEnabled = screenshotArg !== null ? screenshotArg : await selectScreenshotOption();

    const serpFeaturesArg = parseSerpFeaturesArg();
    const serpFeaturesEnabled = serpFeaturesArg !== null ? serpFeaturesArg : await selectSerpFeaturesOption();

    const parserOptions = { screenshots: screenshotsEnabled, serpFeatures: serpFeaturesEnabled };

    switch(choice) {
      case '1':
        console.log('🔍 Запуск парсера Yandex...\n');
        yandexParser = new YandexParser(parserOptions);
        await yandexParser.parse();
        break;

      case '2':
        console.log('🔍 Запуск парсера Google...\n');
        googleParser = new GoogleParser(parserOptions);
        await googleParser.parse();
        break;

      case '3':
        console.log('🔍 Запуск парсеров последовательно...\n');

        console.log('═══════════════════════════════════════');
        console.log('ЭТАП 1: Парсинг Yandex');
        console.log('═══════════════════════════════════════\n');
        yandexParser = new YandexParser(parserOptions);
        await yandexParser.parse();

        console.log('\n═══════════════════════════════════════');
        console.log('ЭТАП 2: Парсинг Google');
        console.log('═══════════════════════════════════════\n');
        googleParser = new GoogleParser(parserOptions);
        await googleParser.parse();
        break;

      case '4':
        console.log('🔍 Запуск парсеров параллельно...\n');
        console.log('⚠️ ВНИМАНИЕ: Параллельный режим требует больше ресурсов\n');

        yandexParser = new YandexParser(parserOptions);
        googleParser = new GoogleParser(parserOptions);

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
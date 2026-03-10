import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { createObjectCsvWriter } from 'csv-writer';
import chalk from 'chalk';
import delay from 'delay';
import dotenv from 'dotenv';
import readline from 'readline';

// Получаем текущую директорию для ES модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загрузка переменных окружения из корневой папки
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const API_TOKEN = process.env.WORDSTAT_API_TOKEN;

// API URLs
const API_DYNAMICS_URL = 'https://api.wordstat.yandex.net/v1/dynamics';
const API_TOP_REQUESTS_URL = 'https://api.wordstat.yandex.net/v1/topRequests';

// Проверка наличия токена
if (!API_TOKEN) {
  console.error(chalk.red('❌ Ошибка: WORDSTAT_API_TOKEN не найден в .env файле'));
  console.log(chalk.yellow('\nДля начала работы:'));
  console.log(chalk.white('1. Создайте файл .env в корневой папке проекта'));
  console.log(chalk.white('2. Добавьте строку: WORDSTAT_API_TOKEN=ваш_токен'));
  console.log(chalk.white('3. Получите токен на: https://oauth.yandex.ru/'));
  process.exit(1);
}

// Пути к файлам
const REQUEST_FILE = path.join(__dirname, 'requests.txt');
const RESULT_DIR = path.join(__dirname, 'Result');

// Создание директории для результатов
if (!fs.existsSync(RESULT_DIR)) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
}

/**
 * Интерфейс для ввода данных
 */
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Функция для получения ввода пользователя
 */
function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

/**
 * Валидация даты
 */
function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

/**
 * Выбор режима работы
 */
async function selectMode() {
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.cyan('  🎯 Выбор режима работы'));
  console.log(chalk.cyan('='.repeat(60) + '\n'));

  console.log(chalk.white('Доступные режимы:'));
  console.log(chalk.yellow('  1') + chalk.white(' - Динамика запросов (получение статистики показов по месяцам)'));
  console.log(chalk.yellow('  2') + chalk.white(' - Топовые запросы (получение связанных популярных запросов)\n'));

  let choice = await question(chalk.green('Выберите режим (1-2): '));
  choice = choice.trim();

  const mode = (choice === '2') ? 'top' : 'dynamics';
  const modeName = (mode === 'top') ? 'Топовые запросы' : 'Динамика запросов';

  console.log(chalk.green(`✓ Выбран режим: ${modeName}\n`));

  return mode;
}

/**
 * Выбор формата сохранения
 */
async function selectFormat() {
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.cyan('  💾 Выбор формата сохранения данных'));
  console.log(chalk.cyan('='.repeat(60) + '\n'));

  console.log(chalk.white('Доступные форматы:'));
  console.log(chalk.yellow('  1') + chalk.white(' - Перекрестная таблица (Запрос | Всего | 2024-01 | 2024-02 | ...)'));
  console.log(chalk.yellow('  2') + chalk.white(' - Обычная таблица (Запрос | Месяц | Частота)\n'));

  let choice = await question(chalk.green('Выберите формат (1-2): '));
  choice = choice.trim();

  const format = (choice === '2') ? 'normal' : 'pivot';
  const formatName = (format === 'normal') ? 'Обычная таблица' : 'Перекрестная таблица';

  console.log(chalk.green(`✓ Выбран формат: ${formatName}\n`));

  return format;
}

/**
 * Интерактивный выбор периода
 */
async function selectPeriod() {
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.cyan('  📅 Выбор периода для получения статистики'));
  console.log(chalk.cyan('='.repeat(60) + '\n'));

  console.log(chalk.white('Доступные варианты:'));
  console.log(chalk.yellow('  1') + chalk.white(' - 2024 год (с 2024-01-01 по 2024-12-31)'));
  console.log(chalk.yellow('  2') + chalk.white(' - 2025 год (с 2025-01-01 по 2025-12-31)'));
  console.log(chalk.yellow('  3') + chalk.white(' - Последние 12 месяцев'));
  console.log(chalk.yellow('  4') + chalk.white(' - Свой период (ввести даты вручную)\n'));

  let choice = await question(chalk.green('Выберите вариант (1-4): '));
  choice = choice.trim();

  let fromDate, toDate, periodName;

  switch (choice) {
    case '1':
      fromDate = '2024-01-01';
      toDate = '2024-12-31';
      periodName = '2024 год';
      break;

    case '2':
      fromDate = '2025-01-01';
      toDate = '2025-12-31';
      periodName = '2025 год';
      break;

    case '3':
      const today = new Date();
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const twelveMonthsAgo = new Date(lastMonth.getFullYear(), lastMonth.getMonth() - 11, 1);
      
      fromDate = twelveMonthsAgo.toISOString().split('T')[0];
      toDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0).toISOString().split('T')[0];
      periodName = 'Последние 12 месяцев';
      break;

    case '4':
      console.log(chalk.yellow('\n📝 Введите даты в формате YYYY-MM-DD (например, 2024-01-01)\n'));
      
      while (true) {
        fromDate = await question(chalk.green('Дата начала (fromDate): '));
        fromDate = fromDate.trim();
        
        if (isValidDate(fromDate)) {
          break;
        } else {
          console.log(chalk.red('❌ Неверный формат даты. Используйте формат YYYY-MM-DD'));
        }
      }

      while (true) {
        toDate = await question(chalk.green('Дата окончания (toDate): '));
        toDate = toDate.trim();
        
        if (isValidDate(toDate)) {
          if (new Date(toDate) >= new Date(fromDate)) {
            break;
          } else {
            console.log(chalk.red('❌ Дата окончания должна быть больше или равна дате начала'));
          }
        } else {
          console.log(chalk.red('❌ Неверный формат даты. Используйте формат YYYY-MM-DD'));
        }
      }

      periodName = `Период с ${fromDate} по ${toDate}`;
      break;

    default:
      console.log(chalk.red('\n❌ Неверный выбор. Используется 2025 год по умолчанию.\n'));
      fromDate = '2025-01-01';
      toDate = '2025-12-31';
      periodName = '2025 год (по умолчанию)';
  }

  console.log(chalk.green(`\n✓ Выбран период: ${periodName}`));
  console.log(chalk.gray(`  От: ${fromDate}`));
  console.log(chalk.gray(`  До: ${toDate}\n`));

  return { fromDate, toDate, periodName };
}

/**
 * Чтение списка запросов из файла
 */
function readRequests() {
  try {
    if (!fs.existsSync(REQUEST_FILE)) {
      console.error(chalk.red(`❌ Файл ${REQUEST_FILE} не найден`));
      console.log(chalk.yellow('\nСоздайте файл Parser_wordstat_api/requests.txt'));
      console.log(chalk.white('И добавьте запросы (каждый с новой строки)'));
      return [];
    }

    const content = fs.readFileSync(REQUEST_FILE, 'utf-8');
    const requests = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (requests.length === 0) {
      console.log(chalk.yellow('⚠️  Файл requests.txt пуст'));
      console.log(chalk.white('Добавьте запросы в файл Parser_wordstat_api/requests.txt'));
    }

    return requests;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка чтения файла ${REQUEST_FILE}:`), error.message);
    return [];
  }
}

/**
 * Получение динамики для запроса за указанный период
 */
async function getWordstatDynamics(phrase, fromDate, toDate, index, total) {
  const requestBody = {
    phrase: phrase,
    period: 'monthly',
    fromDate: fromDate,
    toDate: toDate
  };

  try {
    const response = await axios.post(API_DYNAMICS_URL, requestBody, {
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Authorization': `Bearer ${API_TOKEN}`
      }
    });

    if (response.data && response.data.dynamics) {
      const dynamics = response.data.dynamics;
      
      // Преобразуем массив dynamics в объект с ключами по месяцам
      const monthlyData = {};
      let totalCount = 0;

      dynamics.forEach(item => {
        const date = new Date(item.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyData[monthKey] = item.count;
        totalCount += item.count;
      });

      console.log(chalk.green(`✓ [${index}/${total}] "${phrase}" - ${totalCount.toLocaleString()} показов`));

      return {
        phrase,
        monthlyData,
        totalCount,
        requestPhrase: response.data.requestPhrase,
        success: true
      };
    }

    console.log(chalk.yellow(`⚠️  [${index}/${total}] "${phrase}" - нет данных`));
    return { phrase, success: false };
  } catch (error) {
    console.error(chalk.red(`❌ [${index}/${total}] "${phrase}" - ${error.response?.data?.message || error.message}`));
    return { phrase, success: false, error: error.message };
  }
}

/**
 * Получение топовых запросов для фразы
 */
async function getTopRequests(phrase, index, total) {
  const requestBody = {
    phrase: phrase
  };

  try {
    const response = await axios.post(API_TOP_REQUESTS_URL, requestBody, {
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Authorization': `Bearer ${API_TOKEN}`
      }
    });

    if (response.data && response.data.topRequests) {
      const topRequests = response.data.topRequests;
      
      console.log(chalk.green(`✓ [${index}/${total}] "${phrase}" - найдено ${topRequests.length} связанных запросов`));

      return {
        phrase,
        topRequests: topRequests,
        requestPhrase: response.data.requestPhrase,
        success: true
      };
    }

    console.log(chalk.yellow(`⚠️  [${index}/${total}] "${phrase}" - нет данных`));
    return { phrase, success: false };
  } catch (error) {
    console.error(chalk.red(`❌ [${index}/${total}] "${phrase}" - ${error.response?.data?.message || error.message}`));
    return { phrase, success: false, error: error.message };
  }
}

/**
 * Обработка запросов пакетами для режима динамики
 */
async function processDynamicsBatch(phrases, fromDate, toDate, startIndex) {
  const batchPromises = phrases.map((phrase, i) => 
    getWordstatDynamics(phrase, fromDate, toDate, startIndex + i + 1, startIndex + phrases.length)
  );
  
  return await Promise.all(batchPromises);
}

/**
 * Обработка запросов пакетами для режима топовых запросов
 */
async function processTopRequestsBatch(phrases, startIndex) {
  const batchPromises = phrases.map((phrase, i) => 
    getTopRequests(phrase, startIndex + i + 1, startIndex + phrases.length)
  );
  
  return await Promise.all(batchPromises);
}

/**
 * Обработка всех запросов в режиме динамики
 */
async function processAllDynamics(requests, fromDate, toDate) {
  const BATCH_SIZE = 10;
  const results = [];
  let successCount = 0;
  let errorCount = 0;

  console.log(chalk.cyan(`\n⚡ Режим быстрой обработки: до ${BATCH_SIZE} запросов одновременно\n`));

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(requests.length / BATCH_SIZE);

    console.log(chalk.blue(`\n📦 Пакет ${batchNumber}/${totalBatches} (${batch.length} запросов)...`));
    
    const startTime = Date.now();
    const batchResults = await processDynamicsBatch(batch, fromDate, toDate, i);
    const endTime = Date.now();

    // Обработка результатов пакета
    batchResults.forEach(result => {
      if (result.success && result.monthlyData) {
        results.push({
          query: result.phrase,
          total: result.totalCount,
          ...result.monthlyData
        });
        successCount++;
      } else {
        errorCount++;
      }
    });

    // Показываем статистику пакета
    const batchTime = ((endTime - startTime) / 1000).toFixed(2);
    console.log(chalk.gray(`   Обработано за ${batchTime}с`));

    // Задержка между пакетами (1 секунда)
    if (i + BATCH_SIZE < requests.length) {
      console.log(chalk.gray(`   ⏱️  Пауза 1 секунда перед следующим пакетом...`));
      await delay(1000);
    }
  }

  return { results, successCount, errorCount };
}

/**
 * Обработка всех запросов в режиме топовых запросов
 */
async function processAllTopRequests(requests) {
  const BATCH_SIZE = 10;
  const results = [];
  let successCount = 0;
  let errorCount = 0;

  console.log(chalk.cyan(`\n⚡ Режим быстрой обработки: до ${BATCH_SIZE} запросов одновременно\n`));

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(requests.length / BATCH_SIZE);

    console.log(chalk.blue(`\n📦 Пакет ${batchNumber}/${totalBatches} (${batch.length} запросов)...`));
    
    const startTime = Date.now();
    const batchResults = await processTopRequestsBatch(batch, i);
    const endTime = Date.now();

    // Обработка результатов пакета
    batchResults.forEach(result => {
      if (result.success && result.topRequests) {
        // Добавляем каждый связанный запрос как отдельную строку
        result.topRequests.forEach((topRequest, index) => {
          results.push({
            originalQuery: result.phrase,
            rank: index + 1,
            relatedQuery: topRequest.phrase,
            frequency: topRequest.count
          });
        });
        successCount++;
      } else {
        errorCount++;
      }
    });

    // Показываем статистику пакета
    const batchTime = ((endTime - startTime) / 1000).toFixed(2);
    console.log(chalk.gray(`   Обработано за ${batchTime}с`));

    // Задержка между пакетами (1 секунда)
    if (i + BATCH_SIZE < requests.length) {
      console.log(chalk.gray(`   ⏱️  Пауза 1 секунда перед следующим пакетом...`));
      await delay(1000);
    }
  }

  return { results, successCount, errorCount };
}

/**
 * Сохранение результатов динамики в CSV
 */
async function saveDynamicsResults(results, format, fromDate, toDate, successCount, errorCount, totalTime, totalRequests) {
  const RESULT_FILE = path.join(RESULT_DIR, `wordstat_dynamics_${fromDate}_${toDate}_${format}.csv`);

  if (format === 'normal') {
    // Обычная таблица: Запрос | Месяц | Частота
    const normalData = [];
    
    results.forEach(row => {
      const query = row.query;
      Object.keys(row).forEach(key => {
        if (key !== 'query' && key !== 'total') {
          normalData.push({
            query: query,
            month: key,
            frequency: row[key]
          });
        }
      });
    });

    const csvWriter = createObjectCsvWriter({
      path: RESULT_FILE,
      header: [
        { id: 'query', title: 'Запрос' },
        { id: 'month', title: 'Месяц' },
        { id: 'frequency', title: 'Частота' }
      ],
      encoding: 'utf8'
    });

    await csvWriter.writeRecords(normalData);

    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.green(`✅ Результаты сохранены в: ${RESULT_FILE}`));
    console.log(chalk.green(`✅ Формат: Обычная таблица`));
    console.log(chalk.green(`✅ Записей: ${normalData.length} (${successCount} запросов × месяцев)`));
    if (errorCount > 0) {
      console.log(chalk.yellow(`⚠️  Ошибок: ${errorCount} запросов`));
    }
    console.log(chalk.blue(`⏱️  Общее время: ${totalTime}с`));
    console.log(chalk.gray(`   Средняя скорость: ${(totalRequests / totalTime).toFixed(2)} запросов/сек`));
    console.log(chalk.cyan('='.repeat(60) + '\n'));

  } else {
    // Перекрестная таблица: Запрос | Всего | 2024-01 | 2024-02 | ...
    const allMonths = new Set();
    results.forEach(row => {
      Object.keys(row).forEach(key => {
        if (key !== 'query' && key !== 'total') {
          allMonths.add(key);
        }
      });
    });

    const sortedMonths = Array.from(allMonths).sort();

    const headers = [
      { id: 'query', title: 'Запрос' },
      { id: 'total', title: 'Всего за период' },
      ...sortedMonths.map(month => ({ id: month, title: month }))
    ];

    const csvWriter = createObjectCsvWriter({
      path: RESULT_FILE,
      header: headers,
      encoding: 'utf8'
    });

    await csvWriter.writeRecords(results);

    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.green(`✅ Результаты сохранены в: ${RESULT_FILE}`));
    console.log(chalk.green(`✅ Формат: Перекрестная таблица`));
    console.log(chalk.green(`✅ Успешно обработано: ${successCount} запросов`));
    if (errorCount > 0) {
      console.log(chalk.yellow(`⚠️  Ошибок: ${errorCount} запросов`));
    }
    console.log(chalk.blue(`⏱️  Общее время: ${totalTime}с`));
    console.log(chalk.gray(`   Средняя скорость: ${(totalRequests / totalTime).toFixed(2)} запросов/сек`));
    console.log(chalk.cyan('='.repeat(60) + '\n'));
  }
}

/**
 * Сохранение результатов топовых запросов в CSV
 */
async function saveTopRequestsResults(results, successCount, errorCount, totalTime, totalRequests) {
  const timestamp = new Date().toISOString().split('T')[0];
  const RESULT_FILE = path.join(RESULT_DIR, `wordstat_top_requests_${timestamp}.csv`);

  const csvWriter = createObjectCsvWriter({
    path: RESULT_FILE,
    header: [
      { id: 'originalQuery', title: 'Исходный запрос' },
      { id: 'rank', title: 'Позиция' },
      { id: 'relatedQuery', title: 'Связанный запрос' },
      { id: 'frequency', title: 'Частота показов' }
    ],
    encoding: 'utf8'
  });

  await csvWriter.writeRecords(results);

  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.green(`✅ Результаты сохранены в: ${RESULT_FILE}`));
  console.log(chalk.green(`✅ Успешно обработано: ${successCount} запросов`));
  console.log(chalk.green(`✅ Найдено связанных запросов: ${results.length}`));
  if (errorCount > 0) {
    console.log(chalk.yellow(`⚠️  Ошибок: ${errorCount} запросов`));
  }
  console.log(chalk.blue(`⏱️  Общее время: ${totalTime}с`));
  console.log(chalk.gray(`   Средняя скорость: ${(totalRequests / totalTime).toFixed(2)} запросов/сек`));
  console.log(chalk.cyan('='.repeat(60) + '\n'));
}

/**
 * Основная функция
 */
async function main() {
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.cyan('  📈 Wordstat API - Парсер данных Яндекс.Вордстат'));
  console.log(chalk.cyan('='.repeat(60) + '\n'));

  // Выбор режима работы
  const mode = await selectMode();

  let fromDate, toDate, periodName, format;

  if (mode === 'dynamics') {
    // Интерактивный выбор периода для режима динамики
    const period = await selectPeriod();
    fromDate = period.fromDate;
    toDate = period.toDate;
    periodName = period.periodName;

    // Интерактивный выбор формата для режима динамики
    format = await selectFormat();
  }

  console.log(chalk.gray(`API URL: ${mode === 'dynamics' ? API_DYNAMICS_URL : API_TOP_REQUESTS_URL}`));
  console.log(chalk.gray(`Токен: ${API_TOKEN.substring(0, 10)}...${API_TOKEN.substring(API_TOKEN.length - 5)}`));
  console.log(chalk.gray(`Метод авторизации: Bearer Token\n`));

  const requests = readRequests();

  if (requests.length === 0) {
    rl.close();
    return;
  }

  console.log(chalk.green(`✓ Найдено запросов: ${requests.length}`));
  console.log(chalk.cyan('🚀 Начинаю обработку...\n'));

  const startTime = Date.now();
  let results, successCount, errorCount;

  if (mode === 'dynamics') {
    // Режим динамики
    const processed = await processAllDynamics(requests, fromDate, toDate);
    results = processed.results;
    successCount = processed.successCount;
    errorCount = processed.errorCount;

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Сохранение результатов
    if (results.length > 0) {
      await saveDynamicsResults(results, format, fromDate, toDate, successCount, errorCount, totalTime, requests.length);
    } else {
      console.log(chalk.yellow('\n⚠️  Нет данных для сохранения'));
      console.log(chalk.red(`❌ Все запросы завершились с ошибкой\n`));
    }
  } else {
    // Режим топовых запросов
    const processed = await processAllTopRequests(requests);
    results = processed.results;
    successCount = processed.successCount;
    errorCount = processed.errorCount;

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Сохранение результатов
    if (results.length > 0) {
      await saveTopRequestsResults(results, successCount, errorCount, totalTime, requests.length);
    } else {
      console.log(chalk.yellow('\n⚠️  Нет данных для сохранения'));
      console.log(chalk.red(`❌ Все запросы завершились с ошибкой\n`));
    }
  }

  rl.close();
}

// Запуск скрипта
main().catch(error => {
  console.error(chalk.red('\n❌ Критическая ошибка:'), error);
  console.error(error.stack);
  rl.close();
  process.exit(1);
});
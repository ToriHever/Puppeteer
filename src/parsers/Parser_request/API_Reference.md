# API Reference

Документация по основным классам и методам парсера.

## 📚 Содержание

- [CONFIG](#config)
- [Logger](#logger)
- [Utils](#utils)
- [StateManager](#statemanager)
- [AuthManager](#authmanager)
- [WordstatParser](#wordstatparser)

---

## CONFIG

Объект конфигурации со всеми настройками парсера.

### Структура

```javascript
CONFIG = {
  auth: {
    login: string,        // Из .env: YANDEX_LOGIN
    password: string,     // Из .env: YANDEX_PASSWORD
    authUrl: string,      // URL авторизации
    targetUrl: string     // URL Wordstat
  },
  
  paths: {
    base: string,         // Базовая директория
    cookies: string,      // Путь к файлу куков
    requests: string,     // Путь к файлу запросов
    outputDir: string,    // Папка результатов
    outputFile: string,   // CSV файл
    stateFile: string,    // Файл состояния
    logFile: string       // Файл логов
  },
  
  selectors: {
    input: string,        // Поле ввода запроса
    result: string,       // Элемент с результатом
    loginInput: string,   // Поле логина
    passwordInput: string,// Поле пароля
    signInButton: string  // Кнопка входа
  },
  
  timing: {
    navigationTimeout: number,  // 60000ms
    selectorTimeout: number,    // 10000ms
    minDelay: number,           // 500ms
    maxDelay: number,           // 1000ms
    afterSearchMin: number,     // 1000ms
    afterSearchMax: number,     // 3000ms
    typingDelay: number         // 100ms
  },
  
  retry: {
    maxAttempts: number,   // 3
    initialDelay: number,  // 1000ms
    maxDelay: number,      // 10000ms
    factor: number         // 2 (экспонента)
  },
  
  batch: {
    size: number,         // 10
    saveInterval: number  // 5 (каждые 5 задач)
  }
}
```

### Методы

#### `validateConfig()`
Валидация обязательных переменных окружения.

**Throws**: `Error` если credentials не установлены

```javascript
import { validateConfig } from './config.js';

validateConfig(); // Бросит ошибку если нет .env
```

---

## Logger

Класс для продвинутого логирования.

### Методы

#### `info(message, meta?)`
Информационное сообщение (🔵 синий).

```javascript
logger.info('Парсинг начат', { count: 100 });
```

#### `warn(message, meta?)`
Предупреждение (🟡 жёлтый).

```javascript
logger.warn('Куки истекли', { file: 'cookies.json' });
```

#### `error(message, meta?)`
Ошибка (🔴 красный).

```javascript
logger.error('Не удалось загрузить страницу', { 
  url: 'https://...',
  error: error.message 
});
```

#### `success(message, meta?)`
Успешная операция (🟢 зелёный).

```javascript
logger.success('Парсинг завершён', { total: 100 });
```

#### `debug(message, meta?)`
Отладочная информация (⚫ серый).

```javascript
logger.debug('Состояние сохранено', { 
  tasks: 50,
  time: Date.now() 
});
```

---

## Utils

Вспомогательные функции.

### `generateRequestsWithOperators(queries)`

Генерирует задачи с операторами для каждого запроса.

**Параметры**:
- `queries: string[]` - массив запросов

**Возвращает**: `Task[]`

```javascript
const queries = ['купить айфон', 'samsung телефон'];
const tasks = generateRequestsWithOperators(queries);
// [
//   { type: 'original', query: 'купить айфон' },
//   { type: 'withQuotes', query: '"купить айфон"' },
//   { type: 'withExclamation', query: '"!купить !айфон"' },
//   ...
// ]
```

### `getRandomDelay(min, max)`

Возвращает случайную задержку.

```javascript
const delay = getRandomDelay(1000, 3000); // 1000-3000ms
```

### `delay(ms)`

Promise задержка.

```javascript
await delay(2000); // Ждём 2 секунды
```

### `retryWithBackoff(fn, context?)`

Повторяет функцию с экспоненциальной задержкой.

```javascript
const result = await retryWithBackoff(
  async () => await fetchData(),
  { operation: 'fetch' }
);
```

### `normalizeQueryKey(query)`

Нормализует ключ запроса (удаляет операторы).

```javascript
normalizeQueryKey('"купить !айфон"'); // 'купить айфон'
```

### `hasAllMetrics(result)`

Проверяет наличие всех трёх метрик.

```javascript
const result = { original: '100', withQuotes: '50', withExclamation: '25' };
hasAllMetrics(result); // true
```

### `formatProgress(current, total)`

Форматирует прогресс-бар.

```javascript
formatProgress(50, 100); 
// '[███████████████░░░░░░░░░░░░░░░] 50/100 (50.0%)'
```

---

## StateManager

Класс управления состоянием парсера.

### Конструктор

```javascript
const stateManager = new StateManager(stateFilePath?);
```

### Свойства

#### `state`
Текущее состояние:

```javascript
{
  processedTasks: string[],    // ID обработанных задач
  results: { [key: string]: Result },
  currentIndex: number,
  startedAt: string,
  lastSavedAt: string | null,
  isPaused: boolean
}
```

### Методы

#### `loadState()`
Загружает состояние из файла.

#### `saveState()`
Сохраняет состояние в файл.

#### `addProcessedTask(taskId)`
Добавляет задачу в список обработанных.

```javascript
stateManager.addProcessedTask('купить айфон_original');
```

#### `isTaskProcessed(taskId)`
Проверяет, была ли обработана задача.

```javascript
if (stateManager.isTaskProcessed(taskId)) {
  console.log('Уже обработано');
}
```

#### `updateResult(key, field, value)`
Обновляет результат.

```javascript
stateManager.updateResult('купить айфон', 'original', '15234');
```

#### `getResult(key)`
Получает результат.

```javascript
const result = stateManager.getResult('купить айфон');
// { original: '15234', withQuotes: '8456', withExclamation: '4123' }
```

#### `setPaused(isPaused)`
Устанавливает статус паузы.

#### `isPaused()`
Проверяет статус паузы.

#### `clear()`
Очищает состояние.

#### `getStats()`
Возвращает статистику.

```javascript
const stats = stateManager.getStats();
// {
//   processedTasks: 150,
//   currentIndex: 150,
//   resultsCount: 50,
//   startedAt: '2024-12-12T10:00:00.000Z',
//   lastSavedAt: '2024-12-12T10:30:00.000Z'
// }
```

---

## AuthManager

Класс управления авторизацией.

### Конструктор

```javascript
const authManager = new AuthManager(page);
```

### Методы

#### `async loadCookies()`
Загружает куки из файла.

**Возвращает**: `Promise<boolean>`

```javascript
const loaded = await authManager.loadCookies();
```

#### `async saveCookies()`
Сохраняет куки в файл.

**Возвращает**: `Promise<boolean>`

#### `async login()`
Выполняет авторизацию на Яндексе.

**Возвращает**: `Promise<boolean>`

```javascript
await authManager.login();
```

#### `async isAuthenticated()`
Проверяет статус авторизации.

**Возвращает**: `Promise<boolean>`

```javascript
const authenticated = await authManager.isAuthenticated();
```

#### `async ensureAuthenticated()`
Обеспечивает авторизацию (авторизуется если нужно).

**Возвращает**: `Promise<boolean>`

```javascript
await authManager.ensureAuthenticated();
```

---

## WordstatParser

Основной класс парсера.

### Конструктор

```javascript
const parser = new WordstatParser();
```

### Методы

#### `async initialize()`
Инициализирует парсер (браузер, CSV, панель управления).

```javascript
await parser.initialize();
```

#### `loadTasks()`
Загружает задачи из `requests.txt`.

```javascript
parser.loadTasks();
console.log(parser.tasks.length); // Количество задач
```

#### `async parseQuery(task)`
Парсит один запрос.

```javascript
const task = { type: 'original', query: 'купить айфон' };
await parser.parseQuery(task);
```

#### `async parse()`
Основной цикл парсинга всех задач.

```javascript
await parser.parse();
```

#### `pause()`
Приостанавливает парсинг.

```javascript
parser.pause();
```

#### `resume()`
Возобновляет парсинг.

```javascript
parser.resume();
```

#### `getStatus()`
Возвращает текущий статус.

**Возвращает**: `string`

```javascript
const status = parser.getStatus();
// 'Running | Processed: 150'
```

#### `async run()`
Полный цикл: инициализация → авторизация → парсинг.

**Возвращает**: `Promise<boolean>`

```javascript
try {
  await parser.run();
  console.log('Успех!');
} catch (error) {
  console.error('Ошибка:', error);
}
```

#### `async close()`
Закрывает браузер.

```javascript
await parser.close();
```

---

## Типы данных

### Task
```typescript
interface Task {
  type: 'original' | 'withQuotes' | 'withExclamation';
  query: string;
}
```

### Result
```typescript
interface Result {
  original: string;
  withQuotes: string;
  withExclamation: string;
}
```

### State
```typescript
interface State {
  processedTasks: string[];
  results: { [key: string]: Result };
  currentIndex: number;
  startedAt: string;
  lastSavedAt: string | null;
  isPaused: boolean;
}
```

---

## Примеры использования

### Базовый запуск

```javascript
import { WordstatParser } from './WordstatParser.js';

const parser = new WordstatParser();
await parser.run();
await parser.close();
```

### С обработкой ошибок

```javascript
const parser = new WordstatParser();

try {
  await parser.initialize();
  await parser.authManager.ensureAuthenticated();
  parser.loadTasks();
  await parser.parse();
} catch (error) {
  console.error('Ошибка:', error);
  parser.stateManager.saveState();
} finally {
  await parser.close();
}
```

### Программная пауза

```javascript
const parser = new WordstatParser();
await parser.initialize();

// Пауза через 10 секунд
setTimeout(() => {
  parser.pause();
  console.log('Парсинг приостановлен');
}, 10000);

await parser.run();
```

### Работа с состоянием

```javascript
const stateManager = new StateManager();

// Проверка состояния
if (stateManager.state.currentIndex > 0) {
  console.log('Продолжаем с индекса:', stateManager.state.currentIndex);
}

// Статистика
const stats = stateManager.getStats();
console.log('Обработано задач:', stats.processedTasks);

// Очистка
stateManager.clear();
```

---

## События браузера

Парсер экспонирует функции в window для управления из браузера:

```javascript
// В консоли браузера
window.pauseParser();   // Пауза
window.resumeParser();  // Возобновление
window.getParserStatus(); // Статус
```
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

const USERNAME = os.userInfo().username;
const BASE_PATH = path.join('C:/Users', USERNAME, 'Desktop/Puppeteer/Parser_request');

export const CONFIG = {
  // Учетные данные из переменных окружения
  auth: {
    login: process.env.YANDEX_LOGIN,
    password: process.env.YANDEX_PASSWORD,
    authUrl: 'https://passport.yandex.ru/auth',
    targetUrl: 'https://wordstat.yandex.ru/'
  },

  // Пути к файлам
  paths: {
    base: BASE_PATH,
    cookies: path.join(BASE_PATH, 'cookiesWordstat.json'),
    requests: path.join(BASE_PATH, 'requests.txt'),
    outputDir: path.join(BASE_PATH, 'Results'),
    outputFile: path.join(BASE_PATH, 'Results', 'WordStat.csv'),
    stateFile: path.join(BASE_PATH, 'Results', 'parser_state.json'),
    logFile: path.join(BASE_PATH, 'Results', 'parser.log')
  },

  // Селекторы
  selectors: {
    input: '.textinput__control',
    result: '.wordstat__content-preview-text_last',
    loginInput: 'input[name="login"]',
    passwordInput: 'input[name="password"]',
    signInButton: '#passp\\:sign-in'
  },

  // Настройки браузера
  browser: {
    viewport: { width: 1035, height: 520 },
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  },

  // Таймауты и задержки
  timing: {
    navigationTimeout: 60000,
    selectorTimeout: 10000,
    minDelay: 500,
    maxDelay: 1000,
    afterSearchMin: 1000,
    afterSearchMax: 3000,
    typingDelay: 100
  },

  // Retry настройки
  retry: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    factor: 2
  },

  // Batch обработка
  batch: {
    size: 10,
    saveInterval: 5
  }
};

// Валидация конфигурации
export function validateConfig() {
  const errors = [];

  if (!CONFIG.auth.login) {
    errors.push('YANDEX_LOGIN не установлен в .env файле');
  }
  if (!CONFIG.auth.password) {
    errors.push('YANDEX_PASSWORD не установлен в .env файле');
  }

  if (errors.length > 0) {
    throw new Error(`Ошибки конфигурации:\n${errors.join('\n')}`);
  }
}
import fs from 'fs';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { retryWithBackoff } from './utils.js';

/**
 * Класс для управления авторизацией
 */
export class AuthManager {
  constructor(page) {
    this.page = page;
    this.cookiesPath = CONFIG.paths.cookies;
  }

  /**
   * Загрузка куков
   */
  async loadCookies() {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(this.cookiesPath, 'utf-8'));
        await this.page.setCookie(...cookies);
        logger.info('Куки загружены');
        return true;
      }
      logger.warn('Файл с куками не найден');
      return false;
    } catch (error) {
      logger.error('Ошибка загрузки куков', { error: error.message });
      return false;
    }
  }

  /**
   * Сохранение куков
   */
  async saveCookies() {
    try {
      const cookies = await this.page.cookies();
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
      logger.info('Куки сохранены');
      return true;
    } catch (error) {
      logger.error('Ошибка сохранения куков', { error: error.message });
      return false;
    }
  }

  /**
   * Авторизация на Яндексе
   */
  async login() {
    return retryWithBackoff(async () => {
      logger.info('Начинаем авторизацию...');
      
      await this.page.goto(CONFIG.auth.authUrl, { 
        waitUntil: 'networkidle2',
        timeout: CONFIG.timing.navigationTimeout
      });

      // Ввод логина
      await this.page.waitForSelector(CONFIG.selectors.loginInput, { 
        timeout: CONFIG.timing.selectorTimeout 
      });
      await this.page.type(
        CONFIG.selectors.loginInput, 
        CONFIG.auth.login, 
        { delay: CONFIG.timing.typingDelay }
      );
      await this.page.click(CONFIG.selectors.signInButton);

      // Ввод пароля
      await this.page.waitForSelector(CONFIG.selectors.passwordInput, { 
        timeout: CONFIG.timing.selectorTimeout 
      });
      await this.page.type(
        CONFIG.selectors.passwordInput, 
        CONFIG.auth.password, 
        { delay: CONFIG.timing.typingDelay }
      );
      await this.page.click(CONFIG.selectors.signInButton);

      // Ожидание завершения авторизации
      await this.page.waitForNavigation({ 
        waitUntil: 'networkidle2',
        timeout: CONFIG.timing.navigationTimeout
      });

      // Сохранение куков
      await this.saveCookies();
      logger.success('Авторизация успешна');
      
      return true;
    }, { operation: 'login' });
  }

  /**
   * Проверка авторизации
   */
  async isAuthenticated() {
    try {
      await this.page.goto(CONFIG.auth.targetUrl, { 
        waitUntil: 'networkidle2',
        timeout: CONFIG.timing.navigationTimeout
      });

      // Проверяем наличие поля ввода (признак успешной авторизации)
      const hasInput = (await this.page.$(CONFIG.selectors.input)) !== null;
      
      if (hasInput) {
        logger.info('Авторизация подтверждена');
        return true;
      }
      
      logger.warn('Требуется авторизация');
      return false;
    } catch (error) {
      logger.error('Ошибка проверки авторизации', { error: error.message });
      return false;
    }
  }

  /**
   * Обеспечение авторизации
   */
  async ensureAuthenticated() {
    // Пробуем загрузить куки
    await this.loadCookies();
    
    // Проверяем авторизацию
    const authenticated = await this.isAuthenticated();
    
    if (!authenticated) {
      logger.warn('Требуется повторная авторизация');
      await this.login();
      
      // Переходим на целевую страницу
      await this.page.goto(CONFIG.auth.targetUrl, { 
        waitUntil: 'networkidle2',
        timeout: CONFIG.timing.navigationTimeout
      });
    }
    
    return true;
  }
}
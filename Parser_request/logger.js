import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';

class Logger {
  constructor(logFilePath) {
    this.logFilePath = logFilePath;
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    const dir = path.dirname(this.logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}\n`;
  }

  write(level, message, meta = {}) {
    const formattedMessage = this.formatMessage(level, message, meta);
    
    // Вывод в консоль с цветами
    const colors = {
      INFO: '\x1b[36m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      SUCCESS: '\x1b[32m',
      DEBUG: '\x1b[90m'
    };
    const reset = '\x1b[0m';
    console.log(`${colors[level] || ''}${formattedMessage.trim()}${reset}`);

    // Запись в файл
    fs.appendFileSync(this.logFilePath, formattedMessage);
  }

  info(message, meta) {
    this.write('INFO', message, meta);
  }

  warn(message, meta) {
    this.write('WARN', message, meta);
  }

  error(message, meta) {
    this.write('ERROR', message, meta);
  }

  success(message, meta) {
    this.write('SUCCESS', message, meta);
  }

  debug(message, meta) {
    this.write('DEBUG', message, meta);
  }
}

export const logger = new Logger(CONFIG.paths.logFile);
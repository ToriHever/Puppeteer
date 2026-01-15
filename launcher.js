#!/usr/bin/env node

import { spawn } from 'child_process';
import readline from 'readline';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Конфигурация парсеров
const PARSERS = {
  'wordstat': {
    name: 'Wordstat Parser (Yandex Wordstat)',
    description: 'Парсинг частоты запросов из Яндекс.Вордстат',
    path: './Parser_request/index.js',
    icon: '📊',
    color: 'cyan'
  },
  'multi-yandex': {
    name: 'Multi Search - Yandex',
    description: 'Парсинг результатов поиска Яндекс',
    path: './multi_search_parser/index.js',
    icon: '🔍',
    color: 'yellow',
    args: ['--engine', 'yandex']
  },
  'multi-google': {
    name: 'Multi Search - Google',
    description: 'Парсинг результатов поиска Google',
    path: './multi_search_parser/index.js',
    icon: '🔎',
    color: 'blue',
    args: ['--engine', 'google']
  },
  'multi-both-seq': {
    name: 'Multi Search - Both (Sequential)',
    description: 'Парсинг Yandex и Google последовательно',
    path: './multi_search_parser/index.js',
    icon: '🔄',
    color: 'magenta',
    args: ['--engine', 'both-seq']
  },
  'multi-both-par': {
    name: 'Multi Search - Both (Parallel)',
    description: 'Парсинг Yandex и Google параллельно',
    path: './multi_search_parser/index.js',
    icon: '⚡',
    color: 'green',
    args: ['--engine', 'both-par']
  }
};

class ParserLauncher {
  constructor() {
    this.selectedParser = null;
    this.rl = null;
  }

  // Очистка экрана
  clearScreen() {
    console.clear();
  }

  // Отрисовка заголовка
  drawHeader() {
    const title = '🚀 PARSER LAUNCHER';
    const subtitle = 'Unified Interface for All Parsers';
    const width = 60;
    
    console.log(chalk.bold.cyan('═'.repeat(width)));
    console.log(chalk.bold.cyan('║') + ' '.repeat(width - 2) + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + chalk.bold.white(title.padStart((width + title.length) / 2).padEnd(width - 2)) + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + chalk.gray(subtitle.padStart((width + subtitle.length) / 2).padEnd(width - 2)) + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + ' '.repeat(width - 2) + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('═'.repeat(width)));
    console.log();
  }

  // Отрисовка меню
  drawMenu() {
    console.log(chalk.bold.white('📋 Доступные парсеры:\n'));
    
    let index = 1;
    for (const [key, parser] of Object.entries(PARSERS)) {
      const colorFn = chalk[parser.color] || chalk.white;
      console.log(colorFn.bold(`  ${index}. ${parser.icon} ${parser.name}`));
      console.log(chalk.gray(`     ${parser.description}`));
      console.log();
      index++;
    }

    console.log(chalk.red.bold('  0. ❌ Выход\n'));
    console.log(chalk.bold.cyan('─'.repeat(60)));
  }

  // Отрисовка информации о парсере
  drawParserInfo(parserKey) {
    const parser = PARSERS[parserKey];
    const colorFn = chalk[parser.color] || chalk.white;
    
    console.log(colorFn.bold(`\n${parser.icon} ${parser.name}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.white(`Описание: ${parser.description}`));
    console.log(chalk.gray(`Путь: ${parser.path}`));
    
    // Проверка существования файла
    const fullPath = path.join(__dirname, parser.path);
    const exists = fs.existsSync(fullPath);
    
    if (exists) {
      console.log(chalk.green('✓ Парсер найден и готов к запуску'));
    } else {
      console.log(chalk.red('✗ Файл парсера не найден!'));
      console.log(chalk.yellow(`  Ожидаемый путь: ${fullPath}`));
    }
    
    console.log(chalk.gray('─'.repeat(60)));
    
    return exists;
  }

  // Открытие файла с запросами
  async openRequestsFile(parserKey) {
    const requestsFiles = {
      'wordstat': path.join(__dirname, 'Parser_request', 'requests.txt'),
      'multi-yandex': path.join(__dirname, 'multi_search_parser', 'scripts', 'queries.txt'),
      'multi-google': path.join(__dirname, 'multi_search_parser', 'scripts', 'queries.txt'),
      'multi-both-seq': path.join(__dirname, 'multi_search_parser', 'scripts', 'queries.txt'),
      'multi-both-par': path.join(__dirname, 'multi_search_parser', 'scripts', 'queries.txt')
    };

    const filePath = requestsFiles[parserKey];
    
    if (!filePath) {
      return true; // Нет файла для редактирования
    }

    // Проверяем существование файла
    if (!fs.existsSync(filePath)) {
      console.log(chalk.yellow(`\n⚠️  Файл не найден: ${filePath}`));
      console.log(chalk.yellow('Создаю файл...'));
      
      // Создаём директорию если нужно
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Создаём пустой файл с инструкцией
      const instruction = '# Введите запросы для парсинга\n# Каждый запрос с новой строки\n\n';
      fs.writeFileSync(filePath, instruction, 'utf-8');
    }

    console.log(chalk.cyan(`\n📝 Открытие файла с запросами...`));
    console.log(chalk.gray(`   ${filePath}\n`));

    return new Promise((resolve) => {
      let editor;
      
      // Определяем редактор в зависимости от ОС
      if (process.platform === 'win32') {
        editor = spawn('notepad.exe', [filePath], { 
          stdio: 'ignore',
          detached: false 
        });
      } else if (process.platform === 'darwin') {
        editor = spawn('open', ['-t', filePath], { 
          stdio: 'ignore' 
        });
      } else {
        // Linux
        editor = spawn('xdg-open', [filePath], { 
          stdio: 'ignore' 
        });
      }

      editor.on('error', (error) => {
        console.log(chalk.yellow(`⚠️  Не удалось открыть редактор: ${error.message}`));
        console.log(chalk.yellow(`Пожалуйста, отредактируйте файл вручную: ${filePath}`));
        resolve(true);
      });

      editor.on('close', () => {
        console.log(chalk.green('✓ Файл закрыт\n'));
        resolve(true);
      });

      // Для Windows notepad - ждём закрытия
      if (process.platform === 'win32') {
        console.log(chalk.yellow('⏳ Ожидание закрытия редактора...'));
        console.log(chalk.gray('   Закройте Notepad после редактирования\n'));
      } else {
        // Для Mac/Linux - даём время открыться и продолжаем
        setTimeout(() => {
          console.log(chalk.yellow('📌 Редактор открыт. Продолжаем после подтверждения...'));
          resolve(true);
        }, 1000);
      }
    });
  }

  // Запуск парсера
  async runParser(parserKey) {
    const parser = PARSERS[parserKey];
    const colorFn = chalk[parser.color] || chalk.white;
    
    // Открываем файл с запросами перед запуском
    await this.openRequestsFile(parserKey);
    
    console.log(colorFn.bold(`\n🚀 Запуск: ${parser.name}\n`));
    console.log(chalk.gray('═'.repeat(60)));
    console.log(chalk.yellow('💡 Подсказка: Нажмите Ctrl+C для остановки парсера'));
    console.log(chalk.gray('═'.repeat(60)) + '\n');

    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, parser.path);
      const args = parser.args || [];
      
      // Запускаем парсер как дочерний процесс
      const child = spawn('node', [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        stdio: 'inherit',
        shell: true
      });

      // Обработка завершения
      child.on('close', (code) => {
        console.log(chalk.gray('\n═'.repeat(60)));
        if (code === 0) {
          console.log(chalk.green.bold(`✓ Парсер завершён успешно`));
        } else {
          console.log(chalk.red.bold(`✗ Парсер завершён с ошибкой (код: ${code})`));
        }
        console.log(chalk.gray('═'.repeat(60)));
        resolve(code);
      });

      // Обработка ошибок
      child.on('error', (error) => {
        console.error(chalk.red.bold(`\n✗ Ошибка запуска: ${error.message}`));
        resolve(1);
      });
    });
  }

  // Ожидание ввода пользователя
  async prompt(question) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      this.rl.question(chalk.bold.cyan(question), (answer) => {
        this.rl.close();
        resolve(answer.trim());
      });
    });
  }

  // Пауза с сообщением
  async pause(message = '\nНажмите Enter для продолжения...') {
    await this.prompt(message);
  }

  // Главное меню
  async mainMenu() {
    while (true) {
      this.clearScreen();
      this.drawHeader();
      this.drawMenu();

      const choice = await this.prompt('Выберите парсер (0-5): ');
      const choiceNum = parseInt(choice);

      // Выход
      if (choiceNum === 0 || choice.toLowerCase() === 'q') {
        this.clearScreen();
        console.log(chalk.bold.green('\n✓ До свидания!\n'));
        process.exit(0);
      }

      // Проверка валидности выбора
      if (isNaN(choiceNum) || choiceNum < 0 || choiceNum > Object.keys(PARSERS).length) {
        console.log(chalk.red('\n✗ Неверный выбор! Попробуйте снова.'));
        await this.pause();
        continue;
      }

      // Получаем ключ парсера по индексу
      const parserKey = Object.keys(PARSERS)[choiceNum - 1];
      
      // Очищаем экран и показываем информацию о парсере
      this.clearScreen();
      this.drawHeader();
      
      const exists = this.drawParserInfo(parserKey);
      
      if (!exists) {
        console.log(chalk.red('\n✗ Невозможно запустить парсер - файл не найден!'));
        await this.pause();
        continue;
      }

      console.log(chalk.yellow('\n⚠️  Парсер будет запущен. Продолжить?'));
      const confirm = await this.prompt('Введите "yes" для подтверждения: ');

      if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
        console.log(chalk.yellow('\n⊗ Запуск отменён'));
        await this.pause();
        continue;
      }

      // Запускаем парсер
      await this.runParser(parserKey);
      
      // Пауза перед возвратом в меню
      await this.pause();
    }
  }

  // Запуск launcher
  async start() {
    try {
      // Проверяем наличие chalk
      try {
        await import('chalk');
      } catch (e) {
        console.log('\n⚠️  Пакет chalk не установлен. Установить сейчас? (y/n)');
        const answer = await this.prompt('Ответ: ');
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          console.log('\n📦 Установка chalk...');
          await new Promise((resolve) => {
            const install = spawn('npm', ['install', 'chalk'], {
              stdio: 'inherit',
              shell: true
            });
            install.on('close', resolve);
          });
          console.log('\n✓ Установка завершена. Перезапустите launcher.');
          process.exit(0);
        } else {
          console.log('\n✗ Невозможно продолжить без chalk');
          process.exit(1);
        }
      }

      await this.mainMenu();
    } catch (error) {
      console.error(chalk.red(`\n✗ Критическая ошибка: ${error.message}`));
      process.exit(1);
    }
  }
}

// Обработка Ctrl+C
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n⚠️  Получен сигнал прерывания'));
  console.log(chalk.green('✓ До свидания!\n'));
  process.exit(0);
});

// Запуск launcher
const launcher = new ParserLauncher();
launcher.start();
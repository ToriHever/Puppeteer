import { isPaused } from './hotkeys.js';

// Режимы работы
export const MODES = {
  COOKIE: 'cookie',
  INCOGNITO: 'incognito'
};

// Функция задержки
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Функция ожидания с проверкой паузы
export async function sleepWithPauseCheck(ms) {
  const startTime = Date.now();
  const checkInterval = 100;
  
  while (Date.now() - startTime < ms) {
    if (isPaused()) {
      while (isPaused()) {
        await sleep(checkInterval);
      }
    }
    await sleep(Math.min(checkInterval, ms - (Date.now() - startTime)));
  }
}

// Функция движения мыши с проверкой паузы
export async function randomMouseMovement(page, duration = 2000) {
  const viewport = page.viewport();
  const startTime = Date.now();
  
  while (Date.now() - startTime < duration) {
    if (isPaused()) {
      while (isPaused()) {
        await sleep(100);
      }
    }
    
    const x = Math.floor(Math.random() * viewport.width);
    const y = Math.floor(Math.random() * viewport.height);
    
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
    await sleep(50 + Math.random() * 150);
    
    // Иногда делаем небольшие круговые движения
    if (Math.random() > 0.7) {
      const radius = 20 + Math.random() * 30;
      for (let angle = 0; angle < Math.PI * 2; angle += 0.3) {
        if (isPaused()) {
          while (isPaused()) {
            await sleep(100);
          }
        }
        const newX = x + Math.cos(angle) * radius;
        const newY = y + Math.sin(angle) * radius;
        await page.mouse.move(newX, newY, { steps: 2 });
        await sleep(30);
      }
    }
  }
}

// Функция выбора режима работы
export function selectMode() {
  return new Promise((resolve) => {
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║         ВЫБОР РЕЖИМА РАБОТЫ ПАРСЕРА               ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');
    console.log('1. 🍪 Режим с куками (сохранение сессии)');
    console.log('   - Использует сохраненные куки');
    console.log('   - Пересохранет куки после прохождения капчи');
    console.log('   - Рекомендуется для больших объемов');
    console.log('\n2. 🕶️ Режим инкогнито (без куков)');
    console.log('   - Каждый запрос как новый пользователь');
    console.log('   - Не сохраняет куки');
    console.log('   - Полностью анонимный режим\n');
    console.log('Выберите режим (1 или 2): ');

    let resolved = false;
    const onKeypress = (str, key) => {
      if (!resolved && (str === '1' || str === '2')) {
        resolved = true;
        process.stdin.removeListener('keypress', onKeypress);
        const mode = str === '2' ? MODES.INCOGNITO : MODES.COOKIE;
        console.log(`\n✓ Выбран режим: ${mode === MODES.COOKIE ? '🍪 С куками' : '🕶️ Инкогнито'}\n`);
        resolve(mode);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

// Функция ожидания нажатия Enter
export function waitForUserInput(message) {
  return new Promise((resolve) => {
    console.log(`\n${message}`);
    console.log('Нажмите Enter для продолжения...');
    
    let resolved = false;
    const onKeypress = (str, key) => {
      if (!resolved && key.name === 'return') {
        resolved = true;
        process.stdin.removeListener('keypress', onKeypress);
        console.log('✓ Продолжение работы...\n');
        resolve();
      }
    };
    
    process.stdin.on('keypress', onKeypress);
  });
}
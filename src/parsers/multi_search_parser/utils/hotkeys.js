import readline from 'readline';

// Глобальная переменная для управления паузой
let _isPaused = false;
let _pauseMessage = '';

// Экспорт функций для доступа к паузе
export const isPaused = () => _isPaused;
export const pauseMessage = () => _pauseMessage;

// Функция инициализации обработчика горячих клавиш
export function initializeHotkeys() {
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    
    process.stdin.on('keypress', (str, key) => {
      // Обработка Ctrl+C для корректного завершения
      if (key.ctrl && key.name === 'c') {
        return; // Позволяем обработчику SIGINT сработать
      }
      
      // Игнорируем Enter если он не обрабатывается waitForUserInput
      if (key.name === 'return') {
        return; // Enter обрабатывается отдельной логикой
      }
      
      // Горячая клавиша 'p' для паузы/возобновления
      if (key.name === 'p' || key.name === 'з') {
        _isPaused = !_isPaused;
        if (_isPaused) {
          console.log('\n\n⏸️  ╔════════════════════════════════════════════════╗');
          console.log('⏸️  ║         СКРИПТ ПРИОСТАНОВЛЕН                   ║');
          console.log('⏸️  ║  Нажмите "P" для возобновления работы         ║');
          console.log('⏸️  ╚════════════════════════════════════════════════╝\n');
          _pauseMessage = '⏸️  [ПАУЗА] ';
        } else {
          console.log('\n▶️  ╔════════════════════════════════════════════════╗');
          console.log('▶️  ║         СКРИПТ ВОЗОБНОВЛЕН                     ║');
          console.log('▶️  ╚════════════════════════════════════════════════╝\n');
          _pauseMessage = '';
        }
      }
      
      // Горячая клавиша 'h' для справки
      if (key.name === 'h' || key.name === 'р') {
        console.log('\n📋 ╔════════════════════════════════════════════════╗');
        console.log('📋 ║         ГОРЯЧИЕ КЛАВИШИ:                       ║');
        console.log('📋 ╚════════════════════════════════════════════════╝');
        console.log('   P - Пауза/Возобновление работы скрипта');
        console.log('   H - Показать эту справку');
        console.log('   Ctrl+C - Сохранить результаты и выйти');
        console.log('📋 ╚════════════════════════════════════════════════╝\n');
      }
    });
    
    console.log('\n⌨️  Горячие клавиши активированы:');
    console.log('   • P - Пауза/Возобновление');
    console.log('   • H - Справка');
    console.log('   • Ctrl+C - Выход с сохранением\n');
  }
}
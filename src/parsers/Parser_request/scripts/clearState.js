import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';

const USERNAME = os.userInfo().username;
const BASE_PATH = path.join('C:/Users', USERNAME, 'Desktop/Puppeteer/Parser_request');
const STATE_FILE = path.join(BASE_PATH, 'Results', 'parser_state.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, answer => resolve(answer));
  });
}

async function clearState() {
  console.log('🗑️  Очистка состояния парсера\n');
  
  if (!fs.existsSync(STATE_FILE)) {
    console.log('✅ Файл состояния не найден. Нечего удалять.');
    rl.close();
    return;
  }

  console.log(`Файл состояния: ${STATE_FILE}`);
  
  try {
    const content = fs.readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(content);
    
    console.log('\nТекущее состояние:');
    console.log(`  - Обработано задач: ${state.processedTasks?.length || 0}`);
    console.log(`  - Текущий индекс: ${state.currentIndex || 0}`);
    console.log(`  - Результатов: ${Object.keys(state.results || {}).length}`);
    console.log(`  - Начато: ${state.startedAt || 'Неизвестно'}`);
    console.log(`  - Последнее сохранение: ${state.lastSavedAt || 'Неизвестно'}`);
  } catch (error) {
    console.log('\n⚠️  Не удалось прочитать состояние:', error.message);
  }

  const answer = await question('\nВы уверены, что хотите удалить состояние? (yes/no): ');
  
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    try {
      fs.unlinkSync(STATE_FILE);
      console.log('\n✅ Файл состояния успешно удалён!');
      console.log('ℹ️  При следующем запуске парсинг начнётся с начала.');
    } catch (error) {
      console.log('\n❌ Ошибка при удалении файла:', error.message);
    }
  } else {
    console.log('\n❌ Отменено. Файл состояния сохранён.');
  }
  
  rl.close();
}

clearState();
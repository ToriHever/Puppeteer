import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';

const USERNAME = os.userInfo().username;
const BASE_PATH = path.join('C:/Users', USERNAME, 'Desktop/Puppeteer/Parser_request');
const OUTPUT_FILE = path.join(BASE_PATH, 'Results', 'WordStat.csv');
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

async function clearResults() {
  console.log('🗑️  Очистка результатов парсинга\n');
  
  const filesToDelete = [];
  
  if (fs.existsSync(OUTPUT_FILE)) {
    const stats = fs.statSync(OUTPUT_FILE);
    const lines = fs.readFileSync(OUTPUT_FILE, 'utf-8').split('\n').length - 1;
    console.log(`📄 CSV файл: ${OUTPUT_FILE}`);
    console.log(`   Размер: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`   Строк данных: ~${lines}`);
    filesToDelete.push({ path: OUTPUT_FILE, name: 'CSV файл с результатами' });
  }
  
  if (fs.existsSync(STATE_FILE)) {
    console.log(`\n📄 Файл состояния: ${STATE_FILE}`);
    filesToDelete.push({ path: STATE_FILE, name: 'Файл состояния' });
  }

  if (filesToDelete.length === 0) {
    console.log('✅ Файлы результатов не найдены. Нечего удалять.');
    rl.close();
    return;
  }

  console.log('\n⚠️  ВНИМАНИЕ: Будут удалены следующие файлы:');
  filesToDelete.forEach((file, index) => {
    console.log(`   ${index + 1}. ${file.name}`);
  });

  const answer = await question('\nВы уверены, что хотите удалить результаты? (yes/no): ');
  
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    let deleted = 0;
    
    for (const file of filesToDelete) {
      try {
        fs.unlinkSync(file.path);
        console.log(`✅ Удалено: ${file.name}`);
        deleted++;
      } catch (error) {
        console.log(`❌ Ошибка при удалении ${file.name}:`, error.message);
      }
    }
    
    console.log(`\n✅ Успешно удалено файлов: ${deleted}/${filesToDelete.length}`);
    console.log('ℹ️  При следующем запуске результаты будут записываться в новый файл.');
  } else {
    console.log('\n❌ Отменено. Файлы результатов сохранены.');
  }
  
  rl.close();
}

clearResults();
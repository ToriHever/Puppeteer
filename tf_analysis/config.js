import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Путь к бинарнику Yandex Mystem. Бинарник НЕ скачивается автоматически —
// скачайте его вручную с https://yandex.ru/dev/mystem/ и положите в bin/,
// либо задайте переменную окружения MYSTEM_PATH (например, если mystem есть в PATH).
export const MYSTEM_PATH = process.env.MYSTEM_PATH
  || path.join(__dirname, 'bin', process.platform === 'win32' ? 'mystem.exe' : 'mystem');

export const LEMMA_MIN_COVERAGE_RATIO = 0.3; // лемма учитывается, если встречается минимум в 30% страниц конкурентов
export const RESULTS_DIR = path.join(__dirname, 'results');
export const TASKS_FILE = path.join(__dirname, 'scripts', 'tasks.txt');
export const INPUT_DIR = path.join(__dirname, 'input');
export const SAVE_HTML_URLS_FILE = path.join(__dirname, 'scripts', 'save_html_urls.txt');

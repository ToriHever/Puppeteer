import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Путь к бинарнику Yandex Mystem. Бинарник НЕ скачивается автоматически —
// скачайте его вручную с https://yandex.ru/dev/mystem/ и положите в bin/,
// либо задайте переменную окружения MYSTEM_PATH (например, если mystem есть в PATH).
export const MYSTEM_PATH = process.env.MYSTEM_PATH
  || path.join(__dirname, 'bin', process.platform === 'win32' ? 'mystem.exe' : 'mystem');

export const LEMMA_MIN_COVERAGE_RATIO = 0.3; // лемма учитывается, если встречается минимум в 30% страниц конкурентов
// Кластеризация лемм (KMeans) и облако слов
export const CLUSTER_MIN_K = 2;       // k подбирается по максимуму силуэта в диапазоне [MIN_K, MAX_K]
export const CLUSTER_MAX_K = 6;
export const CLUSTER_SEED = 42;       // фиксированный seed — результат воспроизводим
export const LSI_DIMENSIONS = 3;      // число скрытых тем (компонент SVD) для LSI-пространства (всегда < ранга матрицы)
// Автоопределение LSI-слов (близость к запросу в LSI-пространстве)
export const AUTO_LSI_MAX_TERMS = 30;
export const AUTO_LSI_MIN_SIMILARITY = 0.6; // косинусная близость к запросу/главным словам
export const AUTO_LSI_MIN_COVERAGE = 0.5;   // слово должно быть минимум на половине страниц ТОП-10
export const HEADING_WEIGHT = 3;     // вес вхождения в H1–H3 при ранжировании слов для облака/кластеров (обычное вхождение = 1)
export const CLOUD_MAX_WORDS = 120;   // сколько лемм (по убыванию частоты) идёт в кластеризацию и облако
export const RESULTS_DIR = path.join(__dirname, 'results');
export const TASKS_FILE = path.join(__dirname, 'scripts', 'tasks.txt');
export const INPUT_DIR = path.join(__dirname, 'input');
export const SAVE_HTML_URLS_FILE = path.join(__dirname, 'scripts', 'save_html_urls.txt');

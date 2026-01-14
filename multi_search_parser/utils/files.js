import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Функция проверки и создания папки
export async function ensureDirectoryExists(dirPath) {
  try {
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
      console.log(`✓ Создана папка: ${dirPath}`);
    }
  } catch (error) {
    console.error(`Ошибка при создании папки ${dirPath}:`, error.message);
    throw error;
  }
}

// Функция генерации имени файла с датой
function generateFilenameWithDate(baseName, extension) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  
  const nameWithoutExt = baseName.replace(new RegExp(`\\${extension}$`), '');
  return `${nameWithoutExt}_${dateStr}_${timeStr}${extension}`;
}

// Функция получения уникального имени файла
function getUniqueFilename(filename) {
  if (!existsSync(filename)) {
    return filename;
  }
  
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const dir = path.dirname(filename);
  
  return path.join(dir, generateFilenameWithDate(base, ext));
}

// Чтение запросов из файла
export async function readQueries(filename) {
  try {
    const content = await readFile(filename, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  } catch (error) {
    throw new Error(`Не удалось прочитать файл ${filename}: ${error.message}`);
  }
}

// Чтение куки из JSON файла
export async function readCookies(filename) {
  try {
    const content = await readFile(filename, 'utf-8');
    const cookies = JSON.parse(content);

    if (Array.isArray(cookies)) {
      return cookies;
    } else if (typeof cookies === 'object') {
      return cookies.cookies || Object.values(cookies);
    }

    return [];
  } catch (error) {
    console.warn(`⚠️ Предупреждение: не удалось загрузить куки из ${filename}: ${error.message}`);
    return [];
  }
}

// Функция сохранения куки
export async function saveCookies(page, filename) {
  try {
    // Создаем папку если не существует
    const dir = path.dirname(filename);
    await ensureDirectoryExists(dir);
    
    const cookies = await page.cookies();
    await writeFile(filename, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log('✓ Куки успешно сохранены');
    return true;
  } catch (error) {
    console.error('Ошибка при сохранении куки:', error.message);
    return false;
  }
}

// Экранирование значений для CSV
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Сохранение результатов в CSV
export async function saveToCSV(results, filename, engineName = '') {
  try {
    const dir = path.dirname(filename);
    await ensureDirectoryExists(dir);
    
    const uniqueFilename = getUniqueFilename(filename);
    
    // Заголовок CSV
    const header = 'Запрос,Тип запроса,Поисковик,Позиция,Поз.Органика,Тип,Тип страницы,Заголовок,URL\n';

    // Формируем строки CSV
    const rows = results.map(result => {
      return [
        escapeCSV(result.query),
        escapeCSV(result.queryType || 'Неопределенный'),
        escapeCSV(result.searchEngine || engineName),
        result.position,
        result.organicPosition !== null ? result.organicPosition : '-',
        escapeCSV(result.type),
        escapeCSV(result.pageType),
        escapeCSV(result.title),
        escapeCSV(result.url)
      ].join(',');
    }).join('\n');

    // Добавляем BOM для корректного отображения кириллицы в Excel
    const bom = '\uFEFF';
    const csvContent = bom + header + rows;

    await writeFile(uniqueFilename, csvContent, 'utf-8');
    console.log(`✓ Результаты сохранены: ${uniqueFilename}`);
  } catch (error) {
    console.error('Ошибка при сохранении CSV:', error.message);
    throw error;
  }
}

// Сохранение запросов с недостаточными результатами
export async function saveIncompleteQueries(queries, filename) {
  try {
    const dir = path.dirname(filename);
    await ensureDirectoryExists(dir);
    
    const uniqueFilename = getUniqueFilename(filename);
    const content = queries.join('\n');
    await writeFile(uniqueFilename, content, 'utf-8');
    console.log(`\n✓ Запросы с недостаточными результатами сохранены в: ${uniqueFilename}`);
    console.log(`  Всего запросов: ${queries.length}`);
  } catch (error) {
    console.error('Ошибка при сохранении неполных запросов:', error.message);
  }
}
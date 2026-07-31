import fs from 'fs';
import path from 'path';

// Дата без времени в формате ДД ММ ГГГГ
function formatDateDDMMYYYY(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd} ${mm} ${yyyy}`;
}

// Убираем символы, недопустимые в имени файла на Windows
function sanitizeForFilename(text) {
  return text
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Делает полный скриншот текущей страницы выдачи и сохраняет его в
 * отдельную папку скриншотов. Имя файла: "<запрос> <ДД ММ ГГГГ>.png".
 * @param {import('puppeteer').Page} page
 * @param {string} query - запрос, по которому получена текущая выдача
 * @param {string} screenshotsDir - папка для скриншотов
 * @returns {Promise<string>} путь к сохранённому файлу
 */
export async function takeSerpScreenshot(page, query, screenshotsDir) {
  ensureDir(screenshotsDir);

  // Прокручиваем страницу до конца — часть блоков SERP дорисовывается
  // лениво при скролле и не попадёт в скриншот без этого шага
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });

  const label = `${sanitizeForFilename(query)} ${formatDateDDMMYYYY()}`;
  const filePath = path.join(screenshotsDir, `${label}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

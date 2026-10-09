import path from 'path';
import { readFile } from 'fs/promises';
import { pathToFileURL } from 'url';

const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer',
  'aside', 'form', 'iframe', 'svg', 'button',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
];

// source — это либо http(s)-URL, либо путь к локальному сохранённому HTML-файлу
function resolveTarget(source) {
  return /^https?:\/\//i.test(source) ? source : pathToFileURL(path.resolve(source)).href;
}

// Загружает страницу (с сайта или из локального HTML-файла) и извлекает основной текст, кол-во слов и символов
export async function fetchPageText(page, source) {
  if (/\.txt$/i.test(source)) {
    // HTML-код страницы, сохранённый в .txt: Chrome показал бы его как простой текст, поэтому подставляем как HTML
    const html = await readFile(source, 'utf-8');
    // Это уже отрендеренный снимок (page.content()), скрипты повторно не нужны — они могут стереть содержимое
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
  } else {
    const target = resolveTarget(source);
    await page.setJavaScriptEnabled(true);
    const waitUntil = target.startsWith('file:') ? 'load' : 'networkidle2';
    await page.goto(target, { waitUntil, timeout: 30000 });
  }

  const { text, headings } = await page.evaluate((noiseSelectors) => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(noiseSelectors.join(',')).forEach(el => el.remove());
    const headings = [...clone.querySelectorAll('h1, h2, h3')].map(el => el.textContent || '').join('. ');
    return { text: clone.innerText || '', headings };
  }, NOISE_SELECTORS);

  const normalized = text.replace(/\s+/g, ' ').trim();

  // Считаем слова по кириллице/латинице, символы — с пробелами и без
  const words = normalized.match(/[a-zA-Zа-яА-ЯёЁ]+(?:-[a-zA-Zа-яА-ЯёЁ]+)*/g) || [];

  return {
    source,
    text: normalized,
    headings: headings.replace(/\s+/g, ' ').trim(),
    wordCount: words.length,
    charCount: normalized.length,
    charCountNoSpaces: normalized.replace(/\s/g, '').length
  };
}

import path from 'path';
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
  const target = resolveTarget(source);
  const waitUntil = target.startsWith('file:') ? 'load' : 'networkidle2';
  await page.goto(target, { waitUntil, timeout: 30000 });

  const text = await page.evaluate((noiseSelectors) => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(noiseSelectors.join(',')).forEach(el => el.remove());
    return clone.innerText || '';
  }, NOISE_SELECTORS);

  const normalized = text.replace(/\s+/g, ' ').trim();

  // Считаем слова по кириллице/латинице, символы — с пробелами и без
  const words = normalized.match(/[a-zA-Zа-яА-ЯёЁ]+(?:-[a-zA-Zа-яА-ЯёЁ]+)*/g) || [];

  return {
    source,
    text: normalized,
    wordCount: words.length,
    charCount: normalized.length,
    charCountNoSpaces: normalized.replace(/\s/g, '').length
  };
}

// Раскрытие и сохранение ИИ-ответа выдачи: "Обзор от ИИ" (Google) и
// Нейро / YandexGPT (Yandex).
//
// Что делает для текущей страницы выдачи:
// 1. находит блок ИИ-ответа;
// 2. дожидается, пока ответ допишется (стриминг), и жмёт кнопки раскрытия
//    ("Показать полностью", "Показать больше", "Ещё" и т.п.);
// 3. возвращает полный текст и список источников;
// 4. (отдельной функцией) делает полный скриншот страницы с раскрытым ответом.
//
// Разметка обоих движков меняется, поэтому поиск блока — эвристический:
// - Yandex: контейнер [data-fast-name="neuro_answer"] (как и в serpFeatures.js);
// - Google: ярлык "Обзор от ИИ" / "AI Overview" → поднимаемся вверх по DOM до
//   самого широкого предка, в котором ещё нет органических результатов (h3 в ссылке).
// При сбоях в первую очередь проверяйте EXPAND_LABELS и поиск контейнера.

import fs from 'fs';
import path from 'path';
import { sleep } from './helpers.js';
import { takeSerpScreenshot } from './screenshot.js';

// Подписи кнопок раскрытия (регистр не важен)
const EXPAND_LABELS = [
  'показать полностью',
  'показать больше',
  'показать ещё',
  'показать еще',
  'развернуть',
  'читать далее',
  'читать полностью',
  'ещё',
  'еще',
  'show more',
  'show all',
  'expand',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Один проход: находит блок ИИ-ответа и кликает по кнопкам раскрытия внутри него.
 * Возвращает { found, clicked, text, sources }.
 */
async function inspectAndExpand(page, engine, doClick) {
  return page.evaluate((engine, labels, doClick) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

    function findContainer() {
      if (engine === 'yandex') {
        return document.querySelector('[data-fast-name="neuro_answer"]')
          || document.querySelector('[data-fast-name*="neuro"]');
      }

      // Google: ищем ярлык и поднимаемся до самого широкого "чистого" предка
      let label = null;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t.length < 25 && /^обзор от ии$|^ai overview$/i.test(t)) {
          label = node.parentElement;
          break;
        }
      }
      if (!label) return null;

      let best = label;
      let el = label.parentElement;
      while (el && el !== document.body && el.id !== 'search' && el.id !== 'rso' && el.id !== 'center_col') {
        // органические результаты — ссылка с h3 внутри; значит, вышли за пределы ИИ-блока
        if (el.querySelector('a h3, a [role="heading"]')) break;
        best = el;
        el = el.parentElement;
      }
      return best;
    }

    const container = findContainer();
    if (!container) return { found: false, clicked: 0, text: '', sources: [] };

    let clicked = 0;
    if (doClick) {
      const candidates = container.querySelectorAll('button, [role="button"], a[role="button"], [jsaction], [aria-label], summary, span, div');
      for (const el of candidates) {
        // кнопка может быть без текста (иконка) — тогда подпись в aria-label
        // (у Yandex: span.FactFold-Button[aria-label="Показать полностью"])
        if (el.getAttribute('aria-expanded') === 'true') continue;
        const txt = norm(el.innerText || el.textContent || el.getAttribute('aria-label')).toLowerCase();
        if (!txt || txt.length > 30) continue;
        if (!labels.includes(txt)) continue;
        // не кликаем по ссылкам, уводящим со страницы
        const link = el.closest('a[href]');
        if (link && !link.getAttribute('href').startsWith('#') && link.getAttribute('role') !== 'button') continue;
        // пропускаем невидимые
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        el.scrollIntoView({ block: 'center' });
        el.click();
        clicked++;
      }
    }

    // Текст: без служебных кнопок
    const text = (container.innerText || container.textContent || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !labels.includes(l.toLowerCase()))
      .join('\n');

    const seen = new Set();
    const sources = [];
    container.querySelectorAll('a[href^="http"]').forEach((a) => {
      let href = a.href;
      try {
        const u = new URL(href);
        if (/(^|\.)(google|yandex)\.[a-z]+$/i.test(u.hostname) && !u.searchParams.get('url')) return;
        if (u.pathname === '/goto' && u.searchParams.get('url')) href = u.searchParams.get('url');
      } catch { return; }
      if (seen.has(href)) return;
      seen.add(href);
      sources.push(href);
    });

    return { found: true, clicked, text, sources };
  }, engine, EXPAND_LABELS, doClick);
}

/**
 * Раскрывает ИИ-ответ на странице выдачи и возвращает его текст.
 * @param {import('puppeteer').Page} page
 * @param {'google'|'yandex'} engine
 * @returns {Promise<{found: boolean, text: string, sources: string[]}>}
 */
export async function expandAiAnswer(page, engine) {
  let state = await inspectAndExpand(page, engine, false);

  // ИИ-блок может дорисоваться с задержкой — ждём до ~6 сек
  for (let i = 0; i < 6 && !state.found; i++) {
    await sleep(1000);
    state = await inspectAndExpand(page, engine, false);
  }
  if (!state.found) return { found: false, text: '', sources: [] };

  // Несколько раундов: ждём, пока текст перестанет расти, и жмём "показать полностью"
  let lastLen = -1;
  let stable = 0;
  for (let round = 0; round < 10 && stable < 2; round++) {
    state = await inspectAndExpand(page, engine, true);
    await sleep(state.clicked > 0 ? 1200 : 800);
    const len = state.text.length;
    stable = (len === lastLen && state.clicked === 0) ? stable + 1 : 0;
    lastLen = len;
  }

  // Финальное чтение уже без кликов
  state = await inspectAndExpand(page, engine, false);
  return { found: true, text: state.text, sources: state.sources };
}

/**
 * Скриншот страницы с раскрытым ИИ-ответом (отдельная папка).
 * Имя файла: "<запрос> <ДД ММ ГГГГ> ИИ.png".
 */
export async function takeAiScreenshot(page, query, dir) {
  return takeSerpScreenshot(page, query, dir, ' ИИ');
}

function escapeCSV(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Сохраняет ИИ-ответы в CSV.
 * @param {Array<{query: string, found: boolean, text: string, sources: string[], screenshot: string, checkedAt: string}>} rows
 * @param {string} filePath
 */
export function saveAiAnswersToCSV(rows, filePath) {
  ensureDir(path.dirname(filePath));

  const header = 'Запрос,ИИ-ответ найден,Текст ИИ-ответа,Источники,Скриншот,checked_at\n';
  const body = rows
    .map((r) => [
      escapeCSV(r.query),
      r.found ? 'Да' : 'Нет',
      escapeCSV(r.text),
      escapeCSV((r.sources || []).join('\n')),
      escapeCSV(r.screenshot),
      escapeCSV(r.checkedAt),
    ].join(','))
    .join('\n');

  const bom = '﻿';
  fs.writeFileSync(filePath, bom + header + body + '\n', 'utf-8');
}

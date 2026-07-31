// Определение расширенных элементов выдачи (SERP features): ИИ-обзор,
// картинки, видео, боковая панель (Knowledge Panel), похожие вопросы.
//
// Проверено вживую (июль 2026):
// - Yandex размечает виджеты атрибутом data-fast-name — надёжный сигнал:
//   'images', 'video-unisearch' → видео, 'neuro_answer' → ИИ-ответ,
//   'entity_search' → карточка объекта (боковая панель), 'related' → похожее.
// - Google такой разметки не даёт, поэтому используется комбинация из
//   заголовков блоков (#search [role="heading"]/h2/h3, тексты на русском
//   локале — "Видео", "Вопросы по теме") и известных контейнеров
//   (g-scrolling-carousel для картинок, #rhs/.kp-wholepage для панели).
//   ИИ-обзор у Google определить сложнее всего: сам ярлык "Обзор от ИИ"
//   показывается даже когда обзора нет ("...недоступен для этого запроса"),
//   поэтому дополнительно проверяется отсутствие текста о недоступности.
//   Это best-effort эвристика — Google часто меняет разметку, при сбоях
//   в первую очередь проверяйте её.

import fs from 'fs';
import path from 'path';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Определяет расширенные элементы выдачи Google на текущей странице.
 * @param {import('puppeteer').Page} page
 */
export async function detectGoogleSerpFeatures(page) {
  return page.evaluate(() => {
    const headings = [...document.querySelectorAll('#search [role="heading"], #search h2, #search h3')]
      .map((h) => h.textContent.trim())
      .filter(Boolean);
    const headingsJoined = headings.join(' | ').toLowerCase();

    const images = !!document.querySelector('g-scrolling-carousel, g-img, #tvcap')
      || /картинки|images/i.test(headingsJoined);

    const video = /(^|\|)\s*видео\s*(\||$)/i.test(headingsJoined)
      || /\bvideos?\b/i.test(headingsJoined)
      || document.querySelectorAll('a[href*="youtube.com/watch"]').length > 0;

    const peopleAlsoAsk = /вопросы по теме|похожие вопросы|люди также спрашивают|people also ask/i.test(headingsJoined)
      || !!document.querySelector('[jsname="Cpkphb"], .related-question-pair');

    const rhs = document.querySelector('#rhs');
    const knowledgePanel = (!!rhs && rhs.children.length > 0)
      || !!document.querySelector('.kp-wholepage, [data-attrid*="kc:"]');

    // ИИ-обзор: короткий ярлык "Обзор от ИИ" есть, но НЕТ фразы о недоступности
    // (Google показывает сам ярлык-вкладку даже когда обзор не сгенерирован)
    let aiLabelFound = false;
    let aiUnavailable = false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (!t) continue;
      if (t.length < 20 && /^обзор от ии$|^ai overview$/i.test(t)) aiLabelFound = true;
      if (/недоступен для этого запроса|overview is not available/i.test(t)) aiUnavailable = true;
    }
    const aiOverview = aiLabelFound && !aiUnavailable;

    return { aiOverview, images, video, knowledgePanel, peopleAlsoAsk };
  });
}

/**
 * Определяет расширенные элементы выдачи Yandex на текущей странице.
 * @param {import('puppeteer').Page} page
 */
export async function detectYandexSerpFeatures(page) {
  return page.evaluate(() => {
    const fastNames = new Set(
      [...document.querySelectorAll('[data-fast-name]')].map((el) => el.getAttribute('data-fast-name'))
    );
    const has = (name) => fastNames.has(name);
    const hasSubstr = (substr) => [...fastNames].some((n) => n && n.includes(substr));

    return {
      aiOverview: has('neuro_answer') || hasSubstr('neuro'),
      images: has('images') || hasSubstr('image'),
      video: has('video') || has('video-unisearch') || hasSubstr('video'),
      knowledgePanel: has('entity_search') || hasSubstr('entity'),
      peopleAlsoAsk: has('related'),
    };
  });
}

const YES_NO = (v) => (v ? 'Да' : 'Нет');

function escapeCSV(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Сохраняет собранные данные о расширенных элементах выдачи в CSV.
 * @param {Array<{query: string, aiOverview: boolean, images: boolean, video: boolean, knowledgePanel: boolean, peopleAlsoAsk: boolean, checkedAt: string}>} rows
 * @param {string} filePath
 */
export function saveSerpFeaturesToCSV(rows, filePath) {
  ensureDir(path.dirname(filePath));

  const header = 'Запрос,ИИ-обзор,Картинки,Видео,Боковая панель,Похожие вопросы,checked_at\n';
  const body = rows
    .map((r) => [
      escapeCSV(r.query),
      YES_NO(r.aiOverview),
      YES_NO(r.images),
      YES_NO(r.video),
      YES_NO(r.knowledgePanel),
      YES_NO(r.peopleAlsoAsk),
      escapeCSV(r.checkedAt),
    ].join(','))
    .join('\n');

  const bom = '﻿';
  fs.writeFileSync(filePath, bom + header + body + '\n', 'utf-8');
}

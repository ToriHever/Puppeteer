// Тиндер для доноров: открывает сайты из sites.txt, кнопки ДА/НЕТ (или клавиши → / ←).
// Результат — tinder_result.csv (domain;relevant). Уже оценённые домены пропускаются.
// Расширения: распакованные папки положите в donor_check/extensions/<имя>/ (с manifest.json).
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SITES = path.join(__dirname, 'sites.txt');
const RESULT = path.join(__dirname, 'tinder_result.csv');
const EXT_DIR = path.join(__dirname, 'extensions');

const readLines = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  : [];

const overlay = (label) => {
  const mount = () => {
    if (document.getElementById('__tinder')) return;
    const host = document.createElement('div');
    host.id = '__tinder';
    host.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      div{display:flex;gap:12px;align-items:center;background:#111c;padding:10px 14px;border-radius:14px;font:14px sans-serif;color:#fff}
      button{border:0;border-radius:10px;padding:12px 28px;font:700 16px sans-serif;cursor:pointer;color:#fff}
      .n{background:#d33}.y{background:#2a2}</style>
      <div><button class="n">✕ НЕТ (←)</button><span>${label}</span><button class="y">ДА ✓ (→)</button></div>`;
    root.querySelector('.y').onclick = () => window.__vote(true);
    root.querySelector('.n').onclick = () => window.__vote(false);
    (document.documentElement || document).appendChild(host);
  };
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') window.__vote(true);
    if (e.key === 'ArrowLeft') window.__vote(false);
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  setInterval(mount, 1000);
};

(async () => {
  const done = new Set(readLines(RESULT).map(l => l.split(';')[0]));
  const todo = readLines(SITES).filter(d => !done.has(d));
  if (!fs.existsSync(RESULT)) fs.writeFileSync(RESULT, 'domain;relevant\n');

  const exts = fs.existsSync(EXT_DIR)
    ? fs.readdirSync(EXT_DIR).map(n => path.join(EXT_DIR, n)).filter(p => fs.existsSync(path.join(p, 'manifest.json')))
    : [];
  const args = ['--start-maximized'];
  if (exts.length) args.push(`--disable-extensions-except=${exts.join(',')}`, `--load-extension=${exts.join(',')}`);

  const browser = await puppeteer.launch({
    headless: false, defaultViewport: null, args,
    userDataDir: path.join(__dirname, '.profile'), // профиль сохраняется (настройки расширений, логины)
    ignoreDefaultArgs: exts.length ? ['--disable-extensions'] : [],
  });
  const [page] = await browser.pages();

  let resolveVote;
  await page.exposeFunction('__vote', v => resolveVote && resolveVote(v));

  for (let i = 0; i < todo.length; i++) {
    const d = todo[i];
    const label = `${d} · ${i + 1}/${todo.length}`;
    const script = await page.evaluateOnNewDocument(overlay, label);
    let ok = true;
    try {
      await page.goto('http://' + d, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      ok = false;
    }
    if (!ok) { await page.removeScriptToEvaluateOnNewDocument(script.identifier); fs.appendFileSync(RESULT, `${d};ошибка\n`); console.log(d, 'ошибка загрузки'); continue; }
    await page.evaluate(overlay, label).catch(() => {});
    const vote = await new Promise(r => { resolveVote = r; });
    await page.removeScriptToEvaluateOnNewDocument(script.identifier);
    fs.appendFileSync(RESULT, `${d};${vote ? 'да' : 'нет'}\n`);
    console.log(d, vote ? 'ДА' : 'нет');
  }
  console.log('Готово ->', RESULT);
  await browser.close();
})();

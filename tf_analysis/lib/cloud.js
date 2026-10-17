import { mkdir } from 'fs/promises';
import path from 'path';

const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2'];
const WIDTH = 1600;
const HEIGHT = 1000;

// Рисует облако слов в PNG, раскрашивая леммы по кластерам. Рендер идёт в уже открытой
// странице Puppeteer (canvas + спиральная раскладка без пересечений), поэтому дополнительные
// зависимости не нужны. Главные слова — жирные с подчёркиванием, LSI — курсивом.
export async function saveWordCloud(browser, filePath, clusters, title) {
  await mkdir(path.dirname(filePath), { recursive: true });
  // Отдельная чистая вкладка: переиспользуемая страница может быть занята скриптами/редиректами сайта
  const page = await browser.newPage();
  try {
  await page.setViewport({ width: WIDTH, height: HEIGHT });
  await page.setContent('<html><body style="margin:0"><canvas id="c"></canvas></body></html>');

  const data = clusters.map((cluster, i) => ({
    name: `${cluster.id}. ${cluster.name}`,
    color: PALETTE[i % PALETTE.length],
    items: cluster.items.map(x => ({ lemma: x.lemma, weight: x.weight, importance: x.importance }))
  }));

  await page.evaluate(({ data, title, W, H }) => {
    const canvas = document.getElementById('c');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    const FONT = 'Arial, "Segoe UI", sans-serif';
    const legendH = 40 + Math.ceil(data.length / 2) * 30;
    const area = { x: 20, y: 60, w: W - 40, h: H - 60 - legendH };

    ctx.fillStyle = '#222';
    ctx.font = `bold 28px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, 20, 40);

    const words = [];
    data.forEach(cluster => cluster.items.forEach(item => words.push({ ...item, color: cluster.color })));
    const maxW = Math.max(...words.map(w => w.weight));
    const minW = Math.min(...words.map(w => w.weight));
    const MIN_SIZE = 14, MAX_SIZE = 90;
    // Размер ~ sqrt веса: иначе один частотный лидер «съедает» всё облако
    const sizeOf = w => MIN_SIZE + (MAX_SIZE - MIN_SIZE) * (maxW === minW ? 1 : Math.sqrt((w - minW) / (maxW - minW)));

    const placed = [];
    const collides = r => placed.some(p => !(r.x + r.w < p.x || p.x + p.w < r.x || r.y + r.h < p.y || p.y + p.h < r.y));
    const inside = r => r.x >= area.x && r.y >= area.y && r.x + r.w <= area.x + area.w && r.y + r.h <= area.y + area.h;

    words.sort((a, b) => b.weight - a.weight);
    const cx = area.x + area.w / 2, cy = area.y + area.h / 2;

    for (const word of words) {
      let size = sizeOf(word.weight);
      const style = word.importance.startsWith('Главное') ? 'bold' : word.importance.startsWith('LSI') ? 'italic' : '';
      let done = false;
      while (!done && size >= 9) {
        ctx.font = `${style} ${size}px ${FONT}`.trim();
        const w = ctx.measureText(word.lemma).width + 6;
        const h = size * 1.15;
        for (let t = 0; t < 4000; t += 0.35) {
          const rad = 4 * t;
          const x = cx + rad * 1.6 * Math.cos(t) - w / 2;   // эллиптическая спираль под широкий холст
          const y = cy + rad * Math.sin(t) - h / 2;
          const rect = { x, y, w, h };
          if (!inside(rect)) continue;
          if (collides(rect)) continue;
          placed.push(rect);
          ctx.fillStyle = word.color;
          ctx.textBaseline = 'top';
          ctx.fillText(word.lemma, x + 3, y);
          if (word.importance.startsWith('Главное')) {
            ctx.fillRect(x + 3, y + h - 2, w - 6, 2);
          }
          done = true;
          break;
        }
        if (!done) size *= 0.88; // не влезло — уменьшаем
      }
    }

    // Легенда: кластеры + обозначения
    ctx.textBaseline = 'alphabetic';
    const ly = H - legendH + 25;
    data.forEach((cluster, i) => {
      const x = 20 + (i % 2) * (W / 2);
      const y = ly + Math.floor(i / 2) * 30;
      ctx.fillStyle = cluster.color;
      ctx.fillRect(x, y - 14, 18, 18);
      ctx.fillStyle = '#222';
      ctx.font = `16px ${FONT}`;
      ctx.fillText(cluster.name, x + 28, y);
    });
    ctx.fillStyle = '#666';
    ctx.font = `14px ${FONT}`;
    ctx.fillText('Жирный подчёркнутый — «Главное» (в т.ч. авто), курсив — «LSI» (в т.ч. найденные автоматически), размер — средняя частота у ТОП-10', 20, H - 10);
  }, { data, title, W: WIDTH, H: HEIGHT });

  await page.screenshot({ path: filePath, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  } finally {
    await page.close();
  }
  console.log(`✓ Облако слов сохранено: ${filePath}`);
}

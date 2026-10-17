import { CLUSTER_MIN_K, CLUSTER_MAX_K, LSI_DIMENSIONS, CLUSTER_SEED } from '../config.js';

// Детерминированный генератор (mulberry32) — одни и те же данные дают одни и те же кластеры
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map(x => x / norm);
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sqDist = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);

// Матрица «лемма × страница» с весами TF-IDF.
// pages: [{ lemmaFreq: Map, wordCount }], lemmas: список лемм для кластеризации
export function buildTfidfMatrix(lemmas, pages) {
  const n = pages.length;
  return lemmas.map(lemma => {
    const counts = pages.map(p => p.lemmaFreq.get(lemma) || 0);
    const df = counts.filter(c => c > 0).length;
    const idf = Math.log((1 + n) / (1 + df)) + 1;
    return counts.map((c, i) => (c / (pages[i].wordCount || 1)) * idf);
  });
}

// Собственные значения/векторы симметричной матрицы методом Якоби.
// Матрица Грама «страница × страница» маленькая (≤ ~11×11), поэтому это быстро.
function jacobiEigen(matrix) {
  const n = matrix.length;
  const a = matrix.map(row => [...row]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-20) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  return Array.from({ length: n }, (_, i) => ({
    value: a[i][i],
    vector: v.map(row => row[i])
  })).sort((x, y) => y.value - x.value);
}

// LSI/LSA: усечённое SVD матрицы X (леммы × страницы). Вектор леммы = строка X·V_k
// (координаты в пространстве k скрытых тем). Усечение — суть LSI: оставляем k < rank
// компонент, иначе пространство было бы просто поворотом исходного и ничего не меняло.
export function lsiVectors(matrix, dimensions = LSI_DIMENSIONS, { skipFirst = false } = {}) {
  const pages = matrix[0].length;
  const gram = Array.from({ length: pages }, (_, i) =>
    Array.from({ length: pages }, (_, j) => matrix.reduce((s, row) => s + row[i] * row[j], 0))
  );
  const eigen = jacobiEigen(gram).filter(e => e.value > 1e-12);
  // skipFirst: первая компонента отражает общую «частотность» слова — для поиска смысловой
  // близости её отбрасывают, иначе все частотные слова выглядят похожими друг на друга
  const skip = skipFirst && eigen.length > 2 ? 1 : 0;
  const k = Math.max(1, Math.min(dimensions, eigen.length - 1 - skip));
  const components = eigen.slice(skip, skip + k);
  if (components.length === 0) return matrix.map(normalize);

  return matrix.map(row => normalize(components.map(({ vector }) => dot(row, vector))));
}

function kmeansPlusPlusInit(points, k, rng) {
  const centroids = [points[Math.floor(rng() * points.length)]];
  while (centroids.length < k) {
    const dists = points.map(p => Math.min(...centroids.map(c => sqDist(p, c))));
    const total = dists.reduce((s, d) => s + d, 0);
    if (total === 0) break;
    let r = rng() * total;
    let idx = 0;
    while (idx < dists.length - 1 && r > dists[idx]) { r -= dists[idx]; idx++; }
    centroids.push(points[idx]);
  }
  return centroids;
}

function kmeansOnce(points, k, rng) {
  let centroids = kmeansPlusPlusInit(points, k, rng);
  let labels = new Array(points.length).fill(-1);

  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0, bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = sqDist(points[i], centroids[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }
    if (!changed) break;

    centroids = centroids.map((old, c) => {
      const members = points.filter((_, i) => labels[i] === c);
      if (members.length === 0) return old;
      return old.map((_, d) => members.reduce((s, m) => s + m[d], 0) / members.length);
    });
  }

  const inertia = points.reduce((s, p, i) => s + sqDist(p, centroids[labels[i]]), 0);
  return { labels, inertia };
}

// Лучший из нескольких запусков KMeans (k-means++ инициализация) по inertia
export function kmeans(points, k, { restarts = 8, seed = CLUSTER_SEED } = {}) {
  const rng = makeRng(seed + k);
  let best = null;
  for (let r = 0; r < restarts; r++) {
    const result = kmeansOnce(points, k, rng);
    if (!best || result.inertia < best.inertia) best = result;
  }
  return best.labels;
}

// Средний силуэт: чем ближе к 1, тем чётче разделены кластеры
export function silhouette(points, labels) {
  const k = Math.max(...labels) + 1;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const sums = new Array(k).fill(0);
    const counts = new Array(k).fill(0);
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      sums[labels[j]] += Math.sqrt(sqDist(points[i], points[j]));
      counts[labels[j]]++;
    }
    if (counts[labels[i]] === 0) continue; // кластер из одной точки — силуэт 0
    const a = sums[labels[i]] / counts[labels[i]];
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c !== labels[i] && counts[c] > 0) b = Math.min(b, sums[c] / counts[c]);
    }
    if (b !== Infinity) total += (b - a) / Math.max(a, b);
  }
  return total / points.length;
}

// Кластеризует точки, подбирая k по максимуму силуэта. Возвращает метки 0..k-1.
export function clusterAuto(points) {
  const maxK = Math.min(CLUSTER_MAX_K, Math.floor(points.length / 3));
  if (points.length < 6 || maxK < CLUSTER_MIN_K) return { labels: new Array(points.length).fill(0), k: 1 };

  let best = null;
  for (let k = CLUSTER_MIN_K; k <= maxK; k++) {
    const labels = kmeans(points, k);
    const score = silhouette(points, labels);
    if (!best || score > best.score) best = { labels, k, score };
  }
  return best;
}

// Кластеризует леммы двумя способами:
//  • 'words' — KMeans по TF-IDF-векторам (какие слова встречаются на одних и тех же страницах),
//  • 'lsi'   — KMeans по LSI-векторам (SVD-пространство скрытых тем).
// items: [{ lemma, weight, importance }]. Возвращает [{ id, name, items }] — кластеры по убыванию веса.
export function clusterLemmas(items, pages) {
  const lemmas = items.map(i => i.lemma);
  const matrix = buildTfidfMatrix(lemmas, pages);
  const spaces = {
    words: matrix.map(normalize),
    lsi: lsiVectors(matrix)
  };

  const result = {};
  for (const [mode, points] of Object.entries(spaces)) {
    const { labels, k } = clusterAuto(points);
    const groups = Array.from({ length: k }, () => []);
    items.forEach((item, i) => groups[labels[i]].push(item));

    result[mode] = groups
      .filter(g => g.length > 0)
      .map(g => g.sort((a, b) => b.weight - a.weight))
      .sort((a, b) => b.reduce((s, x) => s + x.weight, 0) - a.reduce((s, x) => s + x.weight, 0))
      .map((groupItems, idx) => ({
        id: idx + 1,
        // Название темы — три самых частотных слова кластера (главные слова в приоритете)
        name: [...groupItems]
          .sort((a, b) => (b.importance === 'Главное') - (a.importance === 'Главное') || b.weight - a.weight)
          .slice(0, 3).map(x => x.lemma).join(' / '),
        items: groupItems
      }));
  }
  return result;
}

// Общие слова без тематики — в LSI-слова попадать не должны
const GENERIC_LEMMAS = new Set([
  'такой', 'другой', 'любой', 'чтобы', 'мочь', 'наш', 'ваш', 'свой', 'это', 'один', 'который', 'каждый',
  'весь', 'самый', 'какой', 'очень', 'можно', 'нужно', 'должен', 'через', 'после', 'более', 'всё', 'они',
  'кто', 'тот', 'ещё', 'или', 'как', 'так', 'при', 'про', 'ваши', 'нам', 'вас', 'нас', 'быть', 'есть',
  'иметь', 'являться', 'получать', 'использовать', 'также', 'число', 'тип', 'вид', 'новый', 'первый'
]);

// Автоматический поиск LSI-слов: леммы, которые в LSI-пространстве лежат ближе всего к
// «якорям» (леммы запроса + главные слова), но сами якорями не являются.
// Идея LSI: слова, которые на страницах ТОП-10 встречаются в тех же контекстах, что и запрос,
// имеют похожие векторы скрытых тем, даже если рядом с ним в тексте не стоят.
// Если слов запроса нет в текстах ТОП-10 (например, разговорная формулировка), центром темы
// становятся самые частотные слова страниц.
// Возвращает { terms: [{ lemma, similarity }] по убыванию близости, anchors, fallback }.
export function findLsiTerms(lemmas, pages, anchorLemmas, { minSimilarity, maxTerms, minCoverage, fallbackAnchors = 3 }) {
  const empty = { terms: [], anchors: [], fallback: false };
  if (lemmas.length < 6) return empty;

  const coverageOf = lemma => pages.filter(p => p.lemmaFreq.has(lemma)).length / pages.length;
  let anchors = new Set(lemmas.filter(l => anchorLemmas.has(l) && coverageOf(l) >= minCoverage));
  let fallback = false;
  if (anchors.size === 0) {
    const total = l => pages.reduce((s, p) => s + (p.lemmaFreq.get(l) || 0), 0);
    anchors = new Set([...lemmas].sort((a, b) => total(b) - total(a)).slice(0, fallbackAnchors));
    fallback = true;
  }
  const anchorIdx = lemmas.map((l, i) => (anchors.has(l) ? i : -1)).filter(i => i >= 0);

  const vectors = lsiVectors(buildTfidfMatrix(lemmas, pages), LSI_DIMENSIONS, { skipFirst: true });
  const dims = vectors[0].length;
  const center = normalize(
    Array.from({ length: dims }, (_, d) => anchorIdx.reduce((s, i) => s + vectors[i][d], 0) / anchorIdx.length)
  );

  const terms = lemmas
    .map((lemma, i) => ({
      lemma,
      similarity: dot(vectors[i], center),
      // близких слов много, но ценнее те, что реально часто используются конкурентами
      avg: pages.reduce((s, p) => s + (p.lemmaFreq.get(lemma) || 0), 0) / pages.length
    }))
    .filter(x => !anchors.has(x.lemma) && !anchorLemmas.has(x.lemma) && !GENERIC_LEMMAS.has(x.lemma) && x.lemma.length > 2 && coverageOf(x.lemma) >= minCoverage && x.similarity >= minSimilarity)
    .sort((a, b) => b.similarity * Math.log(1 + b.avg) - a.similarity * Math.log(1 + a.avg))
    .slice(0, maxTerms)
    .map(({ lemma, similarity }) => ({ lemma, similarity: Number(similarity.toFixed(3)) }));
  return { terms, anchors: [...anchors], fallback };
}

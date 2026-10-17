// Google в какой-то момент стал заворачивать часть органических ссылок в
// https://www.google.com/goto?url=<opaque-токен> вместо прямого href.
// Проверено вживую: это обычный HTTP 302-редирект на реальный адрес —
// поэтому распаковывается простым fetch, без браузера и без изменения
// самого парсинга (селекторы в google.js трогать не пришлось).
//
// Вызывается ПОСЛЕ основного цикла по запросам (когда this.results уже
// собран целиком) — см. base.js. Работает и с обычными ссылками: для них
// isGoogleGotoLink() сразу вернёт false, и элемент пропускается без сети.

const GOTO_WRAPPER_RE = /^https?:\/\/(?:www\.)?google\.[a-z.]+\/goto\?url=/i;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function isGoogleGotoLink(url) {
  return typeof url === 'string' && GOTO_WRAPPER_RE.test(url);
}

async function resolveOne(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    // res.url — итоговый адрес после всех редиректов
    return res.url || url;
  } catch {
    // Не смогли распаковать (таймаут/сеть/блокировка) — лучше оставить
    // исходную обёрнутую ссылку, чем потерять строку результата целиком
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// Простой пул с ограничением параллелизма — без внешних зависимостей
async function mapWithConcurrency(items, limit, worker) {
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

/**
 * Резолвит обёрнутые google.com/goto?url=... ссылки в массиве результатов
 * поиска — мутирует поле url на месте у совпавших элементов (исходное
 * значение сохраняется в originalUrl). Ничего не делает, если обёрнутых
 * ссылок нет — безопасно вызывать после любого движка (Yandex такие
 * ссылки не отдаёт, isGoogleGotoLink просто вернёт false для всех).
 *
 * @param {Array<{url: string}>} results
 * @param {{concurrency?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{resolved: number, failed: number}>}
 */
export async function resolveGoogleGotoLinksInResults(results, { concurrency = 8, timeoutMs = 10000 } = {}) {
  const wrapped = results.filter((r) => isGoogleGotoLink(r.url));
  if (wrapped.length === 0) return { resolved: 0, failed: 0 };

  console.log(`\n🔗 Обнаружено обёрнутых ссылок google.com/goto?url=...: ${wrapped.length} — распаковываю...`);

  const cache = new Map();
  let resolved = 0;
  let failed = 0;

  await mapWithConcurrency(wrapped, concurrency, async (item) => {
    if (!cache.has(item.url)) {
      cache.set(item.url, await resolveOne(item.url, timeoutMs));
    }
    const real = cache.get(item.url);
    if (real !== item.url) {
      item.originalUrl = item.url;
      item.url = real;
      resolved++;
    } else {
      failed++;
    }
  });

  console.log(`   ✓ Распаковано: ${resolved}${failed ? `, не удалось: ${failed}` : ''}\n`);
  return { resolved, failed };
}

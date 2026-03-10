const puppeteer = require('puppeteer');

const URL = 'https://www.forbes.ru/tekhnologii/550251-reaktivnaa-oborona-pocemu-biznes-ekonomit-na-ddos-zasite-v-epohu-usilenia-atak';
const SEARCH = 'ddos-guard';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );

  console.log('Открываю страницу...');
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Все ссылки на странице
  const allLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
  );

  console.log(`\nВсего ссылок на странице: ${allLinks.length}`);

  // Ссылки содержащие искомую строку
  const matched = allLinks.filter(h => h.includes(SEARCH));
  console.log(`\nСсылки с "${SEARCH}":`);
  if (matched.length) {
    matched.forEach(h => console.log(' ', h));
  } else {
    console.log('  — не найдено');
  }

  // Первые 20 ссылок для понимания что вообще есть
  console.log('\nПервые 20 ссылок на странице:');
  allLinks.slice(0, 20).forEach(h => console.log(' ', h));

  // Проверяем есть ли вообще текст ddos-guard в HTML
  const bodyText = await page.evaluate(() => document.body.innerHTML);
  console.log(`\nСлово "${SEARCH}" встречается в HTML: ${bodyText.includes(SEARCH)}`);

  await browser.close();
})();
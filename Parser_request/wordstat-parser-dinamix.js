import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import readline from 'readline';
import delay from 'delay';

puppeteer.use(StealthPlugin());

const cookiesPath = './cookiesWordstat.json';
const inputPath = './input.txt';
const outputPath = './Запросы в динамике.csv';

(async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();

  // Загрузка cookies
  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath));
    await page.setCookie(...cookies);
  }

  await page.goto('https://wordstat.yandex.ru/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.textinput__control', { timeout: 15000 });

  const fileStream = fs.createReadStream(inputPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const output = fs.createWriteStream(outputPath, { flags: 'w', encoding: 'utf-8' });
  output.write(`Период,Запрос,Число запросов\n`);

  let isFirstQuery = true;

  for await (const line of rl) {
    const query = line.trim();
    if (!query) continue;

    try {
      // Очистка поля и ввод запроса
      await page.click('.textinput__control', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('.textinput__control', query, { delay: 1 });
      await page.keyboard.press('Enter');

      await page.waitForSelector('.main', { timeout: 10000 });
      await delay(1000);

      if (isFirstQuery) {
        const clicked = await page.evaluate(() => {
          const root = document.querySelector('.wordstat__view-types');
          if (!root) return false;

          const spans = root.querySelectorAll('span');

          for (const el of spans) {
            const directText = el.textContent?.trim();
            if (directText === 'Динамика') {
              el.click();
              return true;
            }

            const nestedText = Array.from(el.querySelectorAll('*'))
              .map(e => e.textContent?.trim())
              .filter(Boolean)
              .join(' ');

            if (nestedText.includes('Динамика')) {
              el.click();
              return true;
            }
          }
          return false;
        });

        if (clicked) {
          console.log('✅ Клик по "Динамика" выполнен');
          await page.waitForSelector('table.table__wrapper tbody tr', { timeout: 10000 });
          await delay(1000);
        } else {
          console.error('❌ Не удалось найти и нажать "Динамика"');
        }

        isFirstQuery = false;
      } else {
        await page.waitForSelector('table.table__wrapper tbody tr', { timeout: 10000 });
        await delay(1000);
      }

      // Сбор данных из таблицы
      const tableData = await page.$$eval('table.table__wrapper tr', rows =>
        rows.map(row => {
          const cells = Array.from(row.querySelectorAll('td, th'));
          return cells.map(cell => cell.innerText.trim());
        })
      );

      if (tableData.length > 1) {
        const records = tableData.slice(1).map(row => ({
          period: row[0],
          query: query,
          count: row[1]?.replace(/\s/g, '')
        }));

        for (const r of records) {
          output.write(`"${r.period}","${r.query}","${r.count}"\n`);
        }

        console.log(`✅ Записано: ${query}`);
      } else {
        console.log(`⚠️ Нет данных: ${query}`);
      }

      await delay(3000);
    } catch (err) {
      console.error(`Ошибка при обработке запроса "${query}":`, err.message);
    }
  }

  console.log('🟢 Готово. Браузер закрывается.');
  await browser.close();
})();

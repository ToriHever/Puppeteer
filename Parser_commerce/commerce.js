const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

const queries = [
    "защита сервера от ddos",
    "методы защиты от ddos",
    "системы защиты ddos",
    "методы защиты от ddos атак",
    "ddos атака система защиты"
];

const resultsDir = path.join(__dirname, 'Results');
if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir);
}

const csvFilePath = path.join(resultsDir, 'commercial_analysis.csv');
const csvWriter = createObjectCsvWriter({
    path: csvFilePath,
    header: [
        { id: 'query', title: 'Запрос' },
        { id: 'commercialPages', title: 'Кол-во коммерческих страниц' },
        { id: 'commercialRate', title: 'Коммерческость запроса (%)' },
        { id: 'category', title: 'Категория' }
    ]
});

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--incognito']
    });

    const page = await browser.newPage();

    let results = [];

    for (const query of queries) {
        console.log(`🔍 Анализ запроса: ${query}`);
        
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });

        // **Проверка на капчу**
        const isCaptcha = await page.evaluate(() => {
            return document.body.innerText.includes("Подтвердите, что вы не робот") ||
                   document.querySelector('iframe[src*="recaptcha"]') !== null;
        });

        if (isCaptcha) {
            console.log(`❌ Капча обнаружена! Остановка скрипта.`);
            await browser.close();
            return;
        }

        const searchResults = await page.evaluate(() => {
            return [...document.querySelectorAll('div.tF2Cxc')].map(el => ({
                title: el.querySelector('h3')?.innerText || '',
                link: el.querySelector('a')?.href || '',
                description: el.querySelector('.VwiC3b')?.innerText || ''
            }));
        });

        let commercialCount = 0;
        for (const result of searchResults) {
            if (!result.link) continue;

            try {
                const subPage = await browser.newPage();
                await subPage.goto(result.link, { waitUntil: 'domcontentloaded', timeout: 10000 });

                const pageContent = await subPage.evaluate(() => document.body.innerText.toLowerCase());

                const commercialKeywords = [
                    "купить", "заказать", "оформить подписку", "тариф", "цена", "стоимость", "доступные планы", "подключить", "в корзину", "оплатить", "пробный период", "услуга"
                ];

                const isCommercial = commercialKeywords.some(keyword => pageContent.includes(keyword)) ||
                    ["каталог", "услуга", "продукт"].some(word => result.link.includes(word));

                if (isCommercial) commercialCount++;

                await subPage.close();
            } catch (error) {
                console.error(`⚠️ Ошибка при анализе страницы ${result.link}`);
            }
        }

        const commercialRate = (commercialCount / 9) * 100;
        const category = commercialRate <= 40 ? "Информационный" :
            commercialRate < 60 ? "Полукоммерческий" : "Коммерческий";

        results.push({
            query,
            commercialPages: commercialCount,
            commercialRate: commercialRate.toFixed(2),
            category
        });

        console.log(`✅ ${query}: ${commercialCount}/9 → ${commercialRate.toFixed(2)}% (${category})`);
    }

    await csvWriter.writeRecords(results);
    console.log(`\n📊 Данные сохранены в '${csvFilePath}'`);

    await browser.close();
})();

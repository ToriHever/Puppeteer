const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const readline = require('readline');

async function openIncognitoTab() {
    try {
        const browser = await puppeteer.launch({
            headless: false,
            args: ['--incognito']
        });

        const page = await browser.newPage();
        await page.goto('https://www.google.com');

        // 1. Перемещение на координаты 279;169 и клик
        await page.mouse.move(279, 169);
        await page.mouse.click(279, 169);

        // 2. Вставка запроса из буфера обмена в textarea
        await page.waitForSelector('textarea');
        const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
        console.log('Содержимое буфера обмена:', clipboardContent); // Отладка
        await page.type('textarea', clipboardContent);
        await page.keyboard.press('Enter');

        // Ждем загрузки результатов поиска
        await page.waitForNavigation();

        // 3. Ожидание ввода пользователя
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const userResponse = await new Promise(resolve => {
            rl.question('Введите что угодно для продолжения: ', (answer) => {
                rl.close();
                resolve(answer);
            });
        });

        // Получаем первые 9 ссылок из div с классом MjjYud
        const links = await page.evaluate(() => {
            const searchResults = Array.from(document.querySelectorAll('div.MjjYud'));
            let allLinks = [];
            
            // Собираем ссылки из каждого div.MjjYud
            searchResults.forEach(div => {
                const anchors = div.querySelectorAll('a');
                anchors.forEach(a => {
                    const href = a.href;
                    if (href && 
                        (href.startsWith('http://') || href.startsWith('https://')) && 
                        !href.includes('google.com') && 
                        !href.includes('/search?') && 
                        !href.includes('webcache') && 
                        !href.includes('translate')) {
                        allLinks.push(href);
                    }
                });
            });

            const filteredLinks = allLinks.slice(0, 9); // Берем первые 9
            console.log('Найденные ссылки:', filteredLinks); // Отладка в консоли браузера
            return filteredLinks;
        });

        console.log('Собранные ссылки:', links); // Отладка в консоли Node.js

        // Записываем ссылки в текстовый файл
        if (links.length > 0) {
            const content = links.join('\n');
            await fs.writeFile('search_results.txt', content);
            console.log('Ссылки сохранены в search_results.txt');
        } else {
            console.log('Не удалось найти ссылки для записи в файл');
            await fs.writeFile('search_results.txt', 'Нет результатов');
        }

        await browser.close();

    } catch (error) {
        console.error('Ошибка:', error);
    }
}

openIncognitoTab();
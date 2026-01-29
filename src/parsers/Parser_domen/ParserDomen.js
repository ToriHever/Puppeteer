import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { sendTelegramMessage } from '../Notifications_Telegram.js'

import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

puppeteer.use(StealthPlugin())

// --- Настройка числа воркеров вручную ---
const CONCURRENCY = 2  // установить нужное количество параллельных воркеров

const MAX_RETRIES = 1
const PAGE_TIMEOUT = 30000
const CHECK_HOST_URL = 'https://check-host.net/'
const OUTPUT_DIR = path.resolve('Parser_domen/Results')
const LOG_PATH = path.join(OUTPUT_DIR, 'log.txt')

// --- Утилита для генерации свободного имени CSV ---
async function getUniqueCsvPath(baseName) {
    let counter = 0
    while (true) {
        const filename = counter === 0
            ? `${baseName}.csv`
            : `${baseName}_${counter}.csv`
        const filePath = path.join(OUTPUT_DIR, filename)
        try {
            await fs.access(filePath)
            counter++
        } catch {
            return filePath
        }
    }
}

// --- Утилиты для логов и CSV ---
async function appendLog(text) {
    const entry = `[${new Date().toISOString()}] ${text}${os.EOL}`
    await fs.appendFile(LOG_PATH, entry)
}

async function initCsv(csvPath) {
    const header = '"Домен","Провайдер","Организация"' + os.EOL
    await fs.writeFile(csvPath, header, { flag: 'wx' })
}

async function appendCsv(csvPath, domain, provider, organization) {
    const quote = val => `"${val.replace(/"/g, '""')}"`
    const line = [domain, provider, organization].map(quote).join(',') + os.EOL
    await fs.appendFile(csvPath, line)
}

// --- Отклоняем тяжёлые ресурсы ---
async function setupInterception(page) {
    await page.setRequestInterception(true)
    page.on('request', req => {
        const t = req.resourceType()
        if (['image', 'stylesheet', 'font', 'media', 'websocket'].includes(t)) req.abort()
        else req.continue()
    })
}

// --- Обработка одного домена с ретраями ---
async function processDomain(browser, domain) {
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        const page = await browser.newPage()
        await page.setViewport({ width: 1366, height: 768 })
        await setupInterception(page)
        await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome/', 'Chrome/'))
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false })
        })

        try {
            await page.goto(CHECK_HOST_URL, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('input[name="host"]', { timeout: 10000 })
            await page.click('input[name="host"]', { clickCount: 3 })
            await page.keyboard.press('Backspace')
            await page.type('input[name="host"]', domain)
            await page.keyboard.press('Enter')
            await page.waitForSelector('div.flex-auto.w-full table tbody tr, .error', { timeout: 10000 })

            const hasError = await page.$('.error')
            if (hasError) throw new Error('.error найден на странице')

            const data = await page.evaluate(() => {
                const rows = document.querySelectorAll('div.flex-auto.w-full table tbody tr')
                if (rows.length < 5) return null
                const getText = i => rows[i]?.querySelector('td:last-child')?.innerText.trim() || 'Не найдено'
                return { provider: getText(3), organization: getText(4) }
            })
            if (!data) throw new Error('мало строк в таблице')

            await page.close()
            return data
        } catch (err) {
            await page.close()
            if (attempt > MAX_RETRIES) throw err
            await appendLog(`Retry #${attempt} для "${domain}" из-за ${err.message}`)
            await delay(1000 * attempt)
        }
    }
}

// --- Пул воркеров для параллельного выполнения ---
async function worker(browser, queue, csvPath, id) {
    console.log(`▶️ Worker #${id} запущен`)
    while (queue.length) {
        const domain = queue.shift()
        console.log(`Worker #${id} берёт домен: ${domain}`)
        const start = Date.now()
        try {
            const { provider, organization } = await processDomain(browser, domain)
            await appendCsv(csvPath, domain, provider, organization)
            console.log(`Worker #${id}: ${domain} → ok (${Date.now() - start} ms)`)
        } catch (err) {
            const msg = `Ошибка "${domain}" от Worker #${id}: ${err.message}`
            console.error(msg)
            await appendLog(msg)
        }
    }
    console.log(`⏹ Worker #${id} завершил работу`)
}

// --- Entry point ---
async function main() {
    await fs.mkdir(OUTPUT_DIR, { recursive: true })

    const csvPath = await getUniqueCsvPath('results')
    console.log('CSV will be written to:', csvPath)
    await initCsv(csvPath)

    const domensPath = path.join(__dirname, 'domens.txt')
    const domensTxt = await fs.readFile(domensPath, 'utf-8')

    const domains = domensTxt.split('\n').map(d => d.trim()).filter(Boolean)
    if (!domains.length) {
        const err = 'domens.txt пуст'
        await appendLog(err)
        await sendTelegramMessage('Ошибка: ' + err)
        return
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
        dumpio: true
    })

    const queue = [...domains]
    const workers = Array.from(
        { length: CONCURRENCY },
        (_, i) => worker(browser, queue, csvPath, i + 1)
    )
    await Promise.all(workers)

    await browser.close()
    await sendTelegramMessage(`✅ Скрипт завершён, результаты в ${csvPath}`)
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

main().catch(err => console.error(err))

import axios from 'axios'; // Для отправки сообщений в Telegram
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Токен и chat_id берутся из .env в корне репозитория (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '.env') });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Функция для отправки сообщений в Telegram
export async function sendTelegramMessage(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не установлены в .env — сообщение не отправлено');
        return;
    }
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
        });
        console.log(`Сообщение отправлено в Telegram: ${message}`);
    } catch (error) {
        console.error('Ошибка при отправке сообщения в Telegram:', error.message);
    }
}

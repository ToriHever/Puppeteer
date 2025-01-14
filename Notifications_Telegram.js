import axios from 'axios'; // Для отправки сообщений в Telegram

// Вставьте токен вашего Telegram-бота и ID вашего чата
const TELEGRAM_BOT_TOKEN = '7699817020:AAEVkRJJ-AoftwQMf5YI7TwAxO3g3JW1tMU';
const TELEGRAM_CHAT_ID = '815473891';

// Функция для отправки сообщений в Telegram
export async function sendTelegramMessage(message) {
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

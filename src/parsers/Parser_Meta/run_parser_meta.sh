#!/bin/bash

# Устанавливаем кодировку UTF-8
export LANG=en_US.UTF-8

# Определяем базовый путь с учетом пользователя
BASE_PATH="$HOME/Desktop/Puppeteer/Parser_Meta"
REQUESTS_FILE="$BASE_PATH/domens.txt"
SCRIPT_FILE="$BASE_PATH/parser_meta.js"

# Проверяем существование файла domens.txt
if [ -f "$REQUESTS_FILE" ]; then
    echo "Открытие domens.txt..."
    notepad.exe "$REQUESTS_FILE"
    echo "Файл закрыт. Скрипт запущен..."
else
    echo "Файл domens.txt не найден по указанному пути:"
    echo "$REQUESTS_FILE"
    echo "Пожалуйста, убедитесь, что файл существует."
    read -p "Нажмите любую клавишу, чтобы выйти..."
    exit 1
fi

# Переходим в директорию со скриптом
cd "$BASE_PATH" || { echo "Ошибка: директория не найдена!"; exit 1; }

# Запускаем Node.js скрипт
node "$SCRIPT_FILE"

EXIT_CODE=$?  # Получаем код завершения

# Если произошла ошибка (код выхода не 0), ждем нажатия клавиши
if [ "$EXIT_CODE" -ne 0 ]; then
    echo "Произошла ошибка. Нажмите любую клавишу для выхода..."
    read -n 1 -s
fi

# Выход из скрипта с тем же кодом
exit $EXIT_CODE

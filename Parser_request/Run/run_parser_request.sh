#!/bin/bash

# Устанавливаем кодировку UTF-8
export LANG=en_US.UTF-8

# Проверяем существование файла
if [ -f "/c/Users/DDGWindows/Desktop/Puppeteer/Parser_request/requests.txt" ]; then
    echo "Открытие requests.txt..."
    notepad.exe "/c/Users/DDGWindows/Desktop/Puppeteer/Parser_request/requests.txt"
    echo "Файл закрыт. Скрипт запущен..."
else
    echo "Файл Requests.txt не найден по указанному пути:"
    echo "/c/Users/DDGWindows/Desktop/Puppeteer/Parser_request/requests.txt"
    echo "Пожалуйста, убедитесь, что файл существует."
    read -p "Нажмите любую клавишу, чтобы выйти..."
    exit 1
fi

# Переходим в директорию со скриптом
cd "/c/Users/DDGWindows/Desktop/Puppeteer/Parser_request"

# Запускаем Node.js скрипт
node "wordstat-parser-ctrlV.js"


EXIT_CODE=$?  # Получаем код завершения

# Если произошла ошибка (код выхода не 0), ждем нажатия клавиши
if [ "$EXIT_CODE" -ne 0 ]; then
    echo "Произошла ошибка. Нажмите любую клавишу для выхода..."
    read -n 1 -s
fi

# Выход из скрипта с тем же кодом
exit $EXIT_CODE

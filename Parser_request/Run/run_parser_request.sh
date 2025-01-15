#!/bin/bash

# Устанавливаем кодировку UTF-8
export LANG=en_US.UTF-8

# Проверяем существование файла
if [ -f "/c/Users/DDGWindows/Desktop/Puppeteer/Parser_request/requests.txt" ]; then
    echo "Opening requests.txt..."
    notepad.exe "/c/Users/DDGWindows/Desktop/Puppeteer/Parser_request/requests.txt"
    echo "File closed. Running the script..."
else
    echo "File requests.txt not found at the specified path:"
    echo "/c/Users/DDGWindows/Desktop/Puppeteer/Parser_request/requests.txt"
    echo "Please make sure the file exists."
    read -p "Press any key to exit..."
    exit 1
fi

# Переходим в директорию со скриптом
cd "/c/Users/DDGWindows/Desktop/Puppeteer/Parser_request"

# Запускаем Node.js скрипт
node "wordstat-parser-ctrlV.js"

# Ожидание перед закрытием
echo "Script completed. Press any key to exit."
read -n 1 -s

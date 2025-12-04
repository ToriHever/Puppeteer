#!/bin/bash

# Устанавливаем кодировку UTF-8
export LANG=en_US.UTF-8

# Определяем базовый путь с учетом пользователя
BASE_PATH="$HOME/Desktop/Puppeteer"
SEARCH_RESULTS_PATH="$BASE_PATH/search_results"
QUERIES_FILE="$SEARCH_RESULTS_PATH/scripts/queries.txt"
SCRIPT_FILE="$SEARCH_RESULTS_PATH/scripts/cloud.js"

# Проверяем существование файла queries.txt
if [ -f "$QUERIES_FILE" ]; then
    echo "Открытие queries.txt для редактирования..."
    echo "=========================================="
    echo "Подготовьте список запросов для анализа."
    echo "Каждый запрос должен быть на новой строке."
    echo "=========================================="
    
    # Открываем файл для редактирования
    notepad.exe "$QUERIES_FILE"
    
    echo ""
    echo "Файл queries.txt закрыт. Запускаем скрипт анализа..."
    echo ""
else
    echo "Файл queries.txt не найден по указанному пути:"
    echo "$QUERIES_FILE"
    echo ""
    echo "Создаю файл queries.txt..."
    
    # Создаем директорию, если она не существует
    mkdir -p "$SEARCH_RESULTS_PATH"
    
    # Создаем файл с инструкцией
    cat > "$QUERIES_FILE" << EOF
# Введите запросы для анализа поисковых систем
# Каждый запрос должен быть на новой строке
# Пример:
# 
# смартфоны 2024
# ноутбуки для работы
# планшеты apple
EOF
    
    echo "Файл создан. Открываю для редактирования..."
    notepad.exe "$QUERIES_FILE"
    echo "Файл закрыт. Запускаем скрипт анализа..."
fi

# Проверяем существование скрипта cloud.js
if [ ! -f "$SCRIPT_FILE" ]; then
    echo "Ошибка: скрипт cloud.js не найден по пути:"
    echo "$SCRIPT_FILE"
    read -p "Нажмите любую клавишу, чтобы выйти..."
    exit 1
fi

# Переходим в директорию со скриптом
cd "$SEARCH_RESULTS_PATH" || { 
    echo "Ошибка: директория search_results не найдена!"; 
    exit 1; 
}

# Проверяем, не пустой ли файл queries.txt (учитываем только непустые строки, не начинающиеся с #)
QUERY_COUNT=$(grep -v '^[[:space:]]*#' "$QUERIES_FILE" | grep -v '^[[:space:]]*$' | wc -l)

if [ "$QUERY_COUNT" -eq 0 ]; then
    echo "Внимание: файл queries.txt не содержит запросов для анализа!"
    echo "Добавьте хотя бы один запрос в файл queries.txt"
    read -p "Нажмите любую клавишу, чтобы выйти..."
    exit 1
fi

echo "Найдено $QUERY_COUNT запросов для анализа..."
echo "Запуск скрипта cloud.js..."
echo "=========================================="

# Запускаем Node.js скрипт
node "$SCRIPT_FILE"

EXIT_CODE=$?  # Получаем код завершения

echo "=========================================="

# Проверяем код завершения
if [ "$EXIT_CODE" -eq 0 ]; then
    echo "Скрипт успешно завершил работу!"
    echo "Результаты сохранены в папке: $SEARCH_RESULTS_PATH"
else
    echo "Произошла ошибка при выполнении скрипта (код: $EXIT_CODE)."
fi

# Ждем нажатия клавиши, если запускался не из терминала
if [ -t 0 ]; then
    echo "Нажмите любую клавишу для выхода..."
    read -n 1 -s
fi

# Выход из скрипта с тем же кодом
exit $EXIT_CODE
#!/bin/bash

# Устанавливаем кодировку UTF-8
export LANG=en_US.UTF-8

# Цветной вывод
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Очистка экрана
clear

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}          🚀 PARSER LAUNCHER - ЗАПУСК${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

# Проверяем наличие Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ ОШИБКА: Node.js не установлен!${NC}"
    echo ""
    echo -e "${BLUE}📥 Установите Node.js:${NC}"
    echo "   - macOS: brew install node"
    echo "   - Ubuntu/Debian: sudo apt install nodejs npm"
    echo "   - Или скачайте с https://nodejs.org"
    echo ""
    read -p "Нажмите Enter для выхода..."
    exit 1
fi

# Проверяем наличие launcher.js
if [ ! -f "launcher.js" ]; then
    echo -e "${RED}❌ ОШИБКА: Файл launcher.js не найден!${NC}"
    echo ""
    echo -e "${BLUE}📁 Убедитесь, что вы запускаете скрипт из корневой папки проекта${NC}"
    echo "   Текущая директория: $(pwd)"
    echo ""
    read -p "Нажмите Enter для выхода..."
    exit 1
fi

# Проверяем наличие node_modules
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  ВНИМАНИЕ: Зависимости не установлены!${NC}"
    echo ""
    echo -e "${BLUE}📦 Установка зависимостей...${NC}"
    echo ""
    npm install
    
    if [ $? -ne 0 ]; then
        echo ""
        echo -e "${RED}❌ ОШИБКА: Не удалось установить зависимости${NC}"
        echo ""
        read -p "Нажмите Enter для выхода..."
        exit 1
    fi
    
    echo ""
    echo -e "${GREEN}✅ Зависимости установлены успешно!${NC}"
    echo ""
fi

# Проверяем наличие chalk
if [ ! -d "node_modules/chalk" ]; then
    echo -e "${BLUE}📦 Установка библиотеки chalk...${NC}"
    npm install chalk
    echo ""
fi

# Запускаем launcher
echo -e "${GREEN}▶️  Запуск Parser Launcher...${NC}"
echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

node launcher.js

# Сохраняем код завершения
EXIT_CODE=$?

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ Launcher завершён успешно${NC}"
else
    echo -e "${YELLOW}⚠️  Launcher завершён с кодом: $EXIT_CODE${NC}"
fi
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

# Ждём нажатия Enter только если терминал интерактивный
if [ -t 0 ]; then
    read -p "Нажмите Enter для выхода..."
fi

exit $EXIT_CODE
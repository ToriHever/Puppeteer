@echo off
chcp 65001 > nul
cls

echo.
echo ════════════════════════════════════════════════════════════
echo           🔍 SEARCH LINKS PARSER - ЗАПУСК
echo ════════════════════════════════════════════════════════════
echo.

REM Переходим в папку скрипта (на случай запуска из другого места)
cd /d "%~dp0"

REM Проверяем наличие Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ ОШИБКА: Node.js не установлен!
    echo.
    echo 📥 Установите Node.js с сайта: https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM Проверяем наличие parser.js
if not exist "parser.js" (
    echo ❌ ОШИБКА: Файл parser.js не найден!
    echo.
    echo 📁 Убедитесь, что run_parser.bat лежит в одной папке с parser.js
    echo    Текущая директория: %CD%
    echo.
    pause
    exit /b 1
)

REM Создаём pages.txt если его нет
if not exist "pages.txt" (
    echo # Введите URL страниц для проверки > pages.txt
    echo # Каждый URL с новой строки >> pages.txt
    echo # Строки начинающиеся с # игнорируются >> pages.txt
    echo. >> pages.txt
    echo ⚠️  Файл pages.txt не найден — создан пустой шаблон.
    echo.
)

REM Открываем pages.txt в Блокноте и ждём закрытия
echo 📝 Открываю pages.txt для редактирования...
echo    Добавьте нужные URL, сохраните файл ^(Ctrl+S^) и закройте Блокнот.
echo.
notepad.exe pages.txt

REM Проверяем что в файле есть хоть что-то (не считая пустых строк и комментариев)
set "HAS_URLS="
for /f "usebackq tokens=* delims=" %%L in ("pages.txt") do (
    set "LINE=%%L"
    if not "!LINE:~0,1!"=="#" (
        if not "!LINE!"=="" set "HAS_URLS=1"
    )
)

REM Для работы переменных внутри цикла нужен DelayedExpansion
setlocal enabledelayedexpansion
set "HAS_URLS="
for /f "usebackq tokens=* delims=" %%L in ("pages.txt") do (
    set "LINE=%%L"
    set "FIRST=!LINE:~0,1!"
    if not "!FIRST!"=="#" (
        if not "!LINE!"=="" set "HAS_URLS=1"
    )
)

if not defined HAS_URLS (
    echo ⚠️  Файл pages.txt пустой или содержит только комментарии.
    echo    Добавьте URL и запустите скрипт снова.
    echo.
    pause
    exit /b 1
)

REM Запускаем парсер
echo ▶️  Запускаю парсер...
echo.
echo ════════════════════════════════════════════════════════════
echo.

node parser.js

REM Сохраняем код завершения
set EXIT_CODE=%errorlevel%

echo.
echo ════════════════════════════════════════════════════════════
if %EXIT_CODE% equ 0 (
    echo ✅ Парсер завершён успешно
) else (
    echo ⚠️  Парсер завершён с ошибкой ^(код: %EXIT_CODE%^)
)
echo ════════════════════════════════════════════════════════════
echo.
echo Нажмите любую клавишу для выхода...
pause >nul

exit /b %EXIT_CODE%
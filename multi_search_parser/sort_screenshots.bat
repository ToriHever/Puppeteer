@echo off
chcp 65001 >nul
node "%~dp0sort_screenshots.js" %*
pause

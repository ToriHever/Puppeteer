@echo off
chcp 65001 > nul

:: Check if the file exists
if exist "C:\Users\DDGWindows\Desktop\Puppeteer\Parser_request\requests.txt" (
    echo Opening requests.txt...
    start /wait "C:\Windows\System32\notepad.exe" "C:\Users\DDGWindows\Desktop\Puppeteer\Parser_request\requests.txt"
    echo File closed. Running the script...
) else (
    echo File requests.txt not found at the specified path:
    echo C:\Users\DDGWindows\Desktop\Puppeteer\Parser_request\requests.txt
    echo Please make sure the file exists.
    pause
    exit /b
)

:: Navigate to the script folder
cd /d "C:\Users\DDGWindows\Desktop\Puppeteer\Parser_request"

:: Run the Node.js script
node "wordstat-parser-ctrlV.js"

:: Wait for user input before closing
echo Script completed. Press any key to exit.
pause

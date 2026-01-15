' ═══════════════════════════════════════════════════════════
' Parser Launcher - Запуск без окна консоли (Windows)
' ═══════════════════════════════════════════════════════════

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Получаем путь к директории скрипта
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName)

' Проверяем наличие launcher.js
launcherPath = scriptPath & "\launcher.js"
If Not fso.FileExists(launcherPath) Then
    MsgBox "❌ Ошибка: Файл launcher.js не найден!" & vbCrLf & vbCrLf & _
           "Путь: " & launcherPath, vbCritical, "Parser Launcher"
    WScript.Quit 1
End If

' Проверяем наличие Node.js
On Error Resume Next
WshShell.Run "node --version", 0, True
If Err.Number <> 0 Then
    MsgBox "❌ Ошибка: Node.js не установлен!" & vbCrLf & vbCrLf & _
           "Установите Node.js с сайта: https://nodejs.org", vbCritical, "Parser Launcher"
    WScript.Quit 1
End If
On Error GoTo 0

' Запускаем launcher в видимом окне консоли
WshShell.CurrentDirectory = scriptPath
WshShell.Run "cmd /k node launcher.js", 1, False

WScript.Quit 0
@echo off
setlocal
if /i "%~1"=="--normal" goto normal
if /i "%~1"=="--preview" goto preview
if /i "%~1"=="--check" goto check
if not "%~1"=="" goto usage
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0embedded\start-debug.ps1"
goto result
:normal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0embedded\normal-start.ps1"
goto result
:preview
start "" "%~dp0preview\monochrome.html"
exit /b 0
:check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0embedded\start-debug.ps1" -CheckOnly
goto result
:usage
echo Usage: "Start Codex.cmd" [--normal ^| --preview ^| --check]
exit /b 2
:result
set "startupExit=%errorlevel%"
if not "%startupExit%"=="0" pause
exit /b %startupExit%

@echo off
REM Set temp directory to local AppData to avoid OneDrive sync issues
set VITE_TMP_DIR=%LOCALAPPDATA%\Temp\vite-zabbix
if not exist "%VITE_TMP_DIR%" mkdir "%VITE_TMP_DIR%"

echo Starting Vite dev server...
npm run dev

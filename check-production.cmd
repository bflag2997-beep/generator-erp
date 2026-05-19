@echo off
cd /d "%~dp0"
echo Checking JavaScript syntax...
npm run check
if errorlevel 1 pause && exit /b 1

echo.
echo Checking running server health...
npm run health
if errorlevel 1 pause && exit /b 1

echo.
echo Production checks passed.
pause

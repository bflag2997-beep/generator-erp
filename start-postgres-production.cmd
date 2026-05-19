@echo off
cd /d "%~dp0"

echo Starting Generator ERP with PostgreSQL...
echo URL: http://127.0.0.1:8090
echo Connection settings are loaded from .env
echo.
npm start
pause

@echo off
cd /d "%~dp0"
echo Starting Generator ERP Production Server...
echo URL: http://127.0.0.1:8090
echo Default login: admin / ChangeMe-12345
echo Connection settings are loaded from .env
echo.
echo IMPORTANT: Change the default password before using real company data.
npm start
pause

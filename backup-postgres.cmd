@echo off
cd /d "%~dp0"

echo Creating PostgreSQL backup for Generator ERP...
echo Backup folder: %~dp0backups
echo.

npm run backup
if errorlevel 1 (
  echo.
  echo Backup failed.
  pause
  exit /b 1
)

echo.
echo Backup completed successfully.
pause

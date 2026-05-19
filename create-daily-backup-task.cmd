@echo off
cd /d "%~dp0"

set TASK_NAME=GeneratorERP-Daily-PostgreSQL-Backup
set BACKUP_CMD=%~dp0backup-postgres.cmd

echo Creating daily backup task: %TASK_NAME%
echo Backup time: 23:00
echo.

schtasks /Create /TN "%TASK_NAME%" /TR "\"%BACKUP_CMD%\"" /SC DAILY /ST 23:00 /F
if errorlevel 1 (
  echo.
  echo Could not create the scheduled task. Run this file as Administrator.
  pause
  exit /b 1
)

echo.
echo Daily backup task created successfully.
pause

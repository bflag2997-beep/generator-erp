@echo off
setlocal
set "ROOT=%~dp0"
set "TASK_NAME=Generator ERP USB Key Monitor"
set "SCRIPT=%ROOT%scripts\usb-key-monitor.ps1"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell غير موجود على هذا الجهاز.
  pause
  exit /b 1
)

schtasks /Create /TN "%TASK_NAME%" /SC ONLOGON /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%SCRIPT%\"" /RL LIMITED /F
if errorlevel 1 (
  echo فشل إنشاء مهمة التشغيل التلقائي.
  pause
  exit /b 1
)

schtasks /Run /TN "%TASK_NAME%"
echo.
echo تم تثبيت التشغيل التلقائي.
echo الآن ضع ملف generator-erp-usb.key داخل الفلاش.
echo عند وجود الفلاش، سيعمل النظام تلقائياً على:
echo http://127.0.0.1:8090
echo.
pause

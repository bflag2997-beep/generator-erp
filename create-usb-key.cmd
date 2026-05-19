@echo off
setlocal
echo.
echo اكتب حرف الفلاش مثل E أو F ثم اضغط Enter:
set /p DRIVE=USB Drive Letter: 
set "DRIVE=%DRIVE::=%"
set "TARGET=%DRIVE%:\generator-erp-usb.key"

if not exist "%DRIVE%:\" (
  echo هذا القرص غير موجود.
  pause
  exit /b 1
)

echo Generator ERP USB Key > "%TARGET%"
echo Created at %DATE% %TIME% >> "%TARGET%"
echo.
echo تم إنشاء مفتاح التشغيل:
echo %TARGET%
echo.
pause

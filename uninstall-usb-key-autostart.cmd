@echo off
setlocal
set "TASK_NAME=Generator ERP USB Key Monitor"
schtasks /Delete /TN "%TASK_NAME%" /F
echo تم حذف مهمة التشغيل التلقائي إن كانت موجودة.
pause

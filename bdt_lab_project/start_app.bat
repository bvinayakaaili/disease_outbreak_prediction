@echo off
setlocal

set PROJECT_DIR=%~dp0
cd /d "%PROJECT_DIR%"

echo Starting backend...
start "Backend" cmd /k "cd /d "%PROJECT_DIR%" && C:\Users\Hp\AppData\Local\Programs\Python\Python312\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000"

echo Starting frontend...
start "Frontend" cmd /k "cd /d "%PROJECT_DIR%\frontend" && npm run dev -- --host localhost --port 5173"

echo.
echo App started.
echo Backend: http://127.0.0.1:8000
echo Frontend: http://localhost:5173
pause

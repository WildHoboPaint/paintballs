@echo off
REM ===== High Velocity Paintball - server launcher (Windows) =====
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed or not on your PATH.
  echo  Install it from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

echo  Checking for an old server on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>nul

echo.
echo  Starting High Velocity Paintball server...
echo  Then open  http://localhost:3000  in your browser and hard-refresh with Ctrl+F5.
echo  Close this window to stop the server.
echo.
node server.js

echo.
echo  Server stopped. You can close this window.
pause

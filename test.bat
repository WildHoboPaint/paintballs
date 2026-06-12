@echo off
REM ===== High Velocity Paintball - self test =====
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org
  pause
  exit /b 1
)

echo Checking server files compile...
node --check game.js && echo   game.js OK || echo   game.js HAS A SYNTAX ERROR
node --check server.js && echo   server.js OK || echo   server.js HAS A SYNTAX ERROR
echo.
echo Running gameplay self-test...
echo.
node selftest.js

echo.
pause

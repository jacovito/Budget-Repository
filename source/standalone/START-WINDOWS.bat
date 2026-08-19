@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Paycheck requires Node.js 22 or newer from https://nodejs.org/
  pause
  exit /b 1
)
start "" "http://localhost:4173/"
node "%~dp0run-local.mjs"
pause

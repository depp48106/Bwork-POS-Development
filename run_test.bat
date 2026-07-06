@echo off
title Bwork POS - Server Starter (Test Mode)
echo ====================================================
echo   Stopping any old running POS servers...
echo ====================================================
taskkill /f /im node.exe 2>nul
echo.
echo ====================================================
echo   Starting Bwork POS System (Test Mode - database_test.sqlite)
echo ====================================================
echo.
echo Opening Web Browser at http://localhost:5000 ...
start "" "http://localhost:5000"
echo.
echo Launching Server...
npm run start:test
if %ERRORLEVEL% neq 0 (
  echo.
  echo [ERROR] Failed to start the server.
  echo Please make sure Node.js is installed on your computer.
  echo If this is your first time running, make sure to install dependencies first.
  echo.
  pause
)

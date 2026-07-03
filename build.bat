@echo off
title Bwork POS - Installer & Builder
echo ===================================================
echo   Installing Dependencies (Bwork POS)
echo ===================================================
echo.
echo 1. Installing root dependencies...
call npm install
echo.
echo 2. Installing backend dependencies...
call npm install --prefix backend
echo.
echo 3. Installing frontend dependencies...
call npm install --prefix frontend
echo.
echo ===================================================
echo   Building Frontend Static Web Assets
echo ===================================================
echo.
call npm run build
echo.
echo ===================================================
echo   Finished! You can now close this window and
echo   double-click 'run.bat' to start the application.
echo ===================================================
pause

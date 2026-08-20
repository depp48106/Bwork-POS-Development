@echo off
title Bwork POS - Installer & Builder
echo ===================================================
echo   Installing Dependencies (Bwork POS & Booking App)
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
echo 4. Installing booking-app dependencies...
call npm install --prefix booking-app
echo.
echo ===================================================
echo   Building Frontend Static Web Assets
echo ===================================================
echo.
echo 1/2 Building POS Frontend...
call npm run build --prefix frontend
echo.
echo 2/2 Building Booking App...
call npm run build --prefix booking-app
echo.
echo ===================================================
echo   Finished! All components built successfully.
echo   - POS Production Build: frontend/dist & backend/public
echo   - Booking App Production Build: booking-app/dist
echo ===================================================
pause

@echo off
title Bwork POS & Booking - Cloudflare Deployer
echo ====================================================
echo   Cloudflare Deployment (Worker & Pages)
echo ====================================================
echo.
echo 1/3 Building production assets...
call npm run build --prefix frontend
call npm run build --prefix booking-app
echo.
echo 2/3 Deploying Cloudflare Worker API (bwork-pos-api)...
cd backend
echo - Executing D1 database schema migrations...
call npx wrangler d1 execute bworkpos_db --remote --file=migrations.sql
call npx wrangler deploy
cd ..
echo.
echo 3/3 Deploying Cloudflare Pages...
echo - Deploying POS Frontend (bwork-pos.pages.dev)...
cd frontend
call npx wrangler pages deploy dist --project-name=bwork-pos --commit-dirty=true
cd ..
echo.
echo - Deploying Booking App (bwork-booking.pages.dev)...
cd booking-app
call npx wrangler pages deploy dist --project-name=bwork-booking --commit-dirty=true
cd ..
echo.
echo ====================================================
echo   Deployment completed!
echo   - Backend API: https://bwork-pos-api.ohnatza74185-ky.workers.dev
echo   - POS Frontend: https://bwork-pos.pages.dev/
echo   - Booking App: https://bwork-booking.pages.dev/
echo ====================================================
pause

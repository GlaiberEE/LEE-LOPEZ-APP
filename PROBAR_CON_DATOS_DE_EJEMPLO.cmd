@echo off
chcp 65001 >nul
title Elevated Exteriors - DEMO (datos ficticios)
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js: instale la version LTS de https://nodejs.org & pause & exit /b 1)
node --no-warnings demo.js
set DATA_DIR=datos-demo
set PORT=8091
start "" http://localhost:8091
node --no-warnings server.js
pause

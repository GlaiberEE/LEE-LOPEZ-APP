@echo off
chcp 65001 >nul
title Elevated Exteriors - App
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Instale la version LTS desde https://nodejs.org y vuelva a abrir este archivo.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:8090
node --no-warnings server.js
pause

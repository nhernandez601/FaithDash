@echo off
title Faith Dash
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing game parts, this takes a minute...
  call npm install
)
echo.
echo Starting Faith Dash. Your browser will open. Close this window to stop the game.
echo To play on a phone on the same Wi-Fi, open the "Network" address shown below.
echo.
call npm run dev -- --open
pause

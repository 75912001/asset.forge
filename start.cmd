@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13+ is required. Node.js 24 LTS is recommended.
  pause
  exit /b 1
)
node local\launch.mjs
if errorlevel 1 pause

@echo off
cd /d "%~dp0"
node local\stop.mjs
if errorlevel 1 pause

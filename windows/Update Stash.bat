@echo off
REM Double-click this to get the latest Stash. Your board is never touched.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
echo.
pause

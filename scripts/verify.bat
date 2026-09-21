@echo off
setlocal

cd /d "%~dp0\.."
if errorlevel 1 exit /b 1

echo == remote-compute verification (Windows) ==
call npm run verify
if errorlevel 1 exit /b %errorlevel%

exit /b 0

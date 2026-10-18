@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Hermo requires Node.js 24 or newer, including npm.
  echo Install the LTS version from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node scripts/start-hermo.mjs %*
set "HERMO_EXIT_CODE=%ERRORLEVEL%"
if not "%HERMO_EXIT_CODE%"=="0" pause
exit /b %HERMO_EXIT_CODE%

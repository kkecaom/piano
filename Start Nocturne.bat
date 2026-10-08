@echo off
rem Double-click on Windows: starts Nocturne and opens it in your default browser.
cd /d "%~dp0"
set PORT=8000
set PY=
py -3 --version >nul 2>nul && set PY=py -3
if not defined PY python --version >nul 2>nul && set PY=python
if not defined PY (
  echo Python is needed. Install it from https://www.python.org/downloads/ and tick "Add Python to PATH", then double-click this file again.
  pause
  exit /b 1
)
start "" cmd /c "ping -n 2 127.0.0.1 >nul & start http://localhost:%PORT%"
echo.
echo   Nocturne is playing at http://localhost:%PORT%
echo   Keep this window open while you listen. Close it to stop.
echo.
%PY% -m http.server %PORT% --bind 127.0.0.1
if errorlevel 1 (
  echo Port %PORT% may be in use. Close other Nocturne windows and try again.
  pause
)

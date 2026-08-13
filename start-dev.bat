@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   Nova Dev Starter
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install: https://nodejs.org/
  goto END
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Reinstall Node.js.
  goto END
)

set "PORT=5173"
set "URL=http://127.0.0.1:%PORT%/Nova/"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

echo [1/5] Close existing instance on port %PORT% (if any)...
call "%~dp0_stop-port.bat" %PORT%

echo [2/5] npm install...
call npm.cmd install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  goto END
)
echo.

echo [3/5] Start Vite in a new window...
start "Nova Vite" cmd /k "cd /d ""%~dp0"" && npm.cmd run dev -- --host 127.0.0.1 --strictPort --port %PORT%"

echo [4/5] Wait until server is ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url='%URL%'; $ok=$false;" ^
  "for ($i=0; $i -lt 60; $i++) {" ^
  "  try {" ^
  "    $r=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1;" ^
  "    if ($r.StatusCode -eq 200) { $ok=$true; break }" ^
  "  } catch {}" ^
  "  Start-Sleep -Seconds 1" ^
  "}" ^
  "if (-not $ok) { Write-Host '  ERROR: server not ready in time.'; exit 1 }" ^
  "Write-Host '  Server is ready.'"
if errorlevel 1 (
  echo [ERROR] Vite did not become ready. Check the "Nova Vite" window for errors.
  goto END
)

echo [5/5] Open Chrome...
if exist "%CHROME%" (
  start "" "%CHROME%" "%URL%"
) else (
  start "" "%URL%"
)

echo.
echo ========================================
echo   Running: %URL%
echo   - Chrome should be open now
echo   - Close the "Nova Vite" window to stop
echo   - Or press a key here to stop + exit
echo ========================================
pause >nul

echo Stopping server...
call "%~dp0_stop-port.bat" %PORT%

:END
echo.
echo Finished.
pause
endlocal

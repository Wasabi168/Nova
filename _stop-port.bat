@echo off
setlocal EnableExtensions
set "PORT=%~1"
if "%PORT%"=="" set "PORT=5173"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = %PORT%;" ^
  "$ids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Where-Object { $_ -gt 0 } | Sort-Object -Unique;" ^
  "if (-not $ids) { Write-Host '  No process listening on port' $port; exit 0 }" ^
  "foreach ($id in $ids) {" ^
  "  $name = 'unknown';" ^
  "  $p = Get-Process -Id $id -ErrorAction SilentlyContinue;" ^
  "  if ($p) { $name = $p.ProcessName }" ^
  "  Write-Host ('  Closing PID {0} ({1})' -f $id, $name);" ^
  "  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue" ^
  "}" ^
  "Start-Sleep -Seconds 1"

endlocal

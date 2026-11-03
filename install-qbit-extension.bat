@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-qbit-extension.ps1"
if errorlevel 1 (
  echo.
  echo La instalacion no pudo completarse.
  pause
)
endlocal

@echo off
setlocal EnableExtensions
set "ERR=1"

rem StructureLab — build 64-bit NSIS installer (Windows)
rem Pauses at the end so errors stay visible when double-clicked.

cd /d "%~dp0..\.."
if not exist "package.json" (
  echo ERROR: Could not find the StructureLab repo root.
  goto :end
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1"
set "ERR=%ERRORLEVEL%"

echo.
if not "%ERR%"=="0" (
  echo === Build stopped with errors ^(exit %ERR%^) ===
) else (
  echo === Build finished successfully ===
)

:end
echo.
pause
exit /b %ERR%

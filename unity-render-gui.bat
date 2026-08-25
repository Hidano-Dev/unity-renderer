@echo off
rem Launch the Unity Render scene-selection GUI in the default browser.
rem ASCII only: cmd parses batch files with the active code page, so any
rem non-ASCII byte here breaks the whole file.
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "EXE=%~dp0unity-render.exe"
if not exist "%EXE%" set "EXE=%~dp0dist\unity-render.exe"

if not exist "%EXE%" (
  echo unity-render.exe was not found.
  echo Place this file next to unity-render.exe, or build it with: pnpm build
  echo.
  pause
  exit /b 1
)

echo Starting the Unity Render GUI...
echo Keep this window open while you use the GUI. Press Ctrl+C to quit.
echo.
"%EXE%" gui
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo The GUI exited with code %CODE%.
  pause
)
endlocal

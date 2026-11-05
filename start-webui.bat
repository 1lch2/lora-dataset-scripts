@echo off
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
if not exist ".venv-preprocess\Scripts\python.exe" (
    echo Missing .venv-preprocess. Run install-deps.bat first. See PREPROCESS.md.
    pause
    exit /b 1
)
".venv-preprocess\Scripts\python.exe" core\launch_webui.py %*
set "LAUNCH_EXIT=%ERRORLEVEL%"
if not "%LAUNCH_EXIT%"=="0" pause
exit /b %LAUNCH_EXIT%

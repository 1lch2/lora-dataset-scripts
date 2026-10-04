@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
set PYTHONUTF8=1
if not exist ".venv-preprocess\Scripts\python.exe" goto setup
".venv-preprocess\Scripts\python.exe" -c "import sys; assert sys.prefix != sys.base_prefix" >nul 2>&1
if errorlevel 1 (
    echo Existing .venv-preprocess is not usable. Rename it and retry.
    goto failed
)
fc /b "requirements-preprocess.txt" ".venv-preprocess\requirements-installed.txt" >nul 2>&1
if not errorlevel 1 goto launch

:setup
where uv >nul 2>&1
if errorlevel 1 (
    echo uv is required for environment setup. Install uv and run this script again.
    goto failed
)
if not exist ".venv-preprocess\Scripts\python.exe" (
    echo Creating .venv-preprocess with Python 3.10...
    uv venv --python 3.10 ".venv-preprocess"
    if errorlevel 1 goto failed
)
echo Installing preprocessing dependencies...
uv pip install --python ".venv-preprocess\Scripts\python.exe" -r "requirements-preprocess.txt"
if errorlevel 1 goto failed
copy /y "requirements-preprocess.txt" ".venv-preprocess\requirements-installed.txt" >nul
if errorlevel 1 goto failed

:launch
".venv-preprocess\Scripts\python.exe" core\launch_webui.py %*
set "LAUNCH_EXIT=%ERRORLEVEL%"
if not "%LAUNCH_EXIT%"=="0" pause
exit /b %LAUNCH_EXIT%

:failed
echo Environment setup failed. See the error above and retry.
pause
exit /b 1

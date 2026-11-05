@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"

echo [1/4] Checking Node.js and npm...
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22 || (a===22 && b>=12) ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
    echo Node.js 22.12 or newer is required. Install it from https://nodejs.org/
    echo Include npm and add Node.js to PATH, then reopen this script.
    goto failed
)
call npm.cmd --version
if errorlevel 1 (
    echo npm is missing or cannot run. Reinstall Node.js with npm and PATH enabled.
    goto failed
)

echo [2/4] Preparing project Python 3.10 environment...
uv --version >nul 2>&1
if errorlevel 1 (
    echo uv is required. Install it in PowerShell with:
    echo     winget install --id=astral-sh.uv -e
    echo Or follow https://docs.astral.sh/uv/getting-started/installation/
    echo Reopen your terminal or this script after installation.
    echo uv will download Python 3.10; no system Python 3.10 installation is needed.
    goto failed
)
if exist ".venv-preprocess\Scripts\python.exe" goto check_venv
if exist ".venv-preprocess" (
    echo Existing .venv-preprocess is incomplete. Rename it before retrying.
    goto failed
)
uv venv --python 3.10 --managed-python .venv-preprocess
if errorlevel 1 goto failed

:check_venv
".venv-preprocess\Scripts\python.exe" -c "import sys; sys.exit(0 if sys.version_info[:2] == (3,10) else 1)"
if errorlevel 1 (
    echo Existing .venv-preprocess cannot run Python 3.10.
    echo Rename the old environment and retry; uv will prepare Python 3.10.
    goto failed
)

echo [3/4] Installing project Python dependencies...
uv pip install --python ".venv-preprocess\Scripts\python.exe" --default-index https://pypi.tuna.tsinghua.edu.cn/simple -r requirements-preprocess.txt
if errorlevel 1 goto failed

echo [4/4] Installing frontend dependencies...
call npm.cmd ci --prefix app
if errorlevel 1 goto failed

echo.
echo Project dependencies installed. Run start-webui.bat to open the WebUI.
echo Forge Neo, plugins and model weights are not installed by this script.
pause
exit /b 0

:failed
echo.
echo Installation stopped. Fix the error above, then run install-deps.bat again.
pause
exit /b 1

"""管理审核 API 对应的 Vite 开发服务，Forge 进程由原启动器独立管理。"""
import os
import shutil
import socket
import subprocess
import time
import webbrowser
from pathlib import Path

import requests

APP = Path(__file__).resolve().parents[2] / 'app'


def stop_frontend(process):
    if process is None or process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        process.terminate()
    process.wait(timeout=10)


def start_frontend(api_port, port=5173, open_browser=True):
    url = f'http://127.0.0.1:{port}'
    api_url = f'http://127.0.0.1:{api_port}'
    session = requests.get(api_url + '/api/session', timeout=5)
    if session.status_code == 404:
        raise ValueError(f'端口 {api_port} 仍运行旧版审核服务，请关闭旧审核终端后重试，或使用 --port 指定其他端口；无需关闭 Forge')
    session.raise_for_status()
    token = session.json()['token']

    def ready():
        try:
            response = requests.get(url + '/api/session', timeout=2)
            return response.ok and response.json().get('token') == token and requests.get(url + '/@vite/client', timeout=2).ok
        except (requests.RequestException, ValueError):
            return False

    process = None
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            occupied = True
    except OSError:
        occupied = False
    if occupied:
        if not ready():
            raise ValueError(f'前端端口 {port} 被其他服务或数据集占用，请使用 --frontend-port 指定其他端口')
        print(f'复用前端开发服务：{url}', flush=True)
    else:
        npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
        if not npm:
            raise ValueError('未找到 npm，请安装 Node.js 22.12+，然后在 app 目录执行 npm install')
        if not (APP / 'node_modules' / 'vite' / 'bin' / 'vite.js').is_file():
            raise ValueError('前端依赖尚未安装，请在 app 目录执行 npm install')
        env = dict(os.environ, REVIEW_API_URL=api_url)
        command = [npm, 'run', 'dev', '--', '--port', str(port)]
        if os.name == 'nt':
            command = ['cmd.exe', '/d', '/c', *command]
        process = subprocess.Popen(command, cwd=APP, env=env)
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise ValueError(f'npm run dev 启动失败，退出码：{process.returncode}')
                if ready():
                    break
                time.sleep(0.25)
            else:
                raise ValueError('等待 Vite 开发服务超时，请检查终端日志')
        except BaseException:
            stop_frontend(process)
            raise
    print(f'审核页：{url}；API：{api_url}（Ctrl+C 停止，Forge 独立保留）', flush=True)
    if open_browser:
        webbrowser.open(url)
    return process

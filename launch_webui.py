"""Windows launcher: reuse Forge or start it in a dedicated visible console."""
import argparse
import os
import re
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

import requests

from dataset_pipeline.core import prepare, read_config, run_lock
from dataset_pipeline.review import serve

ROOT = Path(__file__).resolve().parent


def listening(host, port):
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def forge_ready(url):
    try:
        response = requests.get(url.rstrip('/') + '/sdapi/v1/upscalers', timeout=3)
        return response.ok and isinstance(response.json(), list)
    except (requests.RequestException, ValueError):
        return False


def forge_arguments(directory):
    # Preserve this installation's literal startup options without executing or
    # rewriting webui-user.bat (which does not forward --api to webui.bat).
    user_bat = directory / 'webui-user.bat'
    if not user_bat.is_file():
        return os.environ.get('COMMANDLINE_ARGS', '')
    content = user_bat.read_bytes().decode('utf-8', errors='replace')
    value = os.environ.get('COMMANDLINE_ARGS', '')
    for assignment in re.findall(r'^\s*@?set\s+(.+?)\s*$', content, re.I | re.M):
        if assignment.startswith('"') and assignment.endswith('"'):
            assignment = assignment[1:-1]
        name, separator, setting = assignment.partition('=')
        if separator and name.upper() == 'COMMANDLINE_ARGS':
            value = setting.strip()
    if any(c in value for c in '%!&|<>^\r\n'):
        raise ValueError('webui-user.bat 使用动态启动参数，请先手动启动带 --api 的 Forge 再运行本入口')
    return value


def forge_console(directory, port):
    directory = directory.resolve()
    if not (directory / 'webui.bat').is_file():
        raise ValueError(f'未找到 Forge 启动脚本：{directory / "webui.bat"}')
    env = os.environ.copy()
    env['COMMANDLINE_ARGS'] = forge_arguments(directory) + f' --api --port {port}'
    if os.name == 'nt':
        import ctypes
        ctypes.windll.kernel32.SetConsoleTitleW('Forge - API / model logs')
    print(f'Forge 独立终端：{directory}\n关闭本窗口可停止此 Forge 实例。', flush=True)
    try:
        return subprocess.call(['cmd.exe', '/d', '/c', 'webui.bat'], cwd=directory, env=env)
    except KeyboardInterrupt:
        return 130
    finally:
        try:
            input('\nForge 已退出。按 Enter 关闭终端…')
        except (EOFError, KeyboardInterrupt):
            pass


def ensure_forge(url, directory, timeout):
    if forge_ready(url):
        print(f'复用 Forge API：{url}', flush=True)
        return
    address = urlparse(url)
    if address.hostname not in ('127.0.0.1', 'localhost', '::1') or address.scheme != 'http':
        raise ValueError(f'Forge API 未就绪：{url}。远程或 HTTPS 地址需先自行启动服务')
    port = address.port or 80
    if not listening(address.hostname, port):
        directory = directory.resolve()
        if not (directory / 'webui.bat').is_file():
            raise ValueError(f'未找到 {directory / "webui.bat"}，请使用 --forge-dir 指定 Forge 目录')
        forge_arguments(directory)  # Validate before opening a console.
        if os.name != 'nt':
            raise ValueError('自动启动 Forge 的 BAT 脚本仅支持 Windows')
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--forge-console',
                          '--forge-dir', str(directory), '--port', str(port)],
                         cwd=ROOT, creationflags=subprocess.CREATE_NEW_CONSOLE)
        print('已打开 Forge 独立终端，正在等待 API 就绪…', flush=True)
    else:
        print('Forge 端口已被占用，等待已有服务 API 就绪，不启动第二个实例…', flush=True)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if forge_ready(url):
            print('Forge API 已就绪。', flush=True)
            return
        time.sleep(2)
    raise ValueError(f'等待 Forge API 超时：{url}。请检查 Forge 终端日志及 --api 参数；确认端口没有被其他服务占用')


def launch(config_path, forge_dir, port, timeout, open_browser=True):
    config = read_config(config_path)
    review_url = f'http://127.0.0.1:{port}'
    # Inspect the existing review process before starting any new services.
    existing = False
    if listening('127.0.0.1', port):
        try:
            response = requests.get(review_url + '/api/state', timeout=5)
            response.raise_for_status()
            data = response.json()
            existing = Path(data['config']['run_dir']).resolve() == Path(config['run_dir']).resolve()
        except (requests.RequestException, ValueError, KeyError, TypeError):
            pass
        if not existing:
            raise ValueError(f'审核端口 {port} 被其他服务或数据集占用，请使用 --port 指定其他端口')
    ensure_forge(config['forge_url'], forge_dir, timeout)
    if existing:
        print(f'复用当前数据集的审核页：{review_url}', flush=True)
        if open_browser:
            webbrowser.open(review_url)
        return
    if not (Path(config['run_dir']) / 'manifest.json').is_file():
        print('首次运行，正在准备图片；进度显示在此终端。', flush=True)
        with run_lock(config['run_dir']):
            _, failures = prepare(config)
        if failures:
            print('部分图片准备失败，可在审核页查看：\n' + '\n'.join(failures), flush=True)
    print('正在启动审核服务。关闭本终端可停止审核服务；Forge 终端独立保留。', flush=True)
    serve(config['run_dir'], port, open_browser)


def main():
    parser = argparse.ArgumentParser(description='启动 LoRA 审核页和 Forge API')
    parser.add_argument('--config', type=Path, default=ROOT / 'preprocess.local.json')
    parser.add_argument('--forge-dir', type=Path, default=Path('E:/stable-diffusion-webui-forge-classic'))
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--timeout', type=int, default=600, help='等待 Forge API 的秒数')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--forge-console', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if not 1 <= args.port <= 65535 or args.timeout <= 0:
            raise ValueError('端口须为 1–65535，等待时间须大于零')
        if args.forge_console:
            return forge_console(args.forge_dir, args.port)
        launch(args.config, args.forge_dir, args.port, args.timeout, not args.no_browser)
        return 0
    except (OSError, ValueError) as error:
        print(f'启动失败：{error}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == '__main__':
    raise SystemExit(main())

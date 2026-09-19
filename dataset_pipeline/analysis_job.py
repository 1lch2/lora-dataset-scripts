"""One cancellable, network-disabled analysis subprocess per local server."""
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import threading


class AnalysisJob:
    def __init__(self, default_model_cache=None):
        self.lock = threading.RLock()
        self.temp = None
        self.process = None
        self.state = {'status':'idle'}
        self.default_model_cache = default_model_cache

    def failure_message(self, code):
        folder = Path(self.temp.name)
        detail = {}
        try:
            detail = json.loads((folder/'error.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            pass
        # Do not send raw library logs (which can include private paths) to the UI.
        kind = detail.get('type')
        if not kind:
            try:
                with (folder/'worker.log').open('rb') as stream:
                    stream.seek(0,2)
                    stream.seek(max(0,stream.tell()-8192))
                    tail = stream.read().decode('utf-8',errors='replace')
                matches = re.findall(r'^([A-Za-z][A-Za-z0-9_]*(?:Error|Exception)):',tail,re.M)
                kind = matches[-1] if matches else None
            except OSError:
                pass
        stage = {'analysis':'计算图片统计','report':'写入 JSON 报告','csv':'写入 CSV 报告'}.get(detail.get('stage'),'启动或运行分析进程')
        parts = [f'{stage}失败', f'退出码 {code} (0x{code & 0xffffffff:08X})']
        if kind:
            parts.append(str(kind))
        if detail.get('winerror') is not None:
            parts.append(f"WinError {detail['winerror']}")
        elif detail.get('errno') is not None:
            parts.append(f"errno {detail['errno']}")
        hints = {'PermissionError':'请检查临时报告目录的写入权限或文件占用。',
                 'MemoryError':'分析进程内存不足，请缩小批次或关闭其他占用内存的程序。',
                 'ModuleNotFoundError':'分析使用当前 WebUI 的 Python 环境，请检查此环境的依赖安装。',
                 'ImportError':'当前 Python 环境的分析依赖无法导入。',
                 'FileNotFoundError':'输入目录或报告目录已不存在，请检查路径。'}
        suffix = hints.get(kind,'可在本地临时目录的 worker.log 查看详细错误。')
        if code == 0:
            suffix = '进程已退出但没有生成报告，请查看本地 worker.log。'
        return '；'.join(parts)+'。'+suffix

    def status(self):
        with self.lock:
            if self.process is not None and self.state['status'] == 'running':
                code = self.process.poll()
                if code is not None:
                    ok = code == 0 and (Path(self.temp.name)/'report.json').is_file()
                    self.state.update(status='complete' if ok else 'failed')
                    if not ok:
                        self.state['error'] = self.failure_message(code)
                        self.state['exit_code'] = code
                        self.state['log_path'] = str(Path(self.temp.name)/'worker.log')
                path = Path(self.temp.name)/'progress.json'
                if path.is_file():
                    try:
                        self.state.update(json.loads(path.read_text(encoding='utf-8')))
                    except (OSError, ValueError):
                        pass
            return dict(self.state)

    def start(self, data):
        with self.lock:
            if self.status()['status'] == 'running':
                raise ValueError('已有分析任务正在运行')
            path = Path(data.get('directory','')).expanduser().resolve()
            if not data.get('directory') or not path.is_dir():
                raise ValueError('请输入存在的本地目录')
            for key in ('pose','captions','recursive'):
                if key in data and not isinstance(data[key],bool):
                    raise ValueError('选项必须为布尔值')
            limit = int(data.get('pair_limit',1500))
            threshold = float(data.get('pose_threshold',.18))
            hash_threshold = int(data.get('hash_threshold',6))
            if not 2 <= limit <= 5000 or not 0 < threshold <= 1 or not 0 <= hash_threshold <= 16:
                raise ValueError('比较上限或相似阈值超出范围')
            self.close()
            self.temp = tempfile.TemporaryDirectory(prefix='dataset-analysis-')
            args = [sys.executable,'-m','dataset_pipeline.analysis',str(path),
                    '--output',str(Path(self.temp.name)/'report.json'),
                    '--progress',str(Path(self.temp.name)/'progress.json'),
                    '--error-file',str(Path(self.temp.name)/'error.json'),
                    '--pair-limit',str(limit),'--pose-threshold',str(threshold),'--hash-threshold',str(hash_threshold)]
            for name in ('pose','captions'):
                if data.get(name):
                    args.append('--'+name)
            if not data.get('recursive',True):
                args.append('--no-recursive')
            model_cache = data.get('model_cache') or os.environ.get('HF_HOME') or self.default_model_cache
            if model_cache:
                args.extend(['--model-cache',str(model_cache)])
            env = dict(os.environ,HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TRANSFORMERS_OFFLINE='1',PYTHONUTF8='1')
            self.state = {'status':'running','phase':'scan','done':0,'total':0}
            try:
                with (Path(self.temp.name)/'worker.log').open('wb') as log:
                    self.process = subprocess.Popen(args,cwd=Path(__file__).resolve().parent.parent,
                        env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            except Exception:
                self.state = {'status':'failed','error':'无法启动分析进程'}
                raise
            return self.status()

    def cancel(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                self.process.terminate()
                self.process.wait(timeout=10)
                self.state['status'] = 'cancelled'
            return self.status()

    def report(self):
        with self.lock:
            if self.status()['status'] != 'complete':
                raise ValueError('报告尚未生成')
            return json.loads((Path(self.temp.name)/'report.json').read_text(encoding='utf-8'))

    def close(self):
        with self.lock:
            self.cancel()
            if self.temp:
                self.temp.cleanup()
            self.temp = self.process = None

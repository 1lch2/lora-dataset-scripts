"""WebUI 内部离线分析进程，从标准输入接收后台已校验的任务。"""
import json
import os
import sys
from pathlib import Path

from .analysis import analyze_directory, offline_mode, write_progress


def run_worker():
    request = json.load(sys.stdin)
    offline_mode()
    if request['model_cache']:
        os.environ['HF_HOME'] = str(Path(request['model_cache']).resolve())
    stage = 'analysis'
    try:
        report = analyze_directory(
            request['directory'], recursive=request['recursive'], pose=request['pose'],
            captions=request['captions'], pair_limit=request['pair_limit'],
            pose_threshold=request['pose_threshold'], hash_threshold=request['hash_threshold'],
            progress=lambda data: write_progress(request['progress'], data))
        stage = 'report'
        with Path(request['output']).open('x', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, allow_nan=False)
        return 0
    except Exception as error:
        # 诊断文件不包含素材路径、标签和像素。
        try:
            Path(request['error_file']).write_text(json.dumps(dict(
                type=type(error).__name__, stage=stage, errno=getattr(error, 'errno', None),
                winerror=getattr(error, 'winerror', None))), encoding='utf-8')
        except OSError:
            pass
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(run_worker())

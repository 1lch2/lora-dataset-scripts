import json
import mimetypes
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from generate_lora_tag import generate_lora_tags
from rename import DIR as LORA_OUTPUT_DIR, plan_renames, rename_files

from .core import DEFAULTS, Run, asset, run_lock
from .geometry import default_scale
from .analysis_job import AnalysisJob
from .datasets import detect_source, import_config, import_sources, list_datasets, upscale_source


def make_server(directory=None, port=8765, config=None, model_setup=None):
    directory = Path(directory).resolve() if directory is not None else None
    if directory is not None:
        with run_lock(directory):
            Run.load(directory).ensure_tag_files()
    cache = (directory.parent if directory else Path(__file__).resolve().parents[2]/'runs')/'.models'
    analysis = AnalysisJob(cache if cache.is_dir() else None)
    token = secrets.token_urlsafe(24)
    mutex = threading.RLock()
    static = Path(__file__).resolve().parents[2] / 'app' / 'dist'
    job = {"id": None, "status": "idle", "action": None, "errors": []}
    template = dict(config if config is not None else Run.load(directory).config if directory else {})
    analysis_only = directory is None and config is None

    def process_job(action, group=None):
        try:
            with run_lock(directory):
                run = Run.load(directory)
                if action == "sync_sources":
                    run, errors = import_sources(run.config)
                elif action in ('start_upscale', 'start_detect'):
                    errors = []
                    sources = [s for s in run.data['sources'].values() if s.get('active', True)
                               and (not group or s['group'] == group)]
                    if action == 'start_upscale':
                        sources = [s for s in sources if default_scale(s['original_size']) > s['scale']]
                    with mutex:
                        job.update(total=len(sources), done=0)
                    if sources and action == 'start_upscale' and model_setup:
                        model_setup(run.config)
                    for source in sources:
                        try:
                            if action == 'start_upscale':
                                upscale_source(run, source, default_scale(source['original_size']))
                            else:
                                detect_source(run, source)
                            source.pop('error', None)
                        except Exception as error:
                            source['error'] = str(error)
                            errors.append(f"{source['relative']}: {error}")
                        run.save()
                        with mutex:
                            job['done'] += 1
                else:
                    if action == 'start_tag' and model_setup and any(s.get('active', True) and c['status'] == 'accepted'
                            and (not run.current_tag(s, c) or not asset(directory, c['tag']['image']).is_file())
                            for s in run.data['sources'].values() for c in s['candidates']):
                        model_setup(run.config)
                    errors = run.tag_all() if action == "start_tag" else []
                count = run.export() if action == "export" else None
            with mutex:
                job.update(status="failed" if errors else "complete", errors=errors, count=count)
        except Exception as error:
            with mutex:
                job.update(status="failed", errors=[str(error)])

    def start_job(action, group=None):
        with mutex:
            if directory is None:
                raise ValueError('请先选择并导入数据集')
            if group is not None and not isinstance(group, str):
                raise ValueError('角色范围无效')
            if job["status"] == "running":
                if action == "sync_sources":
                    return
                raise ValueError("已有任务正在运行")
            with run_lock(directory):
                run = Run.load(directory)
                sources = [s for s in run.data["sources"].values() if s.get("active", True)]
                if action in ('start_upscale', 'start_detect'):
                    if run.config.get('crop_mode') == 'prepared':
                        raise ValueError('含 TXT 的数据集按成品导入，无需超分或识别')
                    if not any(not group or s['group'] == group for s in sources):
                        raise ValueError('所选范围没有可用图片')
                if action in ('start_tag', 'export'):
                    if not sources or any(s.get("error") for s in sources):
                        raise ValueError("没有可用图片或图片准备失败，请先完成准备")
                    if any(c["status"] == "pending" for s in sources for c in s["candidates"]):
                        raise ValueError("请先接受或拒绝所有待审裁框")
                    if action == "export" and any(not run.current_tag(s, c)
                                              for s in sources for c in s["candidates"] if c["status"] == "accepted"):
                        raise ValueError("请先完成所有接受样本的打标")
            job.update(id=secrets.token_hex(8), status="running", action=action, errors=[], count=None, total=0, done=0)
        threading.Thread(target=process_job, args=(action, group), daemon=True).start()

    class Handler(BaseHTTPRequestHandler):
        def valid_host(self):
            return self.headers.get("Host") in (f"127.0.0.1:{self.server.server_port}",
                                                f"localhost:{self.server.server_port}")

        def reply(self, status, content, content_type="application/json; charset=utf-8"):
            body = json.dumps(content, ensure_ascii=False).encode() if isinstance(content, (dict, list)) else content
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.valid_host():
                self.reply(403, {"error": "仅允许本地审核地址"})
                return
            route = urlparse(self.path)
            try:
                if route.path == '/api/session':
                    self.reply(200, {'token': token, 'analysisOnly': analysis_only,
                                     'application': 'dataset-review', 'runDir': str(directory) if directory else None,
                                     'manualWorkflow': True, 'startupConfig': template,
                                     'loraOutputDir': str(LORA_OUTPUT_DIR)})
                elif route.path == '/' or route.path.startswith('/assets/'):
                    path = (static / ('index.html' if route.path == '/' else route.path.lstrip('/'))).resolve()
                    if not path.is_relative_to(static.resolve()) or not path.is_file():
                        self.reply(404, {'error': '前端资源不存在，请使用 npm run dev 或先执行 npm run build'})
                        return
                    self.reply(200, path.read_bytes(), mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
                elif route.path == '/api/analysis/status':
                    self.reply(200, analysis.status())
                elif route.path == '/api/analysis/report':
                    self.reply(200, analysis.report())
                elif route.path == '/api/analysis/csv':
                    from .analysis import csv_report
                    self.reply(200, csv_report(analysis.report()).encode('utf-8-sig'), 'text/csv; charset=utf-8')
                elif route.path == '/api/lora/files':
                    requested = parse_qs(route.query).get('directory', [str(LORA_OUTPUT_DIR)])[0]
                    folder = Path(requested).expanduser().resolve()
                    changes = plan_renames(folder)
                    files = sorted(path.name for path in folder.iterdir()
                                   if path.is_file() and path.suffix.lower() == '.safetensors')
                    self.reply(200, {'directory': str(folder), 'files': files,
                                     'changes': changes, 'prompts': generate_lora_tags(folder)})
                elif route.path == '/api/datasets':
                    with mutex:
                        self.reply(200, list_datasets(directory))
                elif directory is None and route.path == '/api/state' and not analysis_only:
                    self.reply(200, {'version': 1, 'config': {**DEFAULTS, **template}, 'sources': {},
                                     'updated_at': 0, 'datasetLoaded': False})
                elif directory is None and route.path == '/api/job' and not analysis_only:
                    self.reply(200, {**job, 'total': 0, 'done': 0})
                elif directory is None:
                    self.reply(404, {'error':'独立分析模式没有审核数据'})
                elif route.path == "/api/state":
                    with mutex:
                        run = Run.load(directory)
                        data = run.data
                        data['datasetLoaded'] = True
                        for source in data["sources"].values():
                            for candidate in source.get("candidates", []):
                                candidate["tag_current"] = run.current_tag(source, candidate) if source.get("prepare_key") else False
                        self.reply(200, data)
                elif route.path == "/api/job":
                    with mutex:
                        data = dict(job)
                    run = Run.load(directory)
                    samples = [(s, c) for s in run.data["sources"].values() if s.get("active", True)
                               for c in s["candidates"] if c["status"] == "accepted"]
                    if data.get('action') not in ('start_upscale', 'start_detect'):
                        data.update(total=len(samples), done=sum(run.current_tag(s, c)
                                    and asset(directory, c["tag"]["image"]).is_file() for s, c in samples))
                    self.reply(200, data)
                elif route.path == "/image":
                    query = parse_qs(route.query)
                    run = Run.load(directory)
                    source = run.locate(query["source"][0])
                    kind = query.get("kind", ["working"])[0]
                    if kind in ("original", "working"):
                        relative = source[kind]
                    else:
                        _, candidate = run.locate(source["id"], query["candidate"][0])
                        relative = candidate["tag"]["image"]
                    path = asset(directory, relative)
                    self.reply(200, path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/png")
                else:
                    self.reply(404, {"error": "未找到页面"})
            except (ValueError, KeyError, OSError) as error:
                self.reply(400, {"error": str(error)})

        def do_POST(self):
            nonlocal directory
            # A local website cannot trigger edits, model calls or arbitrary file writes.
            if not self.valid_host() or self.headers.get("X-Review-Token") != token:
                self.reply(403, {"error": "审核会话无效，请刷新页面"})
                return
            if self.path not in ("/api/edit", '/api/analysis/start', '/api/analysis/cancel', '/api/lora/rename',
                                 '/api/datasets/import', '/api/datasets/open'):
                self.reply(404, {"error": "接口不存在"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024 * 1024:
                    raise ValueError("请求大小无效")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data,dict):
                    raise ValueError('请求必须为对象')
                if self.path == '/api/analysis/start':
                    self.reply(202, analysis.start(data))
                    return
                if self.path == '/api/analysis/cancel':
                    self.reply(200, analysis.cancel())
                    return
                if self.path == '/api/lora/rename':
                    requested = data.get('directory')
                    expected = data.get('changes')
                    if not isinstance(requested, str) or not requested.strip():
                        raise ValueError('请选择 LoRA 目录')
                    if not isinstance(expected, list):
                        raise ValueError('请先刷新重命名预览')
                    with mutex:
                        changed = rename_files(requested, expected)
                    self.reply(200, {'ok': True, 'renamed': len(changed)})
                    return
                if self.path in ('/api/datasets/import', '/api/datasets/open'):
                    if analysis_only:
                        raise ValueError('请在审核模式接入数据集')
                    with mutex:
                        if job['status'] == 'running':
                            raise ValueError('任务正在运行，完成后可切换数据集')
                        if self.path == '/api/datasets/import':
                            config = import_config(data, template)
                            selected = Path(config['run_dir'])
                            with run_lock(selected):
                                if not (selected / 'manifest.json').is_file():
                                    Run(selected, {'version': 1, 'config': config, 'sources': {}}).save()
                                imported = Run.load(selected)
                                imported.config.update(crop_mode=config['crop_mode'], import_captions=config['import_captions'])
                                imported.ensure_tag_files()
                                imported.save()
                        else:
                            requested = data.get('runDir')
                            known = {item['runDir'] for item in list_datasets(directory)['datasets']}
                            if requested not in known:
                                raise ValueError('数据集不存在，请刷新列表')
                            selected = Path(requested)
                            with run_lock(selected):
                                Run.load(selected).ensure_tag_files()
                        directory = selected
                        job.update(id=None, status='idle', action=None, errors=[], count=None)
                        start_job('sync_sources')
                    self.reply(202, {'ok': True, 'runDir': str(directory)})
                    return
                if directory is None:
                    raise ValueError('独立分析模式没有审核数据')
                if data.get("action") == "open_workdir":
                    os.startfile(directory)
                    self.reply(200, {"ok": True, "result": {}})
                    return
                if data.get("action") in ("start_tag", "export", "sync_sources", 'start_upscale', 'start_detect'):
                    start_job(data["action"], data.get('group'))
                    self.reply(202, {"ok": True, "result": {}})
                    return
                with mutex, run_lock(directory):
                    if job["status"] == "running":
                        raise ValueError("任务正在运行，完成后可继续编辑")
                    run = Run.load(directory)
                    action = data["action"]
                    if action == "crop":
                        result = run.change_crop(data["source"], data.get("candidate"), data.get("box"), data.get("status"))
                    elif action == "scale":
                        if run.config.get('crop_mode') == 'prepared':
                            raise ValueError('成品数据集保留导入尺寸')
                        if data['scale'] != 1 and model_setup:
                            model_setup(run.config)
                        source = run.locate(data['source'])
                        upscale_source(run, source, data['scale'])
                        source['scale_override'] = data['scale']
                        run.save()
                        result = {}
                    elif action == "person":
                        run.select_person(data["source"], data["index"])
                        result = {}
                    elif action == "accept_source":
                        source = run.locate(data["source"])
                        for candidate in source["candidates"]:
                            if candidate["status"] == "pending":
                                run.change_crop(source["id"], candidate["id"], status="accepted")
                        result = {}
                    elif action in ("tags", "preview_tags"):
                        result = run.edit_tags(data["selections"], data["operation"], preview=action == "preview_tags")
                    elif action == "drop_tags":
                        tags = data["tags"]
                        if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
                            raise ValueError("清理标签必须是列表")
                        run.data["drop_tags_override"] = tags
                        run.save()
                        result = {}
                    else:
                        raise ValueError("未知操作")
                self.reply(200, {"ok": True, "result": result})
            except Exception as error:
                self.reply(400, {"error": str(error)})

    class ReviewServer(ThreadingHTTPServer):
        def server_close(self):
            analysis.close()
            super().server_close()
    return ReviewServer(("127.0.0.1", port), Handler)


def serve(directory, port=8765, open_browser=True, frontend_port=5173, config=None, model_setup=None):
    from .frontend import start_frontend, stop_frontend
    server = make_server(directory, port, config, model_setup)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    frontend = None
    try:
        frontend = start_frontend(server.server_port, frontend_port, open_browser)
        while thread.is_alive():
            if frontend is not None and frontend.poll() is not None:
                raise ValueError(f'前端开发服务已退出，退出码：{frontend.returncode}')
            thread.join(timeout=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        stop_frontend(frontend)
        server.shutdown()
        server.server_close()
        thread.join()

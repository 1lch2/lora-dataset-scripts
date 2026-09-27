import json
import mimetypes
import os
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .core import Run, asset, run_lock
from .analysis_job import AnalysisJob


def make_server(directory=None, port=8765):
    directory = Path(directory).resolve() if directory is not None else None
    if directory is not None:
        with run_lock(directory):
            Run.load(directory).ensure_tag_files()
    cache = (directory.parent if directory else Path(__file__).resolve().parent.parent/'runs')/'.models'
    analysis = AnalysisJob(cache if cache.is_dir() else None)
    token = secrets.token_urlsafe(24)
    mutex = threading.Lock()
    static = Path(__file__).parent / "static"
    job = {"id": None, "status": "idle", "action": None, "errors": []}

    def process_job(action):
        try:
            with run_lock(directory):
                run = Run.load(directory)
                errors = run.tag_all() if action == "start_tag" else []
                count = run.export() if action == "export" else None
            with mutex:
                job.update(status="failed" if errors else "complete", errors=errors, count=count)
        except Exception as error:
            with mutex:
                job.update(status="failed", errors=[str(error)])

    def start_job(action):
        with mutex, run_lock(directory):
            if job["status"] == "running":
                raise ValueError("已有任务正在运行")
            run = Run.load(directory)
            sources = [s for s in run.data["sources"].values() if s.get("active", True)]
            if not sources or any(s.get("error") for s in sources):
                raise ValueError("没有可用图片或图片准备失败，请先完成准备")
            if any(c["status"] == "pending" for s in sources for c in s["candidates"]):
                raise ValueError("请先接受或拒绝所有待审裁框")
            if action == "export" and any(not run.current_tag(s, c)
                                          for s in sources for c in s["candidates"] if c["status"] == "accepted"):
                raise ValueError("请先完成所有接受样本的打标")
            job.update(id=secrets.token_hex(8), status="running", action=action, errors=[], count=None)
        threading.Thread(target=process_job, args=(action,), daemon=True).start()

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
                if route.path == "/":
                    html = (static / "index.html").read_text(encoding="utf-8").replace("__TOKEN__", token)
                    html = html.replace('__ANALYSIS_ONLY__', 'true' if directory is None else 'false')
                    self.reply(200, html.encode(), "text/html; charset=utf-8")
                elif route.path in ("/app.js", "/analysis.js", "/style.css"):
                    path = static / route.path[1:]
                    self.reply(200, path.read_bytes(), "application/javascript" if path.suffix == ".js" else "text/css")
                elif route.path == '/api/analysis/status':
                    self.reply(200, analysis.status())
                elif route.path == '/api/analysis/report':
                    self.reply(200, analysis.report())
                elif route.path == '/api/analysis/csv':
                    from .analysis import csv_report
                    self.reply(200, csv_report(analysis.report()).encode('utf-8-sig'), 'text/csv; charset=utf-8')
                elif directory is None:
                    self.reply(404, {'error':'独立分析模式没有审核数据'})
                elif route.path == "/api/state":
                    with mutex:
                        run = Run.load(directory)
                        data = run.data
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
            # A local website cannot trigger edits, model calls or arbitrary file writes.
            if not self.valid_host() or self.headers.get("X-Review-Token") != token:
                self.reply(403, {"error": "审核会话无效，请刷新页面"})
                return
            if self.path not in ("/api/edit", '/api/analysis/start', '/api/analysis/cancel'):
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
                if directory is None:
                    raise ValueError('独立分析模式没有审核数据')
                if data.get("action") == "open_workdir":
                    os.startfile(directory)
                    self.reply(200, {"ok": True, "result": {}})
                    return
                if data.get("action") in ("start_tag", "export"):
                    start_job(data["action"])
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
                        run.prepare_source(run.locate(data["source"]), data["scale"])
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


def serve(directory, port=8765, open_browser=True):
    server = make_server(directory, port)
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"审核页: {url}  (Ctrl+C 停止)")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

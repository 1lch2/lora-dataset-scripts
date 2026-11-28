import io
import json
import mimetypes
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from core.dataset_pipeline.core import DEFAULTS, Run, asset, run_lock
from core.dataset_pipeline.costume_audit import prepare_costume_reference, validate_costume_description
from core.dataset_pipeline.datasets import delete_dataset, detect_source, import_config, import_sources, list_datasets, replace_source_image, upscale_source
from core.dataset_pipeline.forge import ForgeClient
from core.dataset_pipeline.geometry import default_scale
from core.dataset_pipeline.feature_audit import edit_feature
from core.dataset_pipeline.tag_audit import (AuditRetry, audit_run, audit_view, check_costume_conflict, clear_audit_results,
                                             clear_previous_audit_failures,
                                             describe_costume, edit_audit, eligible_samples, image_part,
                                             migrate_feature_run, prepare_feature_check, retry_result, retry_sample_indices,
                                             validate_options as validate_audit_options)
from core.dataset_pipeline.tagging import apply_filters, restore_captions, tag_run, validate_options
from tools.analysis.job import AnalysisJob
from tools.dataset import DatasetToolsJob, ordinary_path, scan_files
from tools.denoise import decode_upload, denoise_image, open_image, png_bytes, validate_options as validate_denoise_options
from tools.lora.prompts import generate_lora_tags
from tools.lora.rename import DIR as LORA_OUTPUT_DIR, plan_renames, rename_files
from tools.scunet import batch_directories, batch_images, check_model, save_batch_image, scunet_image

from .settings import RUNTIME_KEYS, save_settings, settings_info


def make_server(directory=None, port=8765, config=None, model_setup=None, settings_path=None):
    directory = Path(directory).resolve() if directory is not None else None
    if directory is not None:
        with run_lock(directory):
            Run.load(directory).ensure_tag_files()
    cache = (directory.parent if directory else Path(__file__).resolve().parents[1]/'runs')/'.models'
    analysis = AnalysisJob(cache if cache.is_dir() else None)
    dataset_tools = DatasetToolsJob()
    token = secrets.token_urlsafe(24)
    mutex = threading.RLock()
    static = Path(__file__).resolve().parents[1] / 'app' / 'dist'
    job = {"id": None, "status": "idle", "action": None, "errors": [], "total": 0, "done": 0}
    template = dict(config if config is not None else Run.load(directory).config if directory else {})
    analysis_only = directory is None and config is None
    denoise = {'status': 'idle', 'stage': '', 'errors': [], 'models': [], 'result': None}
    denoise_images = {}
    scunet = {'status': 'idle', 'stage': '', 'errors': [], 'result': None, 'output': None,
              'done': 0, 'total': 0, 'saved': 0}
    scunet_images = {}

    def denoise_status():
        return {**denoise, 'defaultModel': template.get('upscaler_1', DEFAULTS['upscaler_1'])}

    def process_denoise(action, selected, options, raw, name):
        try:
            if action == 'denoise':
                with mutex:
                    denoise['stage'] = 'decode'
                rgb, alpha, icc = open_image(raw)
                with mutex:
                    denoise['stage'] = 'connect'
            if model_setup:
                model_setup(selected)
            client = ForgeClient(selected)
            if action == 'denoise_models':
                models = client.upscalers()
                with mutex:
                    denoise['models'] = [{'name': item['name'], 'scale': item.get('scale')}
                                         for item in models if item['name'] != 'None']
            else:
                def progress(stage):
                    with mutex:
                        denoise['stage'] = stage
                output = denoise_image(rgb, alpha, icc, client, options, progress)
                original = png_bytes(rgb, alpha, icc)
                with mutex:
                    denoise_images.update(original=original, output=output)
                    denoise['result'] = {'id': job['id'], 'width': rgb.width, 'height': rgb.height,
                                         'name': name + '_denoised.png'}
            with mutex:
                denoise.update(status='complete', stage='complete')
                job.update(status='complete', done=1)
        except Exception as error:
            with mutex:
                denoise.update(status='failed', errors=[str(error)])
                job.update(status='failed', errors=[str(error)])

    def start_denoise(action, data):
        if analysis_only:
            raise ValueError('请使用 start-webui.bat 打开去除 GPT 水印')
        options, raw, name = None, None, None
        if action == 'denoise':
            options = validate_denoise_options(data)
            raw = decode_upload(data.get('image'))
            name = data.get('name', 'image')
            if not isinstance(name, str) or not name or len(name) > 255:
                raise ValueError('图片名称无效')
            name = Path(name).stem
        with mutex:
            if job['status'] == 'running':
                raise ValueError('已有任务正在运行，请等待完成')
            selected = {**DEFAULTS, **template}
            job.update(id=secrets.token_hex(8), status='running', action=action,
                       errors=[], total=1, done=0, count=None)
            denoise.update(id=job['id'], status='running', stage='connect', errors=[])
            if action == 'denoise':
                denoise['result'] = None
                denoise_images.clear()
            threading.Thread(target=process_denoise, args=(action, selected, options, raw, name), daemon=True).start()
            return {**denoise_status(), 'id': job['id']}

    def process_scunet(selected, upload, directories):
        try:
            if directories:
                source, output, recursive = directories
                paths = batch_images(source, recursive)
                with mutex:
                    scunet.update(total=len(paths), stage='connect')
                    job['total'] = len(paths)
            if model_setup:
                model_setup(selected)
            client = ForgeClient(selected)
            check_model(client)
            with mutex:
                scunet['stage'] = 'process'
            if directories:
                for relative in paths:
                    failure = None
                    try:
                        path = source / relative
                        ordinary_path(path)
                        _, _, _, result = scunet_image(path, client)
                        save_batch_image(output, relative, result)
                    except (OSError, ValueError) as error:
                        failure = f'{relative.as_posix()}：{error}'
                    with mutex:
                        if failure:
                            scunet['errors'].append(failure)
                        else:
                            scunet['saved'] += 1
                        scunet['done'] += 1
                        job['done'] = scunet['done']
            else:
                raw, name = upload
                rgb, alpha, icc, result = scunet_image(io.BytesIO(raw), client)
                original = png_bytes(rgb, alpha, icc)
                with mutex:
                    scunet_images.update(original=original, output=result)
                    scunet.update(done=1, result={'id': job['id'], 'width': rgb.width, 'height': rgb.height,
                                                  'name': name + '_denoised.png'})
                    job['done'] = 1
        except Exception as error:
            with mutex:
                scunet['errors'].append(str(error))
        finally:
            with mutex:
                status = 'failed' if scunet['errors'] else 'complete'
                scunet.update(status=status, stage='')
                job.update(status=status, errors=scunet['errors'])

    def start_scunet(data):
        if analysis_only:
            raise ValueError('请使用 start-webui.bat 打开图像降噪')
        upload, directories = None, None
        if data.get('mode') == 'batch':
            directories = batch_directories(data)
        elif data.get('mode') == 'single':
            name = data.get('name')
            if not isinstance(name, str) or not name or len(name) > 255:
                raise ValueError('图片名称无效')
            upload = decode_upload(data.get('image')), Path(name).stem
        else:
            raise ValueError('请选择单图或文件夹批量模式')
        with mutex:
            if job['status'] == 'running':
                raise ValueError('已有任务正在运行，请等待完成')
            selected = {**DEFAULTS, **template}
            total = 0 if directories else 1
            job.update(id=secrets.token_hex(8), status='running', action='scunet',
                       errors=[], total=total, done=0, count=None)
            scunet.update(id=job['id'], status='running', stage='scan' if directories else 'connect',
                          errors=[], done=0, total=total, saved=0, result=None,
                          output=str(directories[1]) if directories else None)
            scunet_images.clear()
            threading.Thread(target=process_scunet, args=(selected, upload, directories), daemon=True).start()
            return {**scunet, 'errors': []}

    def load_run(folder):
        overrides = {key: template[key] for key in RUNTIME_KEYS} if settings_path else None
        return Run.load(folder, config_overrides=overrides)

    def process_job(action, group=None, source_id=None, tagging=None, audit=None, audit_features=(), audit_retry=None,
                    costume_reference=None):
        try:
            with run_lock(directory):
                run = load_run(directory)
                if action == "sync_sources":
                    run, errors = import_sources(run.config)
                elif action in ('start_upscale', 'start_detect'):
                    errors = []
                    sources = ([run.locate(source_id)] if source_id is not None else
                               [s for s in run.data['sources'].values() if s.get('active', True)
                                and (not group or s['group'] == group)])
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
                elif action == 'start_audit':
                    features = audit_features or (None,)
                    offset = 0
                    remaining = len(features)

                    def audit_progress(done, total):
                        with mutex:
                            job.update(done=offset + done, total=offset + remaining * total)

                    def report_failure():
                        with mutex:
                            job['failedCount'] += 1

                    for feature in features:
                        with mutex:
                            job['auditFeature'] = feature
                        audit_run(run, audit, audit_progress, feature['id'] if feature else None, report_failure,
                                  retry=audit_retry, costume_reference=costume_reference)
                        with mutex:
                            offset = job['done']
                        remaining -= 1
                    # 样本失败已写入检查记录，任务错误只用于整轮检查异常中断。
                    errors = []
                elif action == 'start_tag' and tagging is not None:
                    if model_setup:
                        model_setup(run.config)
                    def progress(done, total):
                        with mutex:
                            job.update(done=done, total=total)
                    errors = tag_run(run, tagging, progress)
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

    def start_job(action, group=None, source_id=None, tagging=None, replace_confirmed=False, audit=None,
                  feature_id=None, audit_retry=None, costume_selection=None, costume_description=None, feature_ids=None):
        costume = action == 'start_costume_audit'
        if costume:
            action = 'start_audit'
        with mutex:
            if directory is None:
                raise ValueError('请先选择并导入数据集')
            if group is not None and not isinstance(group, str):
                raise ValueError('角色范围无效')
            if source_id is not None and (action != 'start_detect' or not isinstance(source_id, str) or not source_id):
                raise ValueError('单图识别参数无效')
            if job["status"] == "running":
                if action == "sync_sources":
                    return
                raise ValueError("已有任务正在运行")
            with run_lock(directory):
                run = load_run(directory)
                audit_features, costume_reference, audit_total = [], None, 0
                if action == 'start_audit':
                    if feature_ids is not None:
                        if (feature_id is not None or not isinstance(feature_ids, list) or not feature_ids
                                or any(not isinstance(key, str) or not key for key in feature_ids)):
                            raise ValueError('请选择有效的特征')
                        selected_ids = list(dict.fromkeys(feature_ids))
                    else:
                        selected_ids = [] if feature_id is None else [feature_id]
                    if (audit_retry and selected_ids) or (costume and (audit_retry or selected_ids)):
                        raise ValueError('检查重试参数无效')
                    if (selected_ids or audit_retry or costume) and isinstance(audit, dict):
                        audit = {**audit, 'visual': True}
                    audit = validate_audit_options(audit)
                    indices = None
                    if audit_retry:
                        saved = migrate_feature_run(run.data.get('tag_audit', {}))
                        result = retry_result(run, saved, audit_retry)
                        indices = retry_sample_indices(result, audit_retry)
                        if audit_retry.category == 'feature':
                            audit_features = [{key: result['feature'][key] for key in ('id', 'name')}]
                    audit_total = len(eligible_samples(run, indices)) * max(1, len(selected_ids))
                    if not audit_total:
                        raise ValueError('没有符合条件的重试样本' if audit_retry else '没有可检查的有效标签')
                    for selected_id in selected_ids:
                        feature = prepare_feature_check(run, selected_id, audit)
                        audit_features.append({key: feature[key] for key in ('id', 'name')})
                    if costume:
                        check_costume_conflict(audit)
                        costume_reference = prepare_costume_reference(run, costume_selection)
                        costume_reference['description'] = validate_costume_description(costume_description)
                    if not audit_retry:
                        category = 'costume' if costume else 'feature' if audit_features else 'anomaly'
                        # 返回任务已开始前清除上一轮失败，避免后台准备图片时页面读到旧记录。
                        first_feature = audit_features[0]['id'] if audit_features else None
                        clear_previous_audit_failures(run, category, first_feature)
                sources = ([run.locate(source_id)] if source_id is not None else
                           [s for s in run.data["sources"].values() if s.get("active", True)
                            and (action not in ('start_upscale', 'start_detect') or not group or s['group'] == group)])
                if action in ('start_upscale', 'start_detect'):
                    if run.config.get('crop_mode') == 'prepared' and not (source_id and sources[0].get('manual_processing')):
                        raise ValueError('完整打标数据集保留导入尺寸，无需超分或识别')
                    if not sources:
                        raise ValueError('所选范围没有可用图片')
                if action in ('start_tag', 'export'):
                    if action == 'start_tag' and tagging is not None:
                        tagging = validate_options(tagging)
                        if any(c.get('tag') for s in sources for c in s['candidates'] if c['status'] == 'accepted') and replace_confirmed is not True:
                            raise ValueError('请确认替换工作目录中的已有标签，包括已应用的核心特征补标')
                    if not sources or any(s.get("error") for s in sources):
                        raise ValueError("没有可用图片或图片准备失败，请先完成准备")
                    if any(c["status"] == "pending" for s in sources for c in s["candidates"]):
                        raise ValueError("请先接受或删除所有待审裁框")
                    if action == "export" and any(not run.current_tag(s, c)
                                              for s in sources for c in s["candidates"] if c["status"] == "accepted"):
                        raise ValueError("请先完成所有接受样本的打标")
            job.update(id=secrets.token_hex(8), status="running", action=action, errors=[], count=None,
                       total=audit_total, done=0, explicitTagging=tagging is not None,
                       auditFeature=audit_features[0] if audit_features else None,
                       auditCostume=costume or bool(audit_retry and audit_retry.category == 'costume'), failedCount=0)
        threading.Thread(target=process_job,
                         args=(action, group, source_id, tagging, audit, audit_features, audit_retry, costume_reference),
                         daemon=True).start()

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
                if route.path == '/api/settings':
                    if settings_path is None:
                        raise ValueError('当前入口不支持网页设置，请使用 start-webui.bat')
                    with mutex:
                        self.reply(200, settings_info(template))
                elif route.path == '/api/session':
                    self.reply(200, {'token': token, 'analysisOnly': analysis_only,
                                     'application': 'dataset-review', 'runDir': str(directory) if directory else None,
                                     'manualWorkflow': True, 'startupConfig': template, 'settingsEnabled': settings_path is not None,
                                     'settingsPath': str(Path(settings_path).resolve()) if settings_path else None,
                                     'loraOutputDir': str(LORA_OUTPUT_DIR)})
                elif route.path == '/api/denoise/status':
                    with mutex:
                        self.reply(200, denoise_status())
                elif route.path == '/api/scunet/status':
                    with mutex:
                        self.reply(200, scunet)
                elif route.path in ('/api/denoise/image', '/api/scunet/image'):
                    query = parse_qs(route.query)
                    state, images = (scunet, scunet_images) if route.path.startswith('/api/scunet/') else (denoise, denoise_images)
                    with mutex:
                        result = state['result']
                        kind = query.get('kind', ['output'])[0]
                        if (not result or query.get('id', [''])[0] != result['id']
                                or kind not in ('original', 'output')):
                            raise ValueError('降噪结果已过期，请重新处理')
                        content = images[kind]
                    self.reply(200, content, 'image/png')
                elif route.path == '/' or route.path.startswith('/assets/'):
                    path = (static / ('index.html' if route.path == '/' else route.path.lstrip('/'))).resolve()
                    if not path.is_relative_to(static.resolve()) or not path.is_file():
                        self.reply(404, {'error': '前端资源不存在，请使用 npm run dev 或先执行 npm run build'})
                        return
                    self.reply(200, path.read_bytes(), mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
                elif route.path == '/api/tools/status':
                    self.reply(200, dataset_tools.status())
                elif route.path == '/api/analysis/status':
                    self.reply(200, analysis.status())
                elif route.path == '/api/analysis/report':
                    self.reply(200, analysis.report())
                elif route.path == '/api/analysis/csv':
                    from tools.analysis.analysis import csv_report
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
                    with mutex:
                        self.reply(200, dict(job))
                elif directory is None:
                    self.reply(404, {'error':'独立分析模式没有审核数据'})
                elif route.path == "/api/state":
                    with mutex:
                        run = load_run(directory)
                        data = run.data
                        if 'tag_audit' in data:
                            data['tag_audit'] = audit_view(run)
                        data['datasetLoaded'] = True
                        for source in data["sources"].values():
                            source['candidates'] = [c for c in source.get('candidates', []) if c['status'] != 'rejected']
                            for candidate in source.get("candidates", []):
                                candidate["tag_current"] = run.current_tag(source, candidate) if source.get("prepare_key") else False
                        self.reply(200, data)
                elif route.path == "/api/job":
                    with mutex:
                        data = dict(job)
                    if data.get('action') not in ('start_upscale', 'start_detect', 'start_audit', 'denoise', 'denoise_models', 'scunet') and not data.get('explicitTagging'):
                        run = load_run(directory)
                        samples = [(s, c) for s in run.data["sources"].values() if s.get("active", True)
                                   for c in s["candidates"] if c["status"] == "accepted"]
                        data.update(total=len(samples), done=sum(run.current_tag(s, c)
                                    and asset(directory, c["tag"]["image"]).is_file() for s, c in samples))
                    self.reply(200, data)
                elif route.path == "/image":
                    query = parse_qs(route.query)
                    run = load_run(directory)
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
            if self.path not in ("/api/settings", "/api/edit", '/api/analysis/start', '/api/analysis/cancel', '/api/lora/rename',
                                 '/api/datasets/import', '/api/datasets/open', '/api/datasets/delete',
                                 '/api/denoise/start', '/api/denoise/models', '/api/tag-audit/feature',
                                 '/api/scunet/start',
                                 '/api/forge/unload-checkpoint',
                                 '/api/tools/scan', '/api/tools/preview', '/api/tools/execute', '/api/tools/cancel'):
                self.reply(404, {"error": "接口不存在"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                limit = 28 * 1024 * 1024 if self.path in ('/api/denoise/start', '/api/scunet/start') else 1024 * 1024
                if not 0 < length <= limit:
                    raise ValueError("请求大小无效")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data,dict):
                    raise ValueError('请求必须为对象')
                if self.path in ('/api/denoise/start', '/api/denoise/models'):
                    action = 'denoise' if self.path.endswith('/start') else 'denoise_models'
                    self.reply(202, start_denoise(action, data))
                    return
                if self.path == '/api/scunet/start':
                    self.reply(202, start_scunet(data))
                    return
                if self.path == '/api/forge/unload-checkpoint':
                    with mutex:
                        if analysis_only:
                            raise ValueError('请从标签检查设置卸载 Forge 模型')
                        if job['status'] == 'running':
                            raise ValueError('已有任务正在运行，请等待完成后再卸载 Forge 模型')
                        ForgeClient({**DEFAULTS, **template}).unload_checkpoint()
                    self.reply(200, {'ok': True})
                    return
                if self.path == '/api/tag-audit/feature':
                    action = data.get('action')
                    if action not in ('save_feature', 'delete_feature'):
                        raise ValueError('未知特征操作')
                    with mutex:
                        requested = data.get('runDir')
                        if directory is None or not isinstance(requested, str) or Path(requested).resolve() != directory:
                            raise ValueError('当前数据集已变化，请刷新后重试')
                        if job['status'] == 'running':
                            raise ValueError('任务正在运行，完成后可编辑特征')
                        with run_lock(directory):
                            result = edit_feature(load_run(directory), data)
                    self.reply(200, {'ok': True, 'result': result})
                    return
                if self.path == '/api/settings':
                    if settings_path is None:
                        raise ValueError('当前入口不支持网页设置')
                    with mutex:
                        if job['status'] == 'running':
                            raise ValueError('任务正在运行，完成后可保存设置')
                        updated = save_settings(data, template, settings_path)
                        template.update(updated)
                        self.reply(200, settings_info(template))
                    return
                if self.path.startswith('/api/tools/'):

                    actions = {'scan': scan_files, 'preview': dataset_tools.preview,
                               'execute': dataset_tools.execute, 'cancel': lambda _: dataset_tools.cancel()}
                    with mutex:
                        self.reply(200, actions[self.path.rsplit('/', 1)[1]](data))
                    return
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
                if self.path == '/api/datasets/delete':
                    if analysis_only:
                        raise ValueError('请在审核模式管理数据集')
                    with mutex:
                        if dataset_tools.status()['status'] in ('preparing', 'running'):
                            raise ValueError('数据集工具任务正在运行，完成后可删除数据集')
                        if job['status'] == 'running':
                            raise ValueError('任务正在运行，完成后可删除数据集')
                        requested = data.get('runDir')
                        delete_dataset(requested, directory)
                        cleared = directory is not None and directory.resolve() == Path(requested).resolve()
                        if cleared:
                            directory = None
                            job.update(id=None, status='idle', action=None, errors=[], count=None)
                    self.reply(200, {'ok': True, 'currentDeleted': cleared})
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
                                imported = load_run(selected)
                                imported.config.update(crop_mode=config['crop_mode'], import_captions=config['import_captions'],
                                                       recursive=config['recursive'])
                                imported.ensure_tag_files()
                                imported.save()
                        else:
                            requested = data.get('runDir')
                            known = {item['runDir'] for item in list_datasets(directory)['datasets']}
                            if requested not in known:
                                raise ValueError('数据集不存在，请刷新列表')
                            selected = Path(requested)
                            with run_lock(selected):
                                load_run(selected).ensure_tag_files()
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
                action = data.get('action')
                if action == 'describe_costume':
                    options = data.get('audit')
                    options = validate_audit_options({**options, 'visual': True} if isinstance(options, dict) else options)
                    with mutex:
                        requested = data.get('runDir')
                        if directory is None or not isinstance(requested, str) or Path(requested).resolve() != directory:
                            raise ValueError('当前数据集已变化，请刷新后重试')
                        if job['status'] == 'running':
                            raise ValueError('任务正在运行，完成后可生成服装描述')
                        run = load_run(directory)
                        reference = prepare_costume_reference(run, data.get('costumeReference'))
                        _, candidate = run.locate(reference['source'], reference['candidate'])
                        reference_image = image_part(asset(run.directory, candidate['tag']['image']))
                    description = describe_costume(reference_image, options)
                    self.reply(200, {'ok': True, 'result': {'description': description}})
                    return
                if action in ('start_tag', 'export', 'sync_sources', 'start_upscale', 'start_detect',
                              'start_audit', 'retry_audit_failed', 'retry_audit_samples', 'start_costume_audit'):
                    retry = None
                    feature_id = data.get('featureId')
                    if action == 'retry_audit_samples':
                        retry_status = data.get('retryStatus')
                        retry_category = data.get('retryCategory', 'anomaly')
                        if (retry_category not in ('anomaly', 'feature', 'costume')
                                or retry_status not in ('failed', 'uncertain')
                                or (retry_category != 'anomaly' and retry_status != 'failed')):
                            raise ValueError('检查重试状态无效')
                        target = data.get('retrySample')
                        if target is not None:
                            if not isinstance(target, dict) or any(
                                    not isinstance(target.get(key), str) or not target[key]
                                    for key in ('source', 'candidate')):
                                raise ValueError('要重试的样本无效')
                            target = (target['source'], target['candidate'])
                        round_id = data.get('auditRunId')
                        if retry_category != 'anomaly' and (not isinstance(round_id, str) or not round_id):
                            raise ValueError('请提供要重试的检查轮次')
                        if retry_category == 'feature':
                            if not isinstance(feature_id, str) or not feature_id:
                                raise ValueError('请选择要重试的特征')
                            retry = AuditRetry(retry_status, target, retry_category, feature_id, round_id)
                            feature_id = None
                        else:
                            retry = AuditRetry(retry_status, target, retry_category, round_id=round_id)
                    elif action == 'retry_audit_failed':
                        retry = AuditRetry('failed')
                    elif action in ('start_audit', 'start_costume_audit'):
                        retry_failed = data.get('retryFailed', False)
                        if type(retry_failed) is not bool:
                            raise ValueError('失败重试参数无效')
                        if retry_failed:
                            retry = AuditRetry('failed')
                    if action in ('retry_audit_failed', 'retry_audit_samples'):
                        action = 'start_audit'
                    start_job(action, data.get('group'), data.get('source'),
                              data.get('tagging'), data.get('replaceConfirmed', False), data.get('audit'),
                              feature_id, audit_retry=retry, costume_selection=data.get('costumeReference'),
                              costume_description=data.get('costumeDescription'), feature_ids=data.get('featureIds'))
                    self.reply(202, {"ok": True, "result": {}})
                    return
                with mutex, run_lock(directory):
                    if job["status"] == "running":
                        raise ValueError("任务正在运行，完成后可继续编辑")
                    run = load_run(directory)
                    action = data["action"]
                    if action in ('apply_audit', 'ignore_audit', 'undo_audit'):
                        result = edit_audit(run, data)
                    elif action == 'clear_audit_results':
                        requested = data.get('runDir')
                        if not isinstance(requested, str) or Path(requested).resolve() != run.directory:
                            raise ValueError('当前数据集已变化，请刷新后重试')
                        result = clear_audit_results(run, data.get('status'), data.get('category'),
                                                     data.get('auditRunId'))
                    elif action == 'filter_tagging':
                        result = apply_filters(run, data)
                    elif action == 'restore_captions':
                        if data.get('replaceConfirmed') is not True:
                            raise ValueError('请确认重新导入源 TXT 并替换工作标签')
                        result = restore_captions(run)
                    elif action == "crop":
                        result = run.change_crop(data["source"], data.get("candidate"), data.get("box"), data.get("status"))
                    elif action == 'delete_crop':
                        run.delete_crop(data['source'], data.get('candidate'))
                        result = {}
                    elif action in ('crop_subject', 'restore_original'):
                        replace_source_image(run, run.locate(data['source']), data.get('box'), action == 'restore_original')
                        result = {}
                    elif action == "scale":
                        source = run.locate(data['source'])
                        if run.config.get('crop_mode') == 'prepared' and not source.get('manual_processing'):
                            raise ValueError('成品数据集保留导入尺寸')
                        if data['scale'] != 1 and model_setup:
                            model_setup(run.config)
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


def serve(directory, port=8765, open_browser=True, frontend_port=5173, config=None, model_setup=None, settings_path=None):
    from .frontend import start_frontend, stop_frontend
    server = make_server(directory, port, config, model_setup, settings_path)
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

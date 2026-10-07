"""Local dataset discovery and isolated import configurations."""
import copy
import json
import re
import shutil
import time
from pathlib import Path

from PIL import Image, ImageOps

from .core import DEFAULTS, EXTENSIONS, Run, asset, digest, file_digest, inside, normalize, validate_config
from .geometry import area, iou, validate_box

ROOT = Path(__file__).resolve().parents[2]


def list_datasets(current=None):
    directories = set((ROOT / 'runs').glob('*/manifest.json'))
    if current is not None:
        directories.add(Path(current) / 'manifest.json')
    datasets = []
    for manifest in sorted(directories):
        try:
            data = json.loads(manifest.read_text(encoding='utf-8'))
            if data.get('version') != 1:
                continue
            run = Run(manifest.parent, data)
        except (OSError, ValueError, KeyError):
            continue
        datasets.append({'runDir': str(run.directory), 'inputDir': run.config['input_dir'],
                         'name': run.config['identity'] or Path(run.config['input_dir']).name,
                         'cropMode': run.config.get('crop_mode', 'auto')})
    return {'datasets': datasets, 'currentRunDir': str(current) if current else None,
            'defaultInputDir': str(ROOT / 'dataset-raw')}


def import_config(values, template):
    requested = values.get('directory')
    identity = values.get('identity', '')
    if not isinstance(requested, str) or not requested.strip():
        raise ValueError('请输入数据集目录')
    if not isinstance(identity, str):
        raise ValueError('角色名称无效')
    folder = Path(requested).expanduser().resolve()
    if not folder.is_dir():
        raise ValueError(f'数据集目录不存在：{folder}')
    files = [p for p in folder.rglob('*') if p.is_file() and p.suffix.lower() in EXTENSIONS]
    if not files:
        raise ValueError('目录内没有支持的图片')
    mode = 'prepared' if any(p.is_file() and p.suffix.lower() == '.txt' for p in folder.rglob('*')) else 'manual'
    identity = identity.strip()
    if not identity and any(p.parent == folder for p in files):
        identity = folder.name
    name = re.sub(r'[^\w-]+', '-', folder.name).strip('-')[:40] or 'dataset'
    key = digest([str(folder), identity, mode])[:12]
    config = {**DEFAULTS, **template, 'input_dir': str(folder), 'identity': identity,
              'crop_mode': mode, 'import_captions': mode == 'prepared',
              'run_dir': str(ROOT / 'runs' / f'{name}-{key}'),
              'output_dir': str(ROOT / 'dataset-ready' / f'{name}-{key}')}
    validate_config(config)
    return config


def import_sources(config):
    """仅登记文件并复制原始素材，不调用超分、检测或打标模型。"""
    directory = Path(config['run_dir'])
    folder = Path(config['input_dir'])
    if not folder.is_dir():
        raise ValueError(f'数据集目录不存在：{folder}')
    if (directory / 'manifest.json').is_file():
        run = Run.load(directory)
        if any(run.config[key] != config[key] for key in ('input_dir', 'output_dir')):
            raise ValueError('现有运行不能更改输入或输出目录')
        run.data['config'] = run.config = config
    else:
        run = Run(directory, {'version': 1, 'config': config, 'sources': {}})
    for source in run.data['sources'].values():
        source['active'] = False
    failures = []
    files = sorted(p for p in folder.rglob('*') if p.is_file() and p.suffix.lower() in EXTENSIONS)
    for path in files:
        relative = path.relative_to(folder)
        source_id = digest(relative.as_posix())[:20]
        source = run.data['sources'].setdefault(source_id, {
            'id': source_id, 'relative': relative.as_posix(), 'source_path': str(path), 'candidates': [],
        })
        source.update(active=True, group=config['identity'] or (relative.parts[0] if len(relative.parts) > 1 else folder.name))
        try:
            fingerprint = file_digest(path)
            unchanged = (fingerprint == source.get('fingerprint')
                         and source.get('original') and asset(directory, source['original']).is_file()
                         and source.get('working') and asset(directory, source['working']).is_file())
            if not unchanged:
                with Image.open(path) as image:
                    size = list(ImageOps.exif_transpose(image).size)
                original = f'original/{source_id}-{fingerprint[:16]}{path.suffix.lower()}'
                destination = asset(directory, original)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    shutil.copy2(path, destination)
                previous = next((c for c in source['candidates'] if c['kind'] == 'full'), {})
                if source['candidates']:
                    source.setdefault('history', []).append({'at': time.time(), 'working': source.get('working'),
                                                            'candidates': copy.deepcopy(source['candidates'])})
                full = {'id': 'full', 'kind': 'full', 'box': None, 'aliases': [], 'status': 'accepted'}
                source.update(fingerprint=fingerprint, original=original, working=original, scale=1,
                              original_size=size, working_size=size, prepare_key=digest([fingerprint, 'import-v1']),
                              candidates=[full], detection={'persons': [], 'heads': []}, notes=[])
                source.pop('scale_override', None)
                source.pop('person_index', None)
                if previous.get('tag'):
                    full['tag'] = copy.deepcopy(previous['tag'])
                    full['tag']['stale'] = True
            if config.get('import_captions'):
                full = source['candidates'][0]
                if not unchanged and full.get('tag'):
                    full['tag'].update(key=run.tag_key(source, full), image=source['original'], stale=False)
                    run.write_tag_file(full['tag'])
                if not full.get('tag'):
                    caption = path.with_suffix('.txt')
                    if not caption.is_file():
                        caption = next((p for p in path.parent.iterdir() if p.is_file()
                                        and p.stem == path.stem and p.suffix.lower() == '.txt'), caption)
                    text = caption.read_text(encoding='utf-8-sig') if caption.is_file() else ''
                    tags = list(dict.fromkeys(normalize(t) for t in re.split(r'[,\r\n]+', text) if normalize(t)))
                    full['tag'] = {'key': run.tag_key(source, full), 'image': source['original'], 'raw': tags,
                                   'tags': tags, 'scores': {}, 'auto_removed': [], 'operations': [],
                                   'suggestions': [], 'stale': False, 'origin': 'imported_caption'}
                    if caption.is_file():
                        shutil.copy2(caption, asset(directory, source['original']).with_suffix('.txt'))
                    else:
                        source['notes'].append('成品目录中此图没有同名 TXT，已保留图片，可手动补充标签。')
            source.pop('error', None)
        except Exception as error:
            source['error'] = str(error)
            failures.append(f'{relative}: {error}')
        run.save()
    run.save()
    return run, failures


def check_source(run, source):
    path = Path(source['source_path'])
    if not inside(path, run.config['input_dir']) or not path.is_file() or file_digest(path) != source['fingerprint']:
        raise ValueError('源文件已变化，请先刷新数据集')


def upscale_source(run, source, scale):
    """只变更工作图倍率，已有裁框跟随实际尺寸映射，不触发检测。"""
    check_source(run, source)
    if scale not in (1, 1.5, 2):
        raise ValueError('倍率只能为 1、1.5 或 2')
    if source['scale'] == scale:
        return False
    key = digest([source['fingerprint'], scale,
                  {k: run.config[k] for k in ('forge_url', 'upscaler_1', 'upscaler_2', 'blend')}, 'upscale-only-v1'])
    working = source['original'] if scale == 1 else f"working/{source['id']}-{key[:16]}.png"
    destination = asset(run.directory, working)
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(asset(run.directory, source['original'])) as image:
            original = ImageOps.exif_transpose(image).convert('RGB')
            run.client.check()
            result = run.client.upscale(original, scale)
        temporary = destination.with_suffix('.tmp')
        try:
            result.save(temporary, format='PNG')
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    with Image.open(destination) as image:
        size = list(ImageOps.exif_transpose(image).size)
    previous_size = source['working_size']
    source.setdefault('history', []).append({'at': time.time(), 'working': source['working'],
                                            'candidates': copy.deepcopy(source['candidates'])})
    for candidate in source['candidates']:
        if candidate['box'] is None:
            continue
        candidate.setdefault('box_history', []).append(candidate['box'][:])
        candidate['box'] = validate_box([v * size[i % 2] / previous_size[i % 2]
                                         for i, v in enumerate(candidate['box'])], size)
        if candidate['status'] == 'accepted' and area(candidate['box']) < run.config['min_area']:
            candidate['status'] = 'pending'
        if candidate.get('tag'):
            candidate['tag']['stale'] = True
    source.update(working=working, working_size=size, scale=scale, prepare_key=key,
                  detection={'persons': [], 'heads': []}, notes=['工作图倍率已更新，需要识别时请手动生成裁切候选。'])
    source.pop('person_index', None)
    run.save()
    return True


def detect_source(run, source):
    """在当前工作图上识别并生成候选，不放大，也不覆盖已有审核与手动裁框。"""
    check_source(run, source)
    analyzer = run.analyzer
    if analyzer is None:
        from .vision import analyze
        analyzer = analyze
    with Image.open(asset(run.directory, source['working'])) as image:
        analysis = analyzer(ImageOps.exif_transpose(image).convert('RGB'), run.config)
    preserved = [c for c in source['candidates'] if c['kind'] == 'full' or c['status'] != 'pending'
                 or c['id'].startswith('manual_') or c.get('box_history') or c.get('tag')]
    ids = {c['id'] for c in preserved}
    crops = [c for c in analysis['crops'] if c['id'] not in ids and not any(
        old['box'] and iou(old['box'], c['box']) >= run.config['duplicate_iou'] for old in preserved)]
    source.setdefault('history', []).append({'at': time.time(), 'working': source['working'],
                                            'candidates': copy.deepcopy(source['candidates'])})
    source.update(candidates=[*preserved, *crops], detection=analysis['detection'],
                  notes=analysis['notes'], proposal_version=3)
    source.pop('person_index', None)
    run.save()

"""独立打标工作流：保留双模型证据，可重复调整合并范围。"""
import copy
import json
import math
import re
import time
from pathlib import Path

from PIL import Image, ImageOps

from .core import asset, file_digest, normalize
from .geometry import full_body_conflict

MODELS = {'wd': 'wd-eva02-large-tagger-v3', 'pixai': 'pixai-tagger-v1.0'}
FLOOR = 0.01
DEFAULT_FILTERS = {'wd': 0.3, 'pixai': 0.4, 'commonWd': 0.2, 'commonPixai': 0.2}
META_PATH = Path(__file__).resolve().parents[2] / 'data/tags/pixai-tagger-v1.0/meta.json'


def validate_filters(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULT_FILTERS):
        raise ValueError('请提供 WD、PixAI 和共同标签的四项阈值')
    for number in value.values():
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not FLOOR <= number <= 1:
            raise ValueError('置信度范围必须在 0.01 到 1 之间')
    return dict(value)


def validate_options(value):
    if not isinstance(value, dict) or value.get('mode') not in ('wd', 'pixai', 'mixed'):
        raise ValueError('请选择 WD、PixAI 或混合打标')
    return {'mode': value['mode'], 'filters': validate_filters(value.get('filters'))}


def merged_tags(evidence, filters):
    wd, pixai = evidence['scores'].get('wd', {}), evidence['scores'].get('pixai', {})
    tags = []
    for name in dict.fromkeys([*wd, *pixai]):
        a, b = wd.get(name), pixai.get(name)
        if ((a is not None and a >= filters['wd']) or
                (b is not None and b >= filters['pixai']) or
                (a is not None and b is not None and a >= filters['commonWd'] and b >= filters['commonPixai'])):
            tags.append(name)
    return tags


def normalize_scores(scores, excluded):
    if not isinstance(scores, dict):
        raise ValueError('Tagger 返回的分数格式无效')
    result = {}
    for name, score in scores.items():
        if not isinstance(name, str) or isinstance(score, bool) or not isinstance(score, (float, int)) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError('Tagger 返回了无效标签或置信度')
        name = normalize(name)
        if name and name not in excluded and score > FLOOR:
            result[name] = max(result.get(name, 0), score)
    return result


def tag_run(run, options, progress):
    mode, filters = options['mode'], options['filters']
    models = MODELS if mode == 'mixed' else {mode: MODELS[mode]}
    available = run.client.request('GET', '/tagger/v1/interrogators')['models']
    missing = set(models.values()) - set(available)
    if missing:
        raise ValueError('Forge 缺少打标模型：' + ', '.join(sorted(missing)))
    excluded = set()
    if 'pixai' in models:
        metadata = json.loads(META_PATH.read_text(encoding='utf-8'))
        excluded = {normalize(t) for t in metadata['tags']} | {'masterpiece'}
    samples = [(s, c) for s in run.data['sources'].values() if s.get('active', True)
               for c in s['candidates'] if c['status'] == 'accepted']
    errors = []
    run.data['tagging_options'] = options
    progress(0, len(samples))
    for index, (source, candidate) in enumerate(samples):
        started = time.monotonic()
        try:
            path = Path(source['source_path'])
            if not path.is_file() or file_digest(path) != source['fingerprint']:
                raise ValueError('源图片已变化，请先刷新数据集')
            evidence = {'mode': mode, 'models': models, 'floor': FLOOR, 'filters': filters,
                        'metaFilter': 'model-category-table' if 'pixai' in models else None, 'scores': {}}
            # 两个模型必须读取同一底图；任一推理失败都不覆盖该样本的已有标签。
            def interrogate(image):
                for family, model in models.items():
                    scores = run.client.tag(image, model=model, threshold=FLOOR)
                    evidence['scores'][family] = normalize_scores(scores, excluded if family == 'pixai' else set())
            if candidate['box'] is None:
                interrogate(asset(run.directory, source['original']))
            else:
                with Image.open(asset(run.directory, source['working'])) as image:
                    with ImageOps.exif_transpose(image).crop(candidate['box']) as crop:
                        interrogate(crop)
            key = run.tag_key(source, candidate)
            relative = run._materialize(source, candidate, key)
            raw = merged_tags(evidence, filters)
            removed = ['full body'] if full_body_conflict(candidate['box'], source['detection'], source['working_size']) else []
            tag = {'key': key, 'image': relative, 'raw': raw, 'tags': [t for t in raw if t not in removed],
                   'scores': {}, 'auto_removed': removed, 'operations': [], 'suggestions': [],
                   'stale': False, 'origin': 'tagging', 'evidence': evidence,
                   'seconds': round(time.monotonic() - started, 3)}
            if candidate['kind'] == 'full' and run.preserve_filename(source):
                tag['caption'] = Path(relative).with_name(source['caption_name']).as_posix()
            if candidate.get('tag'):
                candidate.setdefault('tag_history', []).append(copy.deepcopy(candidate['tag']))
            run.write_tag_file(tag)
            candidate['tag'] = tag
            candidate.pop('error', None)
            run.save()
        except Exception as error:
            candidate['error'] = str(error)
            errors.append(f"{source['relative']}/{candidate['id']}: {error}")
            run.save()
        progress(index + 1, len(samples))
    return errors


def apply_filters(run, data):
    filters = validate_filters(data.get('filters'))
    selections = data.get('selections')
    if not isinstance(selections, list) or not selections:
        raise ValueError('请选择要应用过滤的样本')
    targets = []
    seen = set()
    for selection in selections:
        if not isinstance(selection, dict):
            raise ValueError('样本选择格式无效')
        source, candidate = run.locate(selection['source'], selection['candidate'])
        pair = (source['id'], candidate['id'])
        if pair in seen:
            continue
        seen.add(pair)
        if not source.get('active', True) or candidate['status'] != 'accepted' or not run.current_tag(source, candidate) or not candidate['tag'].get('evidence'):
            raise ValueError('样本没有有效的模型分数，请重新打标')
        targets.append(candidate)
    for candidate in targets:
        tag = copy.deepcopy(candidate['tag'])
        tag['evidence']['filters'] = filters
        tag['raw'] = merged_tags(tag['evidence'], filters)
        tag['tags'] = [t for t in tag['raw'] if t not in tag['auto_removed']]
        tag.update(operations=[], restore_raw=False)
        candidate.setdefault('tag_history', []).append(copy.deepcopy(candidate['tag']))
        run.write_tag_file(tag)
        candidate['tag'] = tag
        if run.data.get('tagging_options'):
            run.data['tagging_options']['filters'] = filters
        run.save()
    return {'changed': len(targets)}


def restore_captions(run):
    if run.config.get('crop_mode') != 'prepared':
        raise ValueError('仅完整打标数据集支持重新导入源 TXT')
    targets = []
    for source in run.data['sources'].values():
        if not source.get('active', True):
            continue
        if source.get('original_backup'):
            raise ValueError('存在已替换底图，请先恢复原始图后再导入源 TXT')
        image = Path(source['source_path'])
        if not image.is_file() or file_digest(image) != source['fingerprint']:
            raise ValueError('源图片已变化，请先刷新数据集')
        path = image.with_name(source['caption_name'])
        if not path.is_file():
            continue
        tags = list(dict.fromkeys(normalize(t) for t in re.split(r'[,\r\n]+', path.read_text(encoding='utf-8-sig')) if normalize(t)))
        candidate = next(c for c in source['candidates'] if c['kind'] == 'full')
        tag = {'key': run.tag_key(source, candidate), 'image': source['original'], 'raw': tags, 'tags': tags,
               'scores': {}, 'auto_removed': [], 'operations': [], 'suggestions': [], 'stale': False,
               'origin': 'imported_caption', 'caption': Path(source['original']).with_name(path.name).as_posix()}
        targets.append((candidate, tag))
    if not targets:
        raise ValueError('导入来源中没有可恢复的同名 TXT')
    for candidate, tag in targets:
        if candidate.get('tag'):
            candidate.setdefault('tag_history', []).append(copy.deepcopy(candidate['tag']))
        run.write_tag_file(tag)
        candidate['tag'] = tag
        candidate.pop('error', None)
        run.save()
    return {'changed': len(targets)}

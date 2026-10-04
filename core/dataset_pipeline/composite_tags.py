"""双模型标签合并与单人动作冲突处理，不使用姿态关键点。"""
import json
import math
import re
from functools import lru_cache
from pathlib import Path


WD_MODEL = 'wd-eva02-large-tagger-v3'
PIXAI_MODEL = 'pixai-tagger-v1.0'
MODELS = (WD_MODEL, PIXAI_MODEL)
WD_THRESHOLD = 0.3
PIXAI_THRESHOLDS = {'general': 0.17, 'character': 0.27, 'style': 0.15,
                    'copyright': 0.24, 'meta': 0.17, 'rating': 0.41}


def normalize(tag):
    return tag.replace('_', ' ').strip()


@lru_cache(maxsize=1)
def catalogs():
    directory = Path(__file__).parent
    metadata = json.loads((directory / 'tagger_catalog.json').read_text(encoding='utf-8'))
    rules = json.loads((directory / 'action_conflicts.json').read_text(encoding='utf-8'))
    categories = {normalize(tag): category for category, tags in metadata['pixai_categories'].items() for tag in tags}
    meta = {normalize(tag) for tag in metadata['meta_tags']}
    return categories, meta, rules


def normalize_scores(scores):
    if not isinstance(scores, dict):
        raise ValueError('Tagger 未返回标签概率对象')
    result = {}
    aliases = catalogs()[2]['aliases']
    for tag, score in scores.items():
        if not isinstance(tag, str) or not tag.strip():
            raise ValueError('Tagger 返回了无效标签名')
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError(f'Tagger 返回了无效概率：{tag}')
        tag = normalize(tag)
        tag = aliases.get(tag, tag)
        result[tag] = max(score, result.get(tag, 0))
    return result


def filter_scores(model, scores):
    categories, meta, rules = catalogs()
    # 同义词规范化后仍沿用其模型类别，动作同义词均为 general。
    categories = {rules['aliases'].get(tag, tag): category for tag, category in categories.items()}
    result = {}
    for tag, score in scores.items():
        if tag in meta:
            continue
        if model == WD_MODEL:
            if score >= WD_THRESHOLD:
                result[tag] = score
            continue
        category = categories.get(tag)
        if category is None:
            raise ValueError(f'PixAI 类别快照不包含标签 {tag}，请更新 tagger_catalog.json')
        if category in ('meta', 'rating'):
            continue
        if score >= PIXAI_THRESHOLDS[category]:
            result[tag] = score
    return result


def single_person_evidence(filtered, raw):
    # 多视图中的同一个人可以拥有不同姿态，不能只凭 solo 删除动作。
    ambiguous = {'multiple views', 'comic', '4koma', 'sequence', 'split screen', 'multiple panels',
                 'extra arms', 'extra legs', 'multiple arms', 'multiple legs', 'no humans'}
    for model in MODELS:
        threshold = WD_THRESHOLD if model == WD_MODEL else PIXAI_THRESHOLDS['general']
        visible = {tag for tag, score in raw[model].items() if score >= threshold}
        if visible & ambiguous:
            return False, '检测到多视图、非普通人体或人数不适用标签，保留动作冲突'
        counts = []
        for tag in visible:
            match = re.fullmatch(r'(\d+|multiple)\s*(girls?|boys?|others?|people|persons?)', tag)
            if match:
                if match[1] == 'multiple' or int(match[1]) != 1:
                    return False, '至少一个模型检测到多人，保留动作冲突'
                counts.append(match[2])
        if len(counts) > 1:
            return False, '模型同时检测到多个性别或人物类别，保留动作冲突'
        if 'solo' not in filtered[model]:
            return False, '两个模型未同时确认 solo，保留动作冲突'
    combined = set(filtered[WD_MODEL]) | set(filtered[PIXAI_MODEL])
    if len(combined & {'1girl', '1boy', '1other'}) > 1:
        return False, '两个模型的人物数量类别不一致，保留动作冲突'
    return True, '两个模型均支持单人，且未检测到多人或多视图标签'


def resolve_conflicts(scores, enabled):
    rules = catalogs()[2]
    active = {}
    for family, tags in rules['families'].items():
        present = [tag for tag in tags if tag in scores]
        if present:
            best = max(present, key=lambda tag: (scores[tag], tag))
            active[family] = {'tags': present, 'best': best, 'score': scores[best]}
    conflicts = {}
    for rule in rules['exclusive_pairs']:
        left, right = rule['families']
        conflicts[frozenset((left, right))] = rule['reason']
    kept = []
    removed = []
    unresolved = []
    for family in sorted(active, key=lambda name: (-active[name]['score'], name)):
        current = active[family]
        incompatible = [other for other in kept if frozenset((family, other)) in conflicts]
        stronger = [other for other in incompatible if active[other]['score'] > current['score']]
        if enabled and stronger:
            winner = active[stronger[0]]
            for tag in current['tags']:
                removed.append({'tag': tag, 'score': scores[tag], 'winner': winner['best'],
                                'winner_score': winner['score'],
                                'reason': conflicts[frozenset((family, stronger[0]))]})
            continue
        for other in incompatible:
            unresolved.append({'tags': [active[other]['best'], current['best']],
                               'reason': '置信度相同，保留待核' if enabled else '非明确单人，未自动处理'})
        kept.append(family)
    deleted = {item['tag'] for item in removed}
    final = dict(sorted(((tag, score) for tag, score in scores.items() if tag not in deleted),
                        key=lambda item: (-item[1], item[0])))
    return final, removed, unresolved


def merge_tags(responses, models=MODELS):
    # 判别按 WD/PixAI 角色使用固定规则，证据记录使用实际请求的模型名称。
    raw = {role: normalize_scores(responses[model]) for role, model in zip(MODELS, models)}
    filtered = {model: filter_scores(model, raw[model]) for model in MODELS}
    candidates = set(filtered[WD_MODEL]) | set(filtered[PIXAI_MODEL])
    merged = {tag: max(raw[model].get(tag, 0) for model in MODELS) for tag in candidates}
    single, reason = single_person_evidence(filtered, raw)
    final, removed, unresolved = resolve_conflicts(merged, single)
    return {'probabilities': final, 'merged_before_conflicts': merged,
            'models': {model: raw[role] for role, model in zip(MODELS, models)},
            'filtered_models': {model: filtered[role] for role, model in zip(MODELS, models)},
            'single_person': single, 'person_reason': reason,
            'removed': removed, 'unresolved': unresolved, 'score_method': 'max',
            'thresholds': {models[0]: WD_THRESHOLD, models[1]: PIXAI_THRESHOLDS},
            'rules_version': catalogs()[2]['version']}

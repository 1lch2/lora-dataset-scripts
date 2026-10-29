"""网页管理的本机配置与固定标签资源。"""
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from .core import DEFAULTS, atomic_json, validate_config

ROOT = Path(__file__).resolve().parents[2]
SETTINGS_PATH = ROOT / '.local' / 'webui.json'
TAGS_CSV = ROOT / 'data' / 'tags' / 'wd-eva02-large-tagger-v3' / 'selected_tags.csv'
TAGGER_REPOSITORY = 'https://github.com/1lch2/stable-diffusion-webui-wd14-tagger'
EDITABLE = ('forge_dir', 'forge_url', 'upscaler_1', 'upscaler_2', 'blend',
            'tag_threshold', 'target_area', 'min_area', 'duplicate_iou', 'copyright', 'drop_tags')
RUNTIME_KEYS = (*EDITABLE, 'tags_csv', 'tagger_model')


def validate_forge(directory):
    if not isinstance(directory, str) or not directory.strip():
        raise ValueError('请在设置中填写 SD WebUI Forge Neo 目录')
    root = Path(directory).expanduser().resolve()
    if not (root / 'webui.bat').is_file():
        raise ValueError('所选目录没有 webui.bat，请选择 Forge Neo 根目录')
    extensions = root / 'extensions'
    host_config = root / 'config.json'
    host_values = json.loads(host_config.read_text(encoding='utf-8')) if host_config.is_file() else {}
    for extension in extensions.iterdir() if extensions.is_dir() else ():
        if not (extension / '.git').exists():
            continue
        result = subprocess.run(['git', '-C', str(extension), 'remote', 'get-url', 'origin'],
                                capture_output=True, text=True, timeout=10,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        remote = result.stdout.strip().removesuffix('.git').rstrip('/')
        if re.fullmatch(r'(?:https://github.com/|git@github.com:)1lch2/stable-diffusion-webui-wd14-tagger', remote, re.I):
            if extension.name in host_values.get('disabled_extensions', []) or host_values.get('disable_all_extensions', 'none') != 'none':
                raise ValueError('1lch2 WD14 Tagger 已被 Forge 禁用，请启用插件并重启 Forge')
            return str(root)
    raise ValueError(f'未找到 1lch2 维护的 WD14 Tagger，请安装 {TAGGER_REPOSITORY} 后保存')


def load_settings(path=SETTINGS_PATH):
    config = {**DEFAULTS, 'forge_dir': ''}
    if Path(path).is_file():
        values = json.loads(Path(path).read_text(encoding='utf-8'))
        config = validate_settings(values, config, check_forge=False)
    config.update(tags_csv=str(TAGS_CSV), tagger_model=DEFAULTS['tagger_model'])
    return config


def validate_settings(values, current, check_forge=True):
    if not isinstance(values, dict) or set(values) - set(EDITABLE):
        raise ValueError('设置包含未知字段')
    config = {**current, **values}
    for key in ('forge_dir', 'forge_url', 'upscaler_1', 'upscaler_2', 'copyright'):
        if not isinstance(config[key], str):
            raise ValueError(f'{key} 必须是文本')
    for key in ('blend', 'tag_threshold', 'duplicate_iou', 'min_area', 'target_area'):
        if isinstance(config[key], bool) or not isinstance(config[key], (int, float)):
            raise ValueError(f'{key} 必须是数字')
    for key in ('min_area', 'target_area'):
        if not isinstance(config[key], int):
            raise ValueError(f'{key} 必须是整数')
    validate_config(config, dataset=False)
    address = urlparse(config['forge_url'])
    if not address.hostname or address.port == 0:
        raise ValueError('请填写有效的 Forge API 地址和端口')
    if not config['upscaler_1'].strip() or not config['upscaler_2'].strip():
        raise ValueError('请填写放大模型名称')
    if check_forge:
        config['forge_dir'] = validate_forge(config['forge_dir'])
    return config


def settings_info(config):
    return {'values': {key: config[key] for key in EDITABLE},
            'configured': bool(config.get('forge_dir')), 'taggerRepository': TAGGER_REPOSITORY,
            'taggerModel': DEFAULTS['tagger_model'], 'tagsCsv': str(TAGS_CSV)}


def save_settings(values, current, path=SETTINGS_PATH):
    config = validate_settings(values, current)
    atomic_json(path, {key: config[key] for key in EDITABLE})
    return config

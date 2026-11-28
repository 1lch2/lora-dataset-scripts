"""通过 Forge ScuNET 1× 处理单张静态图片或本机目录。"""
import os
from itertools import count
from pathlib import Path

import numpy as np
from PIL import Image

from core.dataset_pipeline.core import EXTENSIONS
from tools.dataset import input_directory, ordinary_path
from tools.denoise import MAX_SR_PIXELS, png_bytes, read_image


def batch_directories(data):
    value = data.get('inputDir')
    if not isinstance(value, str) or not value.strip():
        raise ValueError('请输入图片目录')
    value = value.strip()
    recursive = value.endswith(('/**', '\\**'))
    source = input_directory(value[:-3] + os.sep if recursive else value)
    value = data.get('outputDir')
    if not isinstance(value, str) or not value.strip():
        raise ValueError('请输入输出目录')
    output = Path(value.strip()).expanduser().absolute()
    ordinary_path(output)
    output = output.resolve()
    if output == source or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('输出目录不能与输入目录重叠')
    if output.exists() and not output.is_dir():
        raise ValueError('输出路径须为目录')
    return source, output, recursive


def batch_images(source, recursive):
    def raise_error(error):
        raise error

    paths = []
    for base, directories, names in os.walk(source, onerror=raise_error):
        for name in sorted(names):
            path = Path(base) / name
            if not name.startswith('.') and path.suffix.lower() in EXTENSIONS:
                paths.append(path.relative_to(source))
        if not recursive:
            break
        directories[:] = sorted(name for name in directories if not name.startswith('.'))
        for name in directories:
            ordinary_path(Path(base) / name)
    if not paths:
        raise ValueError('输入范围内没有图片')
    return paths


def check_model(client):
    model = next((item for item in client.upscalers() if item['name'] == 'ScuNET'), None)
    if model is None:
        raise ValueError('Forge 中没有名为 ScuNET 的超分模型')
    location = model.get('model_path') or model.get('model_url') or ''
    if location.lower().startswith(('http://', 'https://')):
        raise ValueError('请先在 Forge 中安装本地 ScuNET 权重')


def scunet_image(source, client):
    rgb, alpha, icc = read_image(source, max_pixels=MAX_SR_PIXELS)
    width, height = rgb.size
    pad_x, pad_y = -width % 8, -height % 8
    # Forge 将尺寸按 8 对齐。复制边缘后裁回原图，避免 1× 降噪时重采样。
    padded = rgb
    if pad_x or pad_y:
        padded = Image.fromarray(np.pad(np.asarray(rgb), ((0, pad_y), (0, pad_x), (0, 0)), mode='edge'))
    result = client.upscale(padded, 1, model='ScuNET', max_pixels=padded.width * padded.height)
    if result.size != padded.size:
        raise ValueError(f'Forge 返回图像尺寸 {result.size}，预期 {padded.size}')
    return rgb, alpha, icc, png_bytes(result.convert('RGB').crop((0, 0, width, height)), alpha, icc)


def save_batch_image(output, relative, content):
    folder = output / relative.parent
    ordinary_path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for number in count():
        suffix = f'_{number}' if number else ''
        path = folder / f'{relative.stem}_denoised{suffix}.png'
        try:
            stream = path.open('xb')
        except FileExistsError:
            continue
        try:
            with stream:
                stream.write(content)
        except OSError:
            path.unlink(missing_ok=True)
            raise
        return

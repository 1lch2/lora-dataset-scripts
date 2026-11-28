"""通过 Forge 1× 降噪处理单张静态图片或本机目录。"""
import os
from itertools import count
from pathlib import Path

import numpy as np
from PIL import Image

from core.dataset_pipeline.core import EXTENSIONS
from tools.dataset import input_directory, ordinary_path
from tools.denoise import MAX_SR_PIXELS, png_bytes, read_image
from tools.scunet_texture import blend_denoised_chroma, fuse_denoised_images


DEFAULT_MODEL = 'ScuNET'


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


def model_names(client):
    names = []
    for item in client.upscalers(timeout=(3, 10)):
        location = item.get('model_path') or item.get('model_url') or ''
        if location and not location.lower().startswith(('http://', 'https://')):
            names.append(item['name'])
    return names


def denoise_options(data):
    model = data.get('model', DEFAULT_MODEL)
    chroma_model = data.get('chromaModel')
    preserve_texture = data.get('preserveTexture', False)
    if not isinstance(model, str) or not model.strip():
        raise ValueError('请选择降噪模型')
    if chroma_model is not None and (not isinstance(chroma_model, str) or not chroma_model.strip()):
        raise ValueError('请选择色度模型')
    if chroma_model == model:
        raise ValueError('双模型融合需要两个不同的模型')
    if not isinstance(preserve_texture, bool):
        raise ValueError('保留排线选项须为布尔值')
    if chroma_model and preserve_texture:
        raise ValueError('双模型融合与单模型保留排线不能同时启用')
    return {'model': model, 'chroma_model': chroma_model, 'preserve_texture': preserve_texture}


def _run_model(client, image, original_size, model):
    result = client.upscale(image, 1, model=model, max_pixels=image.width * image.height)
    if result.size != image.size:
        raise ValueError(f'{model} 返回图像尺寸 {result.size}，预期 {image.size}')
    return result.convert('RGB').crop((0, 0, *original_size))


def scunet_image(source, client, *, model=DEFAULT_MODEL, chroma_model=None, preserve_texture=False):
    rgb, alpha, icc = read_image(source, max_pixels=MAX_SR_PIXELS)
    width, height = rgb.size
    pad_x, pad_y = -width % 8, -height % 8
    # Forge 将尺寸按 8 对齐。复制边缘后裁回原图，避免 1× 降噪时重采样。
    padded = rgb
    if pad_x or pad_y:
        padded = Image.fromarray(np.pad(np.asarray(rgb), ((0, pad_y), (0, pad_x), (0, 0)), mode='edge'))
    clean = _run_model(client, padded, rgb.size, model)
    if chroma_model:
        color = _run_model(client, padded, rgb.size, chroma_model)
        clean = fuse_denoised_images(rgb, clean, color)
    elif preserve_texture:
        clean = blend_denoised_chroma(rgb, clean)
    return rgb, alpha, icc, png_bytes(clean, alpha, icc)


def save_batch_image(output, relative, content, *, fused=False):
    folder = output / relative.parent
    ordinary_path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    stem = f'{relative.stem}_denoised' + ('_fused' if fused else '')
    for number in count():
        suffix = f'_{number}' if number else ''
        path = folder / f'{stem}{suffix}.png'
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

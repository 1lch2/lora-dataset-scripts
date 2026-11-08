"""单图降噪；L0 算法改编自 CXP-2024/gpt-anime-denoise（MIT）。

上游 denoise.py: 6ddf438d25009826cce2737f7fe1df5912adbba2。
版权与许可见仓库 third_party/gpt-anime-denoise-LICENSE。
"""
import base64
import binascii
import io
import math

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_INPUT_BYTES = 20 * 1024 * 1024
MAX_INPUT_PIXELS = 4_000_000
MAX_SR_PIXELS = 36_000_000
MAX_SIDE = 8192


def validate_options(data):
    scale, strength = data.get('scale', 0.6), data.get('strength', 0.001)
    enabled, model = data.get('l0', True), data.get('model')
    for value, low, high, label in ((scale, 0.4, 1.0, '预缩放比例'),
                                    (strength, 0.0001, 0.005, 'L0 强度')):
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{label}须在 {low}–{high} 之间')
    if not isinstance(enabled, bool):
        raise ValueError('L0 开关必须为布尔值')
    if not isinstance(model, str) or not model.strip():
        raise ValueError('请选择超分模型')
    return {'scale': scale, 'strength': strength, 'l0': enabled, 'model': model}


def decode_upload(payload):
    if not isinstance(payload, str) or len(payload) > (MAX_INPUT_BYTES + 2) // 3 * 4:
        raise ValueError('图片文件不能超过 20 MiB')
    try:
        raw = base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('图片编码无效') from error
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ValueError('图片文件大小无效（最多 20 MiB）')
    return raw


def open_image(raw):
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ('PNG', 'JPEG', 'WEBP'):
                raise ValueError('请选择 PNG、JPEG 或 WebP 图片')
            if image.width * image.height > MAX_INPUT_PIXELS or max(image.size) > MAX_SIDE:
                raise ValueError('图片最多 400 万像素，单边不能超过 8192 像素')
            if getattr(image, 'is_animated', False):
                raise ValueError('请使用静态图片')
            image = ImageOps.exif_transpose(image)
            transparent = 'A' in image.getbands() or 'transparency' in image.info
            icc = image.info.get('icc_profile') if image.mode in ('RGB', 'RGBA', 'P') else None
            if transparent:
                rgba = image.convert('RGBA')
                return rgba.convert('RGB'), rgba.getchannel('A'), icc
            return image.convert('RGB'), None, icc
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError('无法读取图片，文件可能已损坏') from error


def png_bytes(image, alpha=None, icc=None):
    if alpha is not None:
        image = image.copy()
        image.putalpha(alpha)
    stream = io.BytesIO()
    image.save(stream, 'PNG', icc_profile=icc)
    return stream.getvalue()


def l0_smooth(image, strength=0.001):
    """真正的 L0 梯度最小化：联合 RGB 梯度阈值与周期边界 FFT 求解。"""
    if not math.isfinite(strength) or not 0.0001 <= strength <= 0.005:
        raise ValueError('L0 强度须在 0.0001–0.005 之间')
    current = np.asarray(image, dtype=np.float64)
    if current.ndim != 3 or current.shape[2] != 3 or min(current.shape[:2]) < 1:
        raise ValueError('L0 输入须为 H×W×3 浮点 RGB 图像')
    height, width, _ = current.shape
    # 周期差分算子的频谱；解析式同时正确处理宽或高为 1 的图片。
    spectrum = (2 - 2 * np.cos(2 * np.pi * np.fft.fftfreq(height)))[:, None]
    spectrum = spectrum + (2 - 2 * np.cos(2 * np.pi * np.fft.fftfreq(width)))[None, :]
    original_fft = np.fft.fft2(current, axes=(0, 1))
    beta = 2 * strength
    while beta < 1e5:
        horizontal = np.roll(current, -1, axis=1) - current
        vertical = np.roll(current, -1, axis=0) - current
        mask = (horizontal ** 2 + vertical ** 2).sum(axis=2) < strength / beta
        horizontal[mask] = 0
        vertical[mask] = 0
        divergence = (np.roll(horizontal, 1, axis=1) - horizontal
                      + np.roll(vertical, 1, axis=0) - vertical)
        numerator = original_fft + beta * np.fft.fft2(divergence, axes=(0, 1))
        current = np.fft.ifft2(numerator / (1 + beta * spectrum)[..., None], axes=(0, 1)).real
        beta *= 2
    return current.clip(0, 1)


def denoise_image(rgb, alpha, icc, client, options, progress):
    progress('prescale')
    size = tuple(max(1, round(value * options['scale'])) for value in rgb.size)
    small = rgb.resize(size, Image.Resampling.BOX)
    progress('upscale')
    models = client.upscalers()
    model = next((item for item in models if item['name'] == options['model']), None)
    if model is None or model['name'] == 'None':
        raise ValueError(f"Forge 中没有超分模型 {options['model']}")
    model_path = model.get('model_path')
    if isinstance(model_path, str) and model_path.lower().startswith(('http://', 'https://')):
        raise ValueError('所选模型指向下载地址，请选择 Forge 中已有的本地模型；降噪不会下载权重')
    native_scale = model.get('scale')
    if type(native_scale) not in (int, float) or not math.isfinite(native_scale) or not 1 <= native_scale <= 8:
        raise ValueError('超分接口没有提供有效原生倍率（支持 1–8 倍），请刷新模型列表')
    if size[0] * size[1] * native_scale ** 2 > MAX_SR_PIXELS:
        raise ValueError('原生超分输出预计超过 3600 万像素，请降低预缩放比例或选择较小倍率模型')
    try:
        upscaled = client.upscale(small, native_scale, model=model['name'], max_pixels=MAX_SR_PIXELS)
    except Exception as error:
        raise ValueError(f'Forge 超分失败：{error}') from error
    progress('restore')
    if upscaled.mode != 'RGB':
        upscaled = upscaled.convert('RGB')
    result = upscaled.resize(rgb.size, Image.Resampling.LANCZOS)
    del small, upscaled
    if options['l0']:
        progress('l0')
        pixels = l0_smooth(np.asarray(result, dtype=np.float64) / 255, options['strength'])
        result = Image.fromarray((pixels * 255 + 0.5).astype(np.uint8))
    progress('encode')
    return png_bytes(result, alpha, icc)

"""混合原图与 ScuNET 的亮度，使用 ScuNET 的色度。"""
import cv2
import numpy as np
from PIL import Image


ORIGINAL_LUMA_WEIGHT = 0.50
ROWS_PER_CHUNK = 256
COLOR_SIGMA = 12
COLOR_RADIUS = 4 * COLOR_SIGMA


def blend_denoised_chroma(source, clean):
    source_pixels = np.asarray(source)
    clean_pixels = np.asarray(clean)
    result = np.empty_like(clean_pixels)
    for start in range(0, result.shape[0], ROWS_PER_CHUNK):
        rows = slice(start, start + ROWS_PER_CHUNK)
        source_luma = cv2.cvtColor(source_pixels[rows].astype(np.float32), cv2.COLOR_RGB2GRAY)
        clean_rgb = clean_pixels[rows]
        clean_luma = cv2.cvtColor(clean_rgb.astype(np.float32), cv2.COLOR_RGB2GRAY)
        delta = np.rint(ORIGINAL_LUMA_WEIGHT * (source_luma - clean_luma)).astype(np.int16)

        # 平移三个 RGB 通道等价于只改亮度。像素接近色域边界时，共享限幅避免色度偏移。
        rgb = clean_rgb.astype(np.int16)
        delta = np.clip(delta, -rgb.min(axis=2), 255 - rgb.max(axis=2))
        result[rows] = rgb + delta[..., None]
    return Image.fromarray(result)


def fuse_denoised_images(source, luma_image, chroma_image):
    source_pixels = np.asarray(source)
    luma_pixels = np.asarray(luma_image)
    chroma_pixels = np.asarray(chroma_image)
    result = np.empty_like(source_pixels)
    kernel = (2 * COLOR_RADIUS + 1,) * 2
    height = result.shape[0]
    for start in range(0, height, ROWS_PER_CHUNK):
        end = min(height, start + ROWS_PER_CHUNK)
        top = max(0, start - COLOR_RADIUS)
        rows = slice(top, end + COLOR_RADIUS)
        center = slice(start - top, end - top)
        original, detail, base = (
            cv2.cvtColor(pixels[rows].astype(np.float32) / 255.0, cv2.COLOR_RGB2YCrCb)
            for pixels in (source_pixels, luma_pixels, chroma_pixels)
        )
        base[:, :, 0] = detail[:, :, 0]
        # 原图只贡献平滑后的色调校准。带卷积边距分块，避免边界出现接缝。
        correction = cv2.GaussianBlur(original - base, kernel, COLOR_SIGMA)
        rgb = cv2.cvtColor(base[center] + correction[center], cv2.COLOR_YCrCb2RGB)
        result[start:end] = np.rint(np.clip(rgb, 0, 1) * 255.0).astype(np.uint8)
    return Image.fromarray(result)

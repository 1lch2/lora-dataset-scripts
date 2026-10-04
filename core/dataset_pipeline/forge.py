import base64
import io
from pathlib import Path

import requests
from PIL import Image


def encode_image(image):
    stream = io.BytesIO()
    image.save(stream, format="PNG", compress_level=1)
    return base64.b64encode(stream.getvalue()).decode("ascii")


class ForgeClient:
    def __init__(self, config):
        self.config = config
        self.url = config["forge_url"].rstrip("/")

    def request(self, method, route, **kwargs):
        response = requests.request(method, self.url + route, timeout=(10, 600), **kwargs)
        response.raise_for_status()
        return response.json()

    def check(self, tagging=False):
        if tagging:
            models = self.request("GET", "/tagger/v1/interrogators")["models"]
            if self.config["tagger_model"] not in models:
                raise ValueError(f"Forge 中没有打标模型 {self.config['tagger_model']}")
        else:
            names = {m["name"] for m in self.request("GET", "/sdapi/v1/upscalers")}
            for key in ("upscaler_1", "upscaler_2"):
                if self.config[key] not in names:
                    raise ValueError(f"Forge 中没有放大模型 {self.config[key]}")

    def upscale(self, image, scale):
        data = self.request("POST", "/sdapi/v1/extra-single-image", json={
            "image": encode_image(image), "resize_mode": 0, "upscaling_resize": scale,
            "upscaler_1": self.config["upscaler_1"], "upscaler_2": self.config["upscaler_2"],
            "extras_upscaler_2_visibility": self.config["blend"], "upscaling_crop": False,
            "gfpgan_visibility": 0, "codeformer_visibility": 0,
        })
        payload = data["image"].split(",")[-1]
        with Image.open(io.BytesIO(base64.b64decode(payload, validate=True))) as result:
            result.load()
            # Forge rounds dimensions to multiples of eight.
            expected = tuple(round(v * scale / 8) * 8 for v in image.size)
            if result.size != expected:
                raise ValueError(f"Forge 返回尺寸 {result.size}，预期 {expected}")
            return result.copy()

    def tag(self, image):
        # Existing files already have a supported image encoding; send them as-is.
        payload = (base64.b64encode(image.read_bytes()).decode("ascii")
                   if isinstance(image, Path) else encode_image(image))
        result = self.request("POST", "/tagger/v1/interrogate", json={
            "image": payload, "model": self.config["tagger_model"],
            "threshold": self.config["tag_threshold"], "queue": "", "name_in_queue": "",
        })
        return result["caption"]["tag"]

    def tag_bytes(self, content, model, threshold=0.0):
        """对同一份图片字节使用指定模型，保留未过滤概率供复合判别。"""
        result = self.request('POST', '/tagger/v1/interrogate', json={
            'image': base64.b64encode(content).decode('ascii'), 'model': model,
            'threshold': threshold, 'queue': '', 'name_in_queue': '',
        })
        return result['caption']['tag']

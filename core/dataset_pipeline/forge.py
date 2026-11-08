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

    def upscalers(self):
        return self.request("GET", "/sdapi/v1/upscalers")

    def upscale(self, image, scale, *, model=None, max_pixels=None):
        data = self.request("POST", "/sdapi/v1/extra-single-image", json={
            "image": encode_image(image), "resize_mode": 0, "upscaling_resize": scale,
            "upscaler_1": model if model is not None else self.config["upscaler_1"],
            "upscaler_2": "None" if model is not None else self.config["upscaler_2"],
            "extras_upscaler_2_visibility": 0 if model is not None else self.config["blend"], "upscaling_crop": False,
            "gfpgan_visibility": 0, "codeformer_visibility": 0,
        })
        if not isinstance(data, dict) or not isinstance(data.get("image"), str):
            raise ValueError("Forge 未返回有效图像")
        payload = data["image"].split(",")[-1]
        with Image.open(io.BytesIO(base64.b64decode(payload, validate=True))) as result:
            if max_pixels is not None and result.width * result.height > max_pixels:
                raise ValueError("Forge 返回图像超过降噪资源限制")
            result.load()
            # Forge rounds dimensions to multiples of eight.
            expected = tuple(round(v * scale / 8) * 8 for v in image.size)
            if model is None and result.size != expected:
                raise ValueError(f"Forge 返回尺寸 {result.size}，预期 {expected}")
            return result.copy()

    def tag(self, image, *, model=None, threshold=None):
        # Existing files already have a supported image encoding; send them as-is.
        payload = (base64.b64encode(image.read_bytes()).decode("ascii")
                   if isinstance(image, Path) else encode_image(image))
        result = self.request("POST", "/tagger/v1/interrogate", json={
            "image": payload, "model": model or self.config["tagger_model"],
            "threshold": self.config["tag_threshold"] if threshold is None else threshold,
            "queue": "", "name_in_queue": "",
        })
        return result["caption"]["tag"]

import base64
import io
import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import Mock

import numpy as np
import requests
from PIL import Image

from core.dataset_pipeline.core import DEFAULTS
from tools.denoise import denoise_image, l0_smooth, open_image, validate_options
from core.dataset_pipeline.forge import encode_image
from webui.server import make_server


def image_bytes(image, format='PNG', **kwargs):
    stream = io.BytesIO()
    image.save(stream, format, **kwargs)
    return stream.getvalue()


class L0Tests(unittest.TestCase):
    def test_edge_remains_sharp_while_fine_noise_is_removed(self):
        clean = np.full((32, 48, 3), 0.2)
        clean[:, 24:] = 0.8
        source = clean + np.random.default_rng(5).normal(0, 0.008, clean.shape)
        result = l0_smooth(source)
        self.assertLess(np.mean((result - clean) ** 2), np.mean((source - clean) ** 2) / 5)
        self.assertGreater(float(np.mean(result[:, 24] - result[:, 23])), 0.55)


class DenoisePipelineTests(unittest.TestCase):
    def test_rgba_and_palette_alpha_preserved(self):
        source = Image.new('RGBA', (32, 24), (90, 60, 200, 255))
        alpha = np.arange(32 * 24, dtype=np.uint8).reshape(24, 32)
        source.putalpha(Image.fromarray(alpha))
        for image in (source, source.quantize()):
            with self.subTest(mode=image.mode):
                rgb, original_alpha, icc = open_image(image_bytes(image))
                client = Mock()
                client.upscalers.return_value = [{'name': 'anime', 'scale': 2}]
                client.upscale.return_value = rgb.resize((40, 30))
                options = validate_options({'model': 'anime'})
                result = denoise_image(rgb, original_alpha, icc, client, options, lambda _: None)
                with Image.open(io.BytesIO(result)) as output:
                    np.testing.assert_array_equal(np.array(output.getchannel('A')), np.array(original_alpha))
                    self.assertEqual(output.size, image.size)

    def test_rejects_oversized_images_and_model_downloads(self):
        with self.assertRaises(ValueError):
            open_image(image_bytes(Image.new('RGB', (2001, 2000))))
        client = Mock()
        client.upscalers.return_value = [{'name': 'anime', 'scale': 8}]
        with self.assertRaises(ValueError):
            denoise_image(Image.new('RGB', (1000, 1000)), None, None, client,
                          validate_options({'model': 'anime', 'scale': 1}), lambda _: None)
        client.upscale.assert_not_called()
        client.upscalers.return_value = [{'name': 'anime', 'scale': 4,
                                         'model_path': 'https://example.com/model.pth'}]
        with self.assertRaises(ValueError):
            denoise_image(Image.new('RGB', (32, 32)), None, None, client,
                          validate_options({'model': 'anime'}), lambda _: None)
        client.upscale.assert_not_called()


class DenoiseHTTPTests(unittest.TestCase):
    def setUp(self):
        self.malformed = False
        owner = self

        class FakeForge(BaseHTTPRequestHandler):
            def do_GET(self):
                self.reply([{'name': 'anime', 'scale': 4}, {'name': 'None', 'scale': 1}])

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if owner.malformed:
                    self.reply({'image': 'broken-image'})
                    return
                with Image.open(io.BytesIO(base64.b64decode(data['image']))) as source:
                    # 故意返回未对齐到 8 的尺寸，确认降噪采用实际返回图。
                    result = source.resize((source.width * 4, source.height * 4))
                    self.reply({'image': encode_image(result)})

            def reply(self, data):
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        self.forge = ThreadingHTTPServer(('127.0.0.1', 0), FakeForge)
        threading.Thread(target=self.forge.serve_forever, daemon=True).start()
        self.server = make_server(port=0, config={**DEFAULTS, 'forge_url': f'http://127.0.0.1:{self.forge.server_port}',
                                                 'upscaler_1': 'anime'})
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.token = requests.get(self.url + '/api/session', timeout=5).json()['token']

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.forge.shutdown()
        self.forge.server_close()

    def post(self, route, data):
        return requests.post(self.url + route, json=data, headers={'X-Review-Token': self.token}, timeout=5)

    def start(self, **options):
        data = {'model': 'anime', 'image': encode_image(Image.new('RGB', (53, 37), 'red')), **options}
        response = self.post('/api/denoise/start', data)
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def wait(self):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            info = requests.get(self.url + '/api/denoise/status', timeout=5).json()
            if info['status'] != 'running':
                return info
            time.sleep(0.01)
        self.fail('降噪任务超时')

    def test_end_to_end_and_model_list(self):
        self.assertEqual(self.post('/api/denoise/models', {}).status_code, 202)
        self.assertEqual(self.wait()['models'], [{'name': 'anime', 'scale': 4}])
        self.start(l0=True)
        info = self.wait()
        self.assertEqual(info['status'], 'complete', info)
        result = info['result']
        for kind in ('output', 'original'):
            response = requests.get(self.url + f"/api/denoise/image?id={result['id']}&kind={kind}", timeout=5)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['Content-Type'], 'image/png')
            with Image.open(io.BytesIO(response.content)) as image:
                self.assertEqual(image.size, (53, 37))
        self.assertEqual(requests.get(self.url + '/api/state', timeout=5).json()['datasetLoaded'], False)

    def test_bad_forge_image_and_unavailable_api(self):
        self.malformed = True
        self.start()
        info = self.wait()
        self.assertEqual(info['status'], 'failed')
        self.assertIsNone(info['result'])
        self.forge.shutdown()
        self.forge.server_close()
        self.start()
        self.assertEqual(self.wait()['status'], 'failed')

if __name__ == '__main__':
    unittest.main()

import base64
import io
import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import Mock, patch

import numpy as np
import requests
from PIL import Image

from dataset_pipeline.core import DEFAULTS
from dataset_pipeline.denoise import (MAX_INPUT_PIXELS, denoise_image, l0_smooth,
                                      open_image, validate_options)
from dataset_pipeline.forge import ForgeClient, encode_image
from dataset_pipeline.review import make_server


def image_bytes(image, format='PNG', **kwargs):
    stream = io.BytesIO()
    image.save(stream, format, **kwargs)
    return stream.getvalue()


class L0Tests(unittest.TestCase):
    def test_constant_and_single_pixel_axes(self):
        for shape in ((16, 24, 3), (1, 9, 3), (9, 1, 3), (1, 1, 3)):
            with self.subTest(shape=shape):
                source = np.full(shape, 0.4)
                np.testing.assert_allclose(l0_smooth(source), source, atol=1e-10)

    def test_edge_remains_sharp_while_fine_noise_is_removed(self):
        clean = np.full((32, 48, 3), 0.2)
        clean[:, 24:] = 0.8
        source = clean + np.random.default_rng(5).normal(0, 0.008, clean.shape)
        result = l0_smooth(source)
        self.assertLess(np.mean((result - clean) ** 2), np.mean((source - clean) ** 2) / 5)
        self.assertGreater(float(np.mean(result[:, 24] - result[:, 23])), 0.55)
        self.assertEqual(result.shape, source.shape)
        self.assertTrue(np.isfinite(result).all())

    def test_strength_changes_result(self):
        source = np.full((24, 32, 3), 0.45)
        source[8:16, 10:22] += 0.06
        source += np.random.default_rng(1).normal(0, 0.015, source.shape)
        gentle = l0_smooth(source, 0.0001)
        strong = l0_smooth(source, 0.005)
        self.assertGreater(float(np.mean(np.abs(gentle - strong))), 0.001)
        self.assertLess(float(np.var(strong)), float(np.var(gentle)))


class DenoisePipelineTests(unittest.TestCase):
    def test_formats_alpha_scaling_and_disabled_l0(self):
        for format in ('PNG', 'JPEG', 'WEBP'):
            for scale in (0.4, 0.6, 1.0):
                with self.subTest(format=format, scale=scale):
                    source = Image.new('RGB', (53, 37), (20, 100, 200))
                    rgb, alpha, icc = open_image(image_bytes(source, format))
                    client = Mock()
                    client.upscalers.return_value = [{'name': 'anime', 'scale': 4}]
                    client.upscale.return_value = source.resize((84, 64))
                    stages = []
                    options = validate_options({'model': 'anime', 'scale': scale, 'l0': False})
                    with patch('dataset_pipeline.denoise.l0_smooth') as smooth:
                        result = denoise_image(rgb, alpha, icc, client, options, stages.append)
                        smooth.assert_not_called()
                    self.assertEqual(client.upscale.call_args.args[0].size,
                                     (round(53 * scale), round(37 * scale)))
                    self.assertEqual(client.upscale.call_args.args[1], 4)
                    with Image.open(io.BytesIO(result)) as output:
                        self.assertEqual(output.size, source.size)
                        self.assertEqual(output.format, 'PNG')
                        self.assertEqual(output.mode, 'RGB')
                    self.assertEqual(stages, ['prescale', 'upscale', 'restore', 'encode'])

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

    def test_exif_orientation(self):
        source = Image.new('RGB', (53, 37), 'red')
        exif = Image.Exif()
        exif[274] = 6
        rgb, _, _ = open_image(image_bytes(source, 'JPEG', exif=exif))
        self.assertEqual(rgb.size, (37, 53))

    def test_invalid_options_and_resource_bounds(self):
        for field, value in (('scale', True), ('scale', 0.1), ('strength', float('nan')), ('l0', 'yes')):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    validate_options({'model': 'anime', field: value})
        with self.assertRaisesRegex(ValueError, '400 万'):
            open_image(image_bytes(Image.new('RGB', (2001, 2000))))
        self.assertGreater(2001 * 2000, MAX_INPUT_PIXELS)
        client = Mock()
        client.upscalers.return_value = [{'name': 'anime', 'scale': 8}]
        with self.assertRaisesRegex(ValueError, '3600 万'):
            denoise_image(Image.new('RGB', (1000, 1000)), None, None, client,
                          validate_options({'model': 'anime', 'scale': 1}), lambda _: None)
        client.upscale.assert_not_called()
        client.upscalers.return_value = [{'name': 'anime', 'scale': 4,
                                         'model_path': 'https://example.com/model.pth'}]
        with self.assertRaisesRegex(ValueError, '不会下载权重'):
            denoise_image(Image.new('RGB', (32, 32)), None, None, client,
                          validate_options({'model': 'anime'}), lambda _: None)
        client.upscale.assert_not_called()

    def test_original_upscale_contract_unchanged(self):
        client = ForgeClient(DEFAULTS)
        response = {'image': encode_image(Image.new('RGB', (16, 16)))}
        with patch.object(client, 'request', return_value=response) as request:
            client.upscale(Image.new('RGB', (8, 8)), 2)
            payload = request.call_args.kwargs['json']
            self.assertEqual(payload['upscaler_1'], DEFAULTS['upscaler_1'])
            self.assertEqual(payload['upscaler_2'], DEFAULTS['upscaler_2'])
            self.assertEqual(payload['extras_upscaler_2_visibility'], DEFAULTS['blend'])
            with self.assertRaisesRegex(ValueError, '预期'):
                client.upscale(Image.new('RGB', (8, 8)), 4)
            client.upscale(Image.new('RGB', (8, 8)), 4, model='anime')
            self.assertEqual(request.call_args.kwargs['json']['extras_upscaler_2_visibility'], 0)


class DenoiseHTTPTests(unittest.TestCase):
    def setUp(self):
        self.payloads = []
        self.malformed = False
        self.hold = threading.Event()
        self.hold.set()
        owner = self

        class FakeForge(BaseHTTPRequestHandler):
            def do_GET(self):
                self.reply([{'name': 'anime', 'scale': 4}, {'name': 'None', 'scale': 1}])

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.payloads.append(data)
                owner.hold.wait(5)
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
        self.setup = Mock()
        self.server = make_server(port=0, config={**DEFAULTS, 'forge_url': f'http://127.0.0.1:{self.forge.server_port}',
                                                 'upscaler_1': 'anime'}, model_setup=self.setup)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.token = requests.get(self.url + '/api/session', timeout=5).json()['token']

    def tearDown(self):
        self.hold.set()
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
        self.assertEqual(self.payloads[0]['upscaling_resize'], 4)
        self.assertEqual(self.payloads[0]['upscaler_2'], 'None')
        self.setup.assert_called()
        self.assertEqual(requests.get(self.url + '/api/state', timeout=5).json()['datasetLoaded'], False)

    def test_bad_forge_image_and_unavailable_api(self):
        self.malformed = True
        self.start()
        info = self.wait()
        self.assertEqual(info['status'], 'failed')
        self.assertIn('Forge 超分失败', info['errors'][0])
        self.assertIsNone(info['result'])
        self.forge.shutdown()
        self.forge.server_close()
        self.start()
        self.assertEqual(self.wait()['status'], 'failed')

    def test_authentication_invalid_upload_and_task_mutex(self):
        initial = requests.get(self.url + '/api/job', timeout=5).json()
        self.assertEqual((initial['total'], initial['done']), (0, 0))
        self.assertEqual(requests.post(self.url + '/api/denoise/start', json={}, timeout=5).status_code, 403)
        self.assertEqual(self.post('/api/denoise/start', {'model': 'anime', 'image': 'bad'}).status_code, 400)
        self.hold.clear()
        self.start()
        response = self.post('/api/denoise/models', {})
        self.assertEqual(response.status_code, 400)
        self.assertIn('已有任务', response.json()['error'])
        self.hold.set()
        self.assertEqual(self.wait()['status'], 'complete')

    def test_corrupt_image_fails_before_starting_forge(self):
        self.start(image=base64.b64encode(b'not an image').decode())
        self.assertEqual(self.wait()['status'], 'failed')
        self.setup.assert_not_called()
        self.assertEqual(self.payloads, [])


if __name__ == '__main__':
    unittest.main()

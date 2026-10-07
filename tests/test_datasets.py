"""Dataset import and synchronization checks use synthetic images only."""
import copy
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image

import launch_webui
from dataset_pipeline.core import DEFAULTS, Run, prepare
from dataset_pipeline.datasets import import_config, import_sources, list_datasets
from dataset_pipeline.review import make_server


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.addCleanup(patch.stopall)
        patch('dataset_pipeline.datasets.ROOT', self.root).start()
        self.folder = self.root / 'input'
        (self.folder / 'first').mkdir(parents=True)
        Image.new('RGB', (1400, 1600), 'red').save(self.folder / 'first' / 'a.png')
        table = self.root / 'selected_tags.csv'
        table.write_text('name,category\nblue_hair,0\n', encoding='utf-8')
        self.config = {**DEFAULTS, 'input_dir': str(self.folder), 'crop_mode': 'prepared',
                       'run_dir': str(self.root / 'runs' / 'initial'),
                       'output_dir': str(self.root / 'output'), 'min_area': 1, 'tags_csv': str(table)}
        self.run, errors = prepare(self.config)
        self.assertEqual(errors, [])

    def server(self):
        server = make_server(self.run.directory, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.url = f'http://127.0.0.1:{server.server_port}'
        self.token = requests.get(self.url + '/api/session', timeout=5).json()['token']

    def post(self, route, data):
        return requests.post(self.url + route, headers={'X-Review-Token': self.token}, json=data, timeout=5)

    def finished(self):
        for _ in range(100):
            state = requests.get(self.url + '/api/job', timeout=5).json()
            if state['status'] != 'running':
                self.assertEqual(state['status'], 'complete', state)
                return state
            time.sleep(.02)
        self.fail('Dataset job did not finish')

    def test_sync_adds_roles_preserves_manual_crops_and_handles_deleted_sources(self):
        source = next(iter(self.run.data['sources'].values()))
        self.run.change_crop(source['id'], None, [0, 0, 800, 900], 'accepted')
        old = copy.deepcopy(source['candidates'])
        (self.folder / 'second').mkdir()
        added = self.folder / 'second' / 'b.png'
        Image.new('RGB', (300, 400)).save(added)
        self.server()
        self.assertEqual(requests.post(self.url + '/api/edit', json={'action': 'sync_sources'}, timeout=5).status_code, 403)
        self.assertEqual(self.post('/api/edit', {'action': 'sync_sources'}).status_code, 202)
        self.finished()
        state = requests.get(self.url + '/api/state', timeout=5).json()
        self.assertEqual({s['group'] for s in state['sources'].values() if s['active']}, {'first', 'second'})
        for candidate in state['sources'][source['id']]['candidates']:
            candidate.pop('tag_current')
        self.assertEqual(state['sources'][source['id']]['candidates'], old)
        added.unlink()
        self.assertEqual(self.post('/api/edit', {'action': 'sync_sources'}).status_code, 202)
        self.finished()
        self.assertEqual(len([s for s in Run.load(self.run.directory).data['sources'].values() if s['active']]), 1)

    def test_import_prepared_captions_and_switch_back_without_models(self):
        folder = self.root / 'finished'
        folder.mkdir()
        image = folder / 'done.png'
        Image.new('RGB', (1500, 1700), 'blue').save(image)
        image.with_suffix('.txt').write_text('custom_trigger, blue_hair\n', encoding='utf-8')
        self.server()
        values = {'directory': str(folder), 'identity': 'character', 'cropMode': 'prepared', 'importCaptions': True}
        with patch('dataset_pipeline.core.ForgeClient.check', side_effect=AssertionError('Unexpected model call')), \
                patch('dataset_pipeline.vision.analyze', side_effect=AssertionError('Unexpected detector')):
            response = self.post('/api/datasets/import', values)
            self.assertEqual(response.status_code, 202, response.text)
            imported = Path(response.json()['runDir'])
            self.finished()
            run = Run.load(imported)
            source = next(iter(run.data['sources'].values()))
            self.assertEqual(source['scale'], 1)
            self.assertEqual(len(source['candidates']), 1)
            full = source['candidates'][0]
            self.assertTrue(run.current_tag(source, full))
            self.assertEqual(full['tag']['tags'], ['custom trigger', 'blue hair'])
            with Image.open(imported / full['tag']['image']) as actual:
                self.assertEqual(actual.size, (1500, 1700))
            run.edit_tags([[source['id'], 'full']], {'mode': 'add', 'tags': ['manual edit']})
            run.export()
            self.assertEqual(self.post('/api/datasets/open', {'runDir': str(self.run.directory)}).status_code, 202)
            self.finished()
            self.assertEqual(self.post('/api/datasets/import', values).status_code, 202)
            self.finished()
            reloaded = Run.load(imported)
            self.assertIn('manual edit', next(iter(reloaded.data['sources'].values()))['candidates'][0]['tag']['tags'])
        listing = list_datasets(self.run.directory)
        self.assertEqual(len(listing['datasets']), 2)

    def test_restarting_launcher_opens_empty_ui_without_loading_default_dataset(self):
        (self.folder / 'new-role').mkdir()
        Image.new('RGB', (50, 60)).save(self.folder / 'new-role' / 'new.png')
        path = self.root / 'config.json'
        path.write_text(json.dumps(self.config), encoding='utf-8')
        with patch.object(launch_webui, 'listening', return_value=False), \
                patch.object(launch_webui, 'ensure_forge') as forge, patch.object(launch_webui, 'serve') as serve:
            launch_webui.launch(path, self.root, 8765, 10, False)
        forge.assert_not_called()
        self.assertIsNone(serve.call_args.args[0])
        self.assertEqual(serve.call_args.kwargs['config'], self.config)
        self.assertEqual({s['group'] for s in Run.load(self.run.directory).data['sources'].values()}, {'first'})

    def test_import_modes_are_isolated_and_empty_or_overlapping_directories_rejected(self):
        values = {'directory': str(self.folder), 'identity': '', 'cropMode': 'auto'}
        automatic = import_config(values, self.config)
        self.assertEqual(automatic['crop_mode'], 'manual')
        (self.folder / 'first' / 'a.txt').write_text('blue_hair', encoding='utf-8')
        prepared = import_config({**values, 'cropMode': 'prepared'}, self.config)
        self.assertEqual(prepared['crop_mode'], 'prepared')
        self.assertNotEqual(automatic['run_dir'], prepared['run_dir'])
        self.assertEqual(automatic['identity'], '')
        empty = self.root / 'empty'
        empty.mkdir()
        with self.assertRaisesRegex(ValueError, '没有支持的图片'):
            import_config({**values, 'directory': str(empty)}, self.config)
        with self.assertRaisesRegex(ValueError, '互相包含'):
            import_config({**values, 'directory': str(self.root)}, self.config)

    def test_switching_is_blocked_during_sync_and_repeat_refresh_joins_job(self):
        self.server()
        entered, release = threading.Event(), threading.Event()
        def slow_import(config):
            entered.set()
            release.wait(5)
            return import_sources(config)
        with patch('dataset_pipeline.review.import_sources', side_effect=slow_import):
            try:
                self.assertEqual(self.post('/api/edit', {'action': 'sync_sources'}).status_code, 202)
                self.assertTrue(entered.wait(5))
                self.assertEqual(self.post('/api/edit', {'action': 'sync_sources'}).status_code, 202)
                self.assertEqual(self.post('/api/datasets/open', {'runDir': str(self.run.directory)}).status_code, 400)
                self.assertEqual(self.post('/api/edit', {'action': 'drop_tags', 'tags': []}).status_code, 400)
            finally:
                release.set()
            self.finished()


if __name__ == '__main__':
    unittest.main()

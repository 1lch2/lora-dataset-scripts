"""Dataset import and synchronization checks use synthetic images only."""
import base64
import copy
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image

from webui import launcher
from core.dataset_pipeline.core import DEFAULTS, Run, file_digest, prepare
from core.dataset_pipeline.datasets import import_config, import_sources, list_datasets
from webui.server import make_server


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.addCleanup(patch.stopall)
        patch('core.dataset_pipeline.datasets.ROOT', self.root).start()
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
        image = folder / '示例 image.01.JpEg'
        Image.new('RGB', (1500, 1700), 'blue').save(image)
        caption = image.with_suffix('.TXT')
        caption.write_text('custom_trigger, blue_hair\n', encoding='utf-8')
        self.server()
        values = {'directory': str(folder), 'identity': 'character', 'cropMode': 'prepared', 'importCaptions': True}
        with patch('core.dataset_pipeline.core.ForgeClient.check', side_effect=AssertionError('Unexpected model call')), \
                patch('core.dataset_pipeline.vision.analyze', side_effect=AssertionError('Unexpected detector')):
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
            self.assertEqual(Path(source['original']).name, image.name)
            self.assertEqual(run.tag_file(full['tag']).name, caption.name)
            self.assertEqual(file_digest(imported / source['original']), file_digest(image))
            self.assertEqual(run.tag_file(full['tag']).read_bytes(), caption.read_bytes())
            with Image.open(imported / full['tag']['image']) as actual:
                self.assertEqual(actual.size, (1500, 1700))
            run.edit_tags([[source['id'], 'full']], {'mode': 'add', 'tags': ['manual edit']})
            run.export()
            output = Path(run.config['output_dir'])
            self.assertEqual({p.name for p in output.iterdir()}, {image.name, caption.name})
            self.assertEqual(file_digest(output / image.name), file_digest(image))
            self.assertIn('manual edit', (output / caption.name).read_text(encoding='utf-8'))
            self.assertEqual(self.post('/api/datasets/open', {'runDir': str(self.run.directory)}).status_code, 202)
            self.finished()
            self.assertEqual(self.post('/api/datasets/import', values).status_code, 202)
            self.finished()
            reloaded = Run.load(imported)
            self.assertIn('manual edit', next(iter(reloaded.data['sources'].values()))['candidates'][0]['tag']['tags'])
        listing = list_datasets(self.run.directory)
        self.assertEqual(len(listing['datasets']), 2)

    def test_nested_filenames_and_edited_tags_survive_reimport_and_export(self):
        folder = self.root / 'nested-finished'
        for group, color in [('first', 'red'), ('second', 'blue')]:
            nested = folder / group / 'nested'
            nested.mkdir(parents=True)
            Image.new('RGB', (100, 120), color).save(nested / 'Same Name.JPG')
            (nested / 'Same Name.TXT').write_text('blue_hair', encoding='utf-8')
        config = import_config({'directory': str(folder), 'identity': ''}, self.config)
        run, errors = import_sources(config)
        self.assertEqual(errors, [])
        first = next(s for s in run.data['sources'].values() if s['group'] == 'first')
        run.edit_tags([[first['id'], 'full']], {'mode': 'add', 'tags': ['manual edit']})
        run, errors = import_sources(config)
        self.assertEqual(errors, [])
        self.assertEqual(run.export(), 2)
        output = Path(config['output_dir'])
        self.assertEqual({p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()},
                         {'first/nested/Same Name.JPG', 'first/nested/Same Name.TXT',
                          'second/nested/Same Name.JPG', 'second/nested/Same Name.TXT'})
        for image in folder.rglob('*.JPG'):
            self.assertEqual(file_digest(output / image.relative_to(folder)), file_digest(image))
        self.assertIn('manual edit', (output / 'first/nested/Same Name.TXT').read_text(encoding='utf-8'))
        self.assertNotIn('manual edit', (output / 'second/nested/Same Name.TXT').read_text(encoding='utf-8'))

    def test_image_only_import_keeps_original_format_after_manual_tagging(self):
        folder = self.root / 'pictures-only'
        folder.mkdir()
        image = folder / 'Original Image.JPEG'
        Image.new('RGB', (200, 300), 'green').save(image)
        config = import_config({'directory': str(folder), 'identity': 'character'}, self.config)
        run, errors = import_sources(config)
        self.assertEqual(errors, [])
        with patch('core.dataset_pipeline.core.ForgeClient.check'), \
                patch('core.dataset_pipeline.core.ForgeClient.request',
                      return_value={'caption': {'tag': {'blue_hair': .9}}}) as request:
            self.assertEqual(run.tag_all(), [])
        self.assertEqual(base64.b64decode(request.call_args.kwargs['json']['image']), image.read_bytes())
        source = next(iter(run.data['sources'].values()))
        self.assertEqual(Path(source['candidates'][0]['tag']['image']).name, image.name)
        self.assertEqual(run.export(), 1)
        output = Path(config['output_dir'])
        self.assertEqual({p.name for p in output.iterdir()}, {image.name, 'Original Image.txt'})
        self.assertEqual(file_digest(output / image.name), file_digest(image))

    def test_restarting_launcher_opens_empty_ui_without_loading_default_dataset(self):
        (self.folder / 'new-role').mkdir()
        Image.new('RGB', (50, 60)).save(self.folder / 'new-role' / 'new.png')
        with patch.object(launcher, 'listening', return_value=False), \
                patch.object(launcher, 'ensure_forge') as forge, patch.object(launcher, 'serve') as serve:
            launcher.launch(self.root, 8765, 10, False, settings_path=self.root / 'webui.json')
        forge.assert_not_called()
        self.assertIsNone(serve.call_args.args[0])

    def test_import_type_and_recursive_scope_survive_reopening(self):
        Image.new('RGB', (50, 60)).save(self.folder / 'root.png')
        (self.folder / 'root.txt').write_text('root tag', encoding='utf-8')
        (self.folder / 'first' / 'a.txt').write_text('blue_hair', encoding='utf-8')
        self.server()
        directories = {}
        for mode, options, expected in (
            ('prepared', {}, {'root.png', 'first/a.png'}),
            ('prepared', {'recursive': False}, {'root.png'}),
            ('manual', {}, {'root.png'}),
            ('manual', {'recursive': True}, {'root.png', 'first/a.png'}),
        ):
            with self.subTest(mode=mode, options=options):
                response = self.post('/api/datasets/import', {
                    'directory': str(self.folder), 'cropMode': mode, **options,
                })
                self.assertEqual(response.status_code, 202, response.text)
                directories[mode] = response.json()['runDir']
                self.finished()
                self.assertEqual(self.post('/api/datasets/open', {'runDir': directories[mode]}).status_code, 202)
                self.finished()
                run = Run.load(directories[mode])
                sources = [s for s in run.data['sources'].values() if s['active']]
                self.assertEqual({s['relative'] for s in sources}, expected)
                self.assertTrue(all(bool(s['candidates'][0].get('tag')) == (mode == 'prepared') for s in sources))
        self.assertNotEqual(directories['prepared'], directories['manual'])
        values = {'directory': str(self.folder), 'cropMode': 'manual'}
        empty = self.root / 'empty'
        empty.mkdir()
        with self.assertRaises(ValueError):
            import_config({**values, 'directory': str(empty)}, self.config)
        with self.assertRaises(ValueError):
            import_config({**values, 'directory': str(self.root)}, self.config)

    def test_switching_is_blocked_during_sync_and_repeat_refresh_joins_job(self):
        self.server()
        entered, release = threading.Event(), threading.Event()
        def slow_import(config):
            entered.set()
            release.wait(5)
            return import_sources(config)
        with patch('webui.server.import_sources', side_effect=slow_import):
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

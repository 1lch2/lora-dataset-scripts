"""标签检查的合成图片、模拟视觉接口与真实审核 HTTP 路由回归。"""
import base64
import io
import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image

from core.dataset_pipeline.core import DEFAULTS, Run, asset
from core.dataset_pipeline.datasets import import_sources
from core.dataset_pipeline.feature_audit import edit_feature
from webui.server import make_server
from core.dataset_pipeline.tag_audit import audit_run, audit_view, edit_audit, suggestions


OBSERVATION = {'people': 2, 'girls': 2, 'boys': 0, 'count_certain': True,
               'framing': 'lower_body', 'framing_certain': True,
               'count_reason': '两个人物', 'framing_reason': '只有下半身'}
FEATURE = {'action': 'save_feature', 'name': '白色衬衫', 'description': '白色衣身与清楚可见的衬衫领口',
           'tag': 'white_shirt'}
PRESENT = {'state': 'present', 'reason': '白色衣身和领口可见'}


class TagAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        folder = self.root / 'input' / 'character'
        folder.mkdir(parents=True)
        Image.new('RGB', (100, 100), 'white').save(folder / 'a.png')
        self.caption = folder / 'a.txt'
        self.caption.write_text('1girl, solo, full body, virtual youtuber, blue hair\n', encoding='utf-8')
        table = self.root / 'tags.csv'
        table.write_text('name,category\nblue_hair,0\n', encoding='utf-8')
        config = {**DEFAULTS, 'input_dir': str(folder.parent), 'run_dir': str(self.root / 'run'),
                  'output_dir': str(self.root / 'output'), 'crop_mode': 'prepared', 'import_captions': True,
                  'min_area': 1, 'tags_csv': str(table)}
        self.run, errors = import_sources(config)
        self.assertEqual(errors, [])
        self.source = next(iter(self.run.data['sources'].values()))
        self.candidate = self.source['candidates'][0]
        self.options = {'visual': True, 'endpoint': 'http://127.0.0.1:1234/v1', 'model': 'test', 'forbidden': ['virtual youtuber']}

    def check(self):
        with patch('core.dataset_pipeline.tag_audit.observe', return_value=OBSERVATION):
            self.assertEqual(audit_run(self.run, self.options, lambda *_: None), [])
        return self.run.data['tag_audit']['findings']

    def test_undo_refuses_later_manual_edit(self):
        finding = self.check()[0]
        edit_audit(self.run, {'action': 'apply_audit', 'ids': [finding['id']]})
        batch = self.run.data['tag_audit']['batches'][-1]
        self.candidate['tag']['tags'].append('manual tag')
        with self.assertRaises(ValueError):
            edit_audit(self.run, {'action': 'undo_audit', 'batch': batch['id']})
        self.assertIn('manual tag', self.candidate['tag']['tags'])

    def test_individual_decisions_do_not_invalidate_other_count_findings(self):
        count_findings = [f for f in self.check() if f['category'] == 'count']
        for finding in count_findings:
            finding.pop('action')
            edit_audit(self.run, {'action': 'apply_audit', 'ids': [finding['id']]})
        self.assertNotIn('solo', self.candidate['tag']['tags'])
        self.assertNotIn('1girl', self.candidate['tag']['tags'])
        for batch in reversed(self.run.data['tag_audit']['batches']):
            edit_audit(self.run, {'action': 'undo_audit', 'batch': batch['id']})
        self.assertTrue(all(f['status'] == 'pending' for f in audit_view(self.run)['findings']))

    def test_related_caption_edit_invalidates_only_related_results(self):
        findings = self.check()
        self.candidate['tag']['tags'].append('2girls')
        view = audit_view(self.run)
        self.assertTrue(all(f['status'] == 'stale' for f in view['findings'] if f['category'] == 'count'))
        self.assertTrue(all(f['status'] == 'pending' for f in view['findings'] if f['category'] != 'count'))
        with self.assertRaises(ValueError):
            edit_audit(self.run, {'action': 'apply_audit', 'ids': [f['id'] for f in findings]})
        self.assertEqual(self.run.data['tag_audit']['batches'], [])

    def test_visual_failure_keeps_rule_results_and_reports_failure(self):
        with patch('core.dataset_pipeline.tag_audit.observe', side_effect=ValueError('invalid JSON')):
            errors = audit_run(self.run, self.options, lambda *_: None)
        self.assertEqual(len(errors), 1)
        self.assertEqual(self.run.data['tag_audit']['samples'][0]['status'], 'failed')
        self.assertEqual([f['tag'] for f in self.run.data['tag_audit']['findings']], ['virtual youtuber'])

    def test_concurrent_checks_preserve_captions_and_keep_other_results_after_failure(self):
        folder = self.caption.parent
        for index in range(3):
            Image.new('RGB', (100, 100), 'white').save(folder / f'extra{index}.png')
            (folder / f'extra{index}.txt').write_bytes(self.caption.read_bytes())
        self.run, errors = import_sources(self.run.config)
        self.assertEqual(errors, [])
        captions = {self.run.tag_file(c['tag']): self.run.tag_file(c['tag']).read_bytes()
                    for s in self.run.data['sources'].values() for c in s['candidates']}
        lock = threading.Lock()
        barrier = threading.Barrier(2)
        active = peak = calls = 0

        def observe_concurrently(path, options):
            nonlocal active, peak, calls
            with lock:
                active += 1
                peak = max(peak, active)
                calls += 1
                number = calls
            try:
                barrier.wait(timeout=5)
                if number == 1:
                    raise ValueError('simulated visual failure')
                return OBSERVATION
            finally:
                with lock:
                    active -= 1

        progress = []
        with patch('core.dataset_pipeline.tag_audit.observe', side_effect=observe_concurrently):
            errors = audit_run(self.run, {**self.options, 'concurrency': 2},
                               lambda done, total: progress.append((done, total)))
        audit = Run.load(self.run.directory).data['tag_audit']
        self.assertEqual(peak, 2)
        self.assertEqual(len(errors), 1)
        self.assertEqual(progress[-1], (4, 4))
        self.assertEqual({s['source'] for s in audit['samples']}, set(self.run.data['sources']))
        self.assertEqual(sum(s['status'] == 'failed' for s in audit['samples']), 1)
        self.assertEqual(sum(f['category'] == 'rule' for f in audit['findings']), 4)
        self.assertEqual(sum(f['category'] == 'framing' for f in audit['findings']), 3)
        self.assertEqual({path: path.read_bytes() for path in captions}, captions)

    def test_uncertain_observation_never_deletes_and_unknown_gender_is_not_guessed(self):
        observation = {**OBSERVATION, 'count_certain': False, 'framing_certain': False}
        self.assertEqual(suggestions(['solo', '1girl', 'full body'], observation), [])
        observation = {**OBSERVATION, 'girls': None, 'boys': None, 'framing_certain': False}
        self.assertEqual([f[1] for f in suggestions(['solo', '1girl'], observation)], ['solo'])

    def test_write_failure_restores_caption_and_batch_record(self):
        finding = self.check()[0]
        path = self.run.tag_file(self.candidate['tag'])
        before = path.read_bytes()
        write = self.run.write_tag_file

        def fail_after_write(tag):
            write(tag)
            raise OSError('simulated disk failure')

        with patch.object(self.run, 'write_tag_file', side_effect=fail_after_write):
            with self.assertRaises(OSError):
                edit_audit(self.run, {'action': 'apply_audit', 'ids': [finding['id']]})
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(Run.load(self.run.directory).data['tag_audit']['batches'], [])

    def test_http_check_apply_ignore_undo_and_progress(self):
        server = make_server(self.run.directory, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f'http://127.0.0.1:{server.server_port}'
        session = requests.Session()
        session.trust_env = False
        self.addCleanup(session.close)
        token = session.get(url + '/api/session', timeout=5).json()['token']
        session.headers['X-Review-Token'] = token
        caption = self.run.tag_file(self.candidate['tag'])
        original = self.caption.read_bytes()
        response = session.post(url + '/api/edit', json={'action': 'start_audit',
                                'audit': {**self.options, 'concurrency': 0}}, timeout=5)
        self.assertEqual(response.status_code, 400, response.text)
        with patch('core.dataset_pipeline.tag_audit.observe', return_value=OBSERVATION):
            response = session.post(url + '/api/edit', json={'action': 'start_audit',
                                    'audit': {**self.options, 'concurrency': 2}}, timeout=5)
            self.assertEqual(response.status_code, 202, response.text)
            for _ in range(100):
                job = session.get(url + '/api/job', timeout=5).json()
                if job['status'] != 'running':
                    break
                time.sleep(.02)
            self.assertEqual(job['status'], 'complete', job)
        self.assertEqual(caption.read_bytes(), original)
        audit = session.get(url + '/api/state', timeout=5).json()['tag_audit']
        self.assertEqual(audit['options']['concurrency'], 2)
        self.assertEqual({f['tag'] for f in audit['findings']}, {'1girl', 'solo', 'full body', 'virtual youtuber'})
        ids = [f['id'] for f in audit['findings']]
        response = session.post(url + '/api/edit', json={'action': 'apply_audit', 'ids': ids}, timeout=5)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(caption.read_text(encoding='utf-8'), 'blue hair\n')
        audit = session.get(url + '/api/state', timeout=5).json()['tag_audit']
        response = session.post(url + '/api/edit', json={'action': 'undo_audit', 'batch': audit['batches'][-1]['id']}, timeout=5)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(caption.read_bytes(), original)
        response = session.post(url + '/api/edit', json={'action': 'ignore_audit', 'ids': ids}, timeout=5)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(all(f['status'] == 'ignored' for f in session.get(url + '/api/state', timeout=5).json()['tag_audit']['findings']))
        self.assertEqual(self.caption.read_bytes(), original)

    def serve(self, server):
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f'http://127.0.0.1:{server.server_port}'

    def test_http_retry_replaces_only_failed_observations(self):
        folder = self.caption.parent
        for stem, color in (('b', 'blue'), ('c', 'red')):
            Image.new('RGB', (100, 100), color).save(folder / f'{stem}.png')
            (folder / f'{stem}.txt').write_bytes(self.caption.read_bytes())
        self.run, errors = import_sources(self.run.config)
        self.assertEqual(errors, [])
        captions = {self.run.tag_file(c['tag']): self.run.tag_file(c['tag']).read_bytes()
                    for s in self.run.data['sources'].values() for c in s['candidates']}
        url = self.serve(make_server(self.run.directory, 0))
        failures = {(0, 0, 255): 'invalid JSON', (255, 0, 0): 'invalid JSON'}
        checked = []

        def observe_sample(path, _options):
            with Image.open(path) as image:
                color = image.getpixel((0, 0))
            checked.append(color)
            if color in failures:
                raise ValueError(failures[color])
            return OBSERVATION

        with requests.Session() as session, patch('core.dataset_pipeline.tag_audit.observe', side_effect=observe_sample):
            session.trust_env = False
            session.headers['X-Review-Token'] = session.get(url + '/api/session', timeout=5).json()['token']

            def submit(retry=False):
                return session.post(url + '/api/edit', json={
                    'action': 'retry_audit_failed' if retry else 'start_audit',
                    'audit': self.options,
                }, timeout=5)

            def wait_for_results(retry, total, failed):
                response = submit(retry)
                self.assertEqual(response.status_code, 202, response.text)
                for _ in range(100):
                    job = session.get(url + '/api/job', timeout=5).json()
                    if job['status'] != 'running':
                        break
                    time.sleep(.02)
                self.assertEqual(job['status'], 'complete', job)
                self.assertEqual(job['errors'], [])
                self.assertEqual((job['done'], job['total'], job['failedCount']), (total, total, failed))
                return session.get(url + '/api/state', timeout=5).json()['tag_audit']

            first = wait_for_results(False, 3, 2)
            completed, = [s for s in first['samples'] if s['status'] == 'complete']
            rule_ids = {f['id'] for f in first['findings'] if f['category'] == 'rule'}
            self.assertEqual(len(rule_ids), 3)
            self.assertEqual({s['error'] for s in first['samples'] if s['status'] == 'failed'}, {'invalid JSON'})

            checked.clear()
            failures = {(255, 0, 0): 'service timeout'}
            second = wait_for_results(True, 2, 1)
            self.assertCountEqual(checked, [(0, 0, 255), (255, 0, 0)])
            self.assertIn(completed, second['samples'])
            self.assertEqual(len(second['samples']), 3)
            remaining, = [s for s in second['samples'] if s['status'] == 'failed']
            self.assertEqual((Path(remaining['name']).stem, remaining['error']), ('c', 'service timeout'))
            self.assertTrue(all(f in second['findings'] for f in first['findings']))

            checked.clear()
            failures = {}
            final = wait_for_results(True, 1, 0)
            self.assertEqual(checked, [(255, 0, 0)])
            self.assertEqual({s['status'] for s in final['samples']}, {'complete'})
            self.assertEqual(len(final['samples']), 3)
            self.assertEqual({f['id'] for f in final['findings'] if f['category'] == 'rule'}, rule_ids)
            self.assertEqual(sum(f['tag'] == 'full body' for f in final['findings']), 3)
            self.assertEqual(submit(True).status_code, 400)
            self.assertEqual({path: path.read_bytes() for path in captions}, captions)

    def add_reference_sample(self):
        folder = self.caption.parent
        Image.new('RGB', (80, 40), 'cyan').save(folder / 'reference.png')
        (folder / 'reference.txt').write_text('white_shirt, red bow\n', encoding='utf-8')
        self.run, errors = import_sources(self.run.config)
        self.assertEqual(errors, [])
        self.source, self.candidate = self.run.locate(self.source['id'], self.candidate['id'])
        source = next(item for item in self.run.data['sources'].values() if Path(item['relative']).stem == 'reference')
        return {'source': source['id'], 'candidate': source['candidates'][0]['id']}

    def test_costume_http_compares_two_images_and_only_applies_selected_tags(self):
        folder = self.caption.parent
        cases = {
            'change': ('red', 'alternate', 'blue hair'),
            'tagged': ('green', 'alternate', 'alternate_costume'),
            'same': ('blue', 'same', 'blue hair'),
            'hidden': ('black', 'unobservable', 'blue hair'),
            'unclear': ('purple', 'uncertain', 'blue hair'),
            'failed': ('orange', 'invalid', 'blue hair'),
        }
        states = {(255, 255, 255): 'same'}
        for name, (color, state, caption) in cases.items():
            image = Image.new('RGB', (100, 100), color)
            image.save(folder / f'{name}.png')
            states[image.getpixel((0, 0))] = state
            (folder / f'{name}.txt').write_text(caption + '\n', encoding='utf-8')
        selection = self.add_reference_sample()
        work = {Path(s['relative']).stem: self.run.tag_file(s['candidates'][0]['tag'])
                for s in self.run.data['sources'].values()}
        original = {path: path.read_bytes() for path in [*work.values(), *folder.glob('*.txt')]}
        calls = []

        class VisionHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                colors = []
                for part in data['messages'][0]['content']:
                    if part['type'] == 'image_url':
                        content = part['image_url']['url'].split(',', 1)[1]
                        with Image.open(io.BytesIO(base64.b64decode(content))) as image:
                            colors.append(image.getpixel((0, 0)))
                calls.append(colors)
                observation = {'state': states.get(colors[-1]), 'reason': '衣领剪裁可见'}
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'choices': [{'message': {'content': json.dumps(observation)}}]}).encode())

        endpoint = self.serve(ThreadingHTTPServer(('127.0.0.1', 0), VisionHandler))
        url = self.serve(make_server(self.run.directory, 0))
        with requests.Session() as session:
            session.trust_env = False
            session.headers['X-Review-Token'] = session.get(url + '/api/session', timeout=5).json()['token']

            def edit(action, **data):
                return session.post(url + '/api/edit', json={'action': action, **data}, timeout=5)

            def audit_state():
                return session.get(url + '/api/state', timeout=5).json()['tag_audit']

            options = {**self.options, 'endpoint': endpoint + '/v1', 'visual': False, 'concurrency': 2}
            self.assertEqual(edit('start_costume_audit', audit=options).status_code, 400)
            start = edit('start_costume_audit', audit=options, costumeReference=selection)
            self.assertEqual(start.status_code, 202, start.text)
            for _ in range(100):
                job = session.get(url + '/api/job', timeout=5).json()
                if job['status'] != 'running':
                    break
                time.sleep(.02)
            self.assertEqual((job['status'], job['done'], job['failedCount']), ('complete', len(work), 1))
            self.assertCountEqual(calls, [[(0, 255, 255), color] for color in states])
            audit = audit_state()
            self.assertEqual({Path(s['name']).stem: s['status'] for s in audit['costumeRun']['samples']}, {
                'a': 'absent', 'reference': 'absent', 'change': 'present', 'tagged': 'consistent',
                'same': 'absent', 'hidden': 'unobservable', 'unclear': 'uncertain', 'failed': 'failed',
            })
            finding, = audit['findings']
            self.assertEqual((finding['category'], finding['tags']), ('costume', ['alternate costume']))
            self.assertEqual({path: path.read_bytes() for path in original}, original)
            self.assertTrue(edit('apply_audit', ids=[finding['id']]).ok)
            self.assertEqual(work['change'].read_text(encoding='utf-8').strip(), 'blue hair, alternate costume')
            self.assertEqual((folder / 'change.txt').read_bytes(), original[folder / 'change.txt'])
            self.assertTrue(edit('undo_audit', batch=audit_state()['batches'][-1]['id']).ok)
            self.assertEqual({path: path.read_bytes() for path in original}, original)
            _, reference = self.run.locate(selection['source'], selection['candidate'])
            Image.new('RGB', (31, 32), 'white').save(asset(self.run.directory, reference['tag']['image']))
            self.assertEqual(audit_state()['findings'][0]['status'], 'stale')
            self.assertEqual(edit('apply_audit', ids=[finding['id']]).status_code, 400)

    def test_feature_http_scan_batch_export_and_undo(self):
        folder = self.caption.parent
        cases = {
            'b': ('red', 'present'), 'c': ('yellow', 'present'),
            'tagged': ('green', 'present'), 'absent': ('blue', 'absent'),
            'hidden': ('black', 'unobservable'), 'uncertain': ('purple', 'uncertain'),
            'invalid': ('orange', 'invalid'), 'bad-state': ('navy', 'bad-state'), 'refusal': ('pink', 'refusal'),
            'truncated': ('brown', 'length'), 'unsupported': ('gray', 'unsupported'),
        }
        states = {(255, 255, 255): 'present'}
        for name, (color, state) in cases.items():
            image = Image.new('RGB', (100, 100), color)
            image.save(folder / f'{name}.png')
            states[image.getpixel((0, 0))] = state
            caption = {'b': 'blue hair, white shirt', 'tagged': 'blue hair, white_shirt, collar',
                       'absent': 'blue hair, white_shirt'}.get(name, 'blue hair')
            (folder / f'{name}.txt').write_text(caption + '\n', encoding='utf-8')
        self.run, errors = import_sources(self.run.config)
        self.assertEqual(errors, [])
        self.run.data['drop_tags_override'] = ['collar']
        self.run.save()
        origins = {path: path.read_bytes() for path in folder.glob('*.txt')}
        work = {Path(s['relative']).stem: self.run.tag_file(s['candidates'][0]['tag'])
                for s in self.run.data['sources'].values()}
        before = {name: path.read_bytes() for name, path in work.items()}
        calls = []

        class VisionHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                content = data['messages'][0]['content']
                images = []
                for part in content:
                    if part['type'] == 'image_url':
                        encoded = part['image_url']['url'].split(',', 1)[1]
                        with Image.open(io.BytesIO(base64.b64decode(encoded))) as image:
                            images.append((image.getpixel((0, 0)), image.size))
                state = states[images[-1][0]]
                prompt = ' '.join(part['text'] for part in content if part['type'] == 'text')
                calls.append((len(images), images[-1][1], FEATURE['description'] in prompt,
                              any(tag in prompt for tag in ('blue hair', 'white shirt', '"collar"'))))
                message = {'content': json.dumps({**PRESENT, 'state': state}, ensure_ascii=False)}
                finish = 'stop'
                if state == 'refusal':
                    message = {'content': json.dumps(PRESENT), 'refusal': '拒绝'}
                if state == 'length':
                    message = {'content': json.dumps(PRESENT)}
                    finish = 'length'
                if state == 'invalid':
                    message = {'content': 'not JSON'}
                unsupported = state == 'unsupported'
                self.send_response(400 if unsupported else 200)
                self.end_headers()
                self.wfile.write(json.dumps({'choices': [{'message': message, 'finish_reason': finish}]}).encode())

        endpoint = self.serve(ThreadingHTTPServer(('127.0.0.1', 0), VisionHandler))
        url = self.serve(make_server(self.run.directory, 0))
        with requests.Session() as session:
            session.trust_env = False
            session.headers['X-Review-Token'] = session.get(url + '/api/session', timeout=5).json()['token']
            reference = next(item for item in self.run.data['sources'].values() if Path(item['relative']).stem == 'tagged')
            selection = {'source': reference['id'], 'candidate': reference['candidates'][0]['id']}
            feature_data = {**FEATURE, 'tags': ['white_shirt', 'collar'], 'runDir': self.run.directory.as_posix(),
                            'reference': selection}
            bad_tag = session.post(url + '/api/tag-audit/feature', json={**feature_data, 'tags': ['white shirt', 'red bow']}, timeout=5)
            self.assertEqual(bad_tag.status_code, 400)
            self.assertIn('工作标签', bad_tag.text)
            bad_image = session.post(url + '/api/tag-audit/feature', json={**feature_data, 'reference': {
                **selection, 'source': 'missing',
            }}, timeout=5)
            self.assertEqual(bad_image.status_code, 400)
            response = session.post(url + '/api/tag-audit/feature', json={**feature_data, 'reference': {
                **selection, 'region': [0.25, 0.25, 0.75, 0.75],
            }}, timeout=5)
            self.assertTrue(response.ok, response.text)
            feature_id = response.json()['result']['id']
            manifest_audit = Run.load(self.run.directory).data['tag_audit']
            feature = manifest_audit['features'][feature_id]
            self.assertEqual(feature['reference'], selection)
            ref = session.get(url + '/image', params={key: selection[key] for key in ('source', 'candidate')}
                              | {'kind': 'tag'}, timeout=5)
            self.assertTrue(ref.ok, ref.text)

            def edit(action, **data):
                return session.post(url + '/api/edit', json={'action': action, **data}, timeout=5)

            def wait_job():
                for _ in range(200):
                    job = session.get(url + '/api/job', timeout=5).json()
                    if job['status'] in ('complete', 'failed'):
                        return job
                    time.sleep(.02)
                self.fail('后台任务未完成')

            audit_options = {**self.options, 'endpoint': endpoint, 'concurrency': 2}
            conflict = edit('start_audit', featureId=feature_id, audit={**audit_options, 'forbidden': ['white_shirt']})
            self.assertEqual(conflict.status_code, 400)
            self.assertIn('禁用', conflict.text)
            response = edit('start_audit', featureId=feature_id, audit=audit_options)
            self.assertEqual(response.status_code, 202, response.text)
            job = wait_job()
            self.assertEqual((job['done'], job['total'], job['failedCount']), (len(work), len(work), 5))
            self.assertEqual(len(calls), len(work))
            self.assertEqual(set(calls), {(1, (100, 100), True, False)})
            self.assertEqual({name: path.read_bytes() for name, path in work.items()}, before)
            result = session.get(url + '/api/state', timeout=5).json()['tag_audit']
            samples = {Path(sample['name']).stem: sample['status'] for sample in result['featureRun']['samples']}
            expected = {name: state for name, (_, state) in cases.items()}
            expected.update(a='present', tagged='consistent', invalid='failed', refusal='failed',
                            truncated='failed', unsupported='failed')
            expected['bad-state'] = 'failed'
            self.assertEqual(samples, expected)
            findings = {Path(f['name'].split(' · ')[0]).stem: f['id'] for f in result['findings']}
            self.assertEqual(set(findings), {'a', 'b', 'c'})
            missing = {Path(f['name'].split(' · ')[0]).stem: f['tags'] for f in result['findings']}
            self.assertEqual(missing, {'a': ['white shirt', 'collar'], 'b': ['collar'],
                                       'c': ['white shirt', 'collar']})
            work['c'].write_bytes(before['c'].rstrip() + b', white shirt\n')
            self.assertFalse(edit('apply_audit', ids=[findings['c']]).ok)
            work['c'].write_bytes(before['c'])
            self.assertTrue(edit('apply_audit', ids=[findings['a'], findings['b'], findings['a']]).ok)
            after = {name: path.read_bytes() for name, path in work.items()}
            self.assertEqual(after['a'].splitlines(), [before['a'].rstrip() + b', white shirt, collar'])
            self.assertEqual(after['b'].splitlines(), [before['b'].rstrip() + b', collar'])
            self.assertEqual({name for name in after if after[name] != before[name]}, {'a', 'b'})
            saved = json.loads((self.run.directory / 'manifest.json').read_text(encoding='utf-8'))
            persisted = {Path(s['relative']).stem: s['candidates'][0]['tag']['tags'] for s in saved['sources'].values()}
            self.assertEqual(persisted['a'], after['a'].decode().strip().split(', '))
            self.assertEqual(persisted['b'], after['b'].decode().strip().split(', '))
            self.assertFalse(edit('apply_audit', ids=[findings['b']]).ok)
            self.assertTrue(edit('export').ok)
            self.assertEqual(wait_job()['status'], 'complete')
            exported = Path(self.run.config['output_dir'])
            for name in ('a', 'b'):
                caption = (exported / 'character' / f'{name}.txt').read_text(encoding='utf-8')
                self.assertIn('white shirt', caption)
                self.assertIn('collar', caption)
            self.assertNotIn('white shirt', (exported / 'character' / 'c.txt').read_text(encoding='utf-8'))
            self.assertEqual(len(list(exported.rglob('*.png'))), len(work))
            batch = saved['tag_audit']['batches'][-1]
            self.assertTrue(edit('undo_audit', batch=batch['id']).ok)
            self.assertEqual({name: path.read_bytes() for name, path in work.items()}, before)
            self.assertEqual({path: path.read_bytes() for path in origins}, origins)

    def test_feature_stale_after_target_or_definition_changes(self):
        selection = self.add_reference_sample()
        feature_id = edit_feature(self.run, {**FEATURE, 'reference': selection})['id']
        update = {**FEATURE, 'featureId': feature_id, 'reference': selection}
        with patch('core.dataset_pipeline.tag_audit.observe_feature', return_value=PRESENT):
            def scan():
                audit_run(self.run, self.options, lambda *_: None, feature_id)
                return audit_view(self.run)['findings'][0]['id']

            def assert_stale(fid):
                finding, = audit_view(self.run)['findings']
                self.assertEqual((finding['id'], finding['status']), (fid, 'stale'))
                with self.assertRaises(ValueError):
                    edit_audit(self.run, {'action': 'apply_audit', 'ids': [fid]})

            fid = scan()
            path = asset(self.run.directory, self.candidate['tag']['image'])
            Image.new('RGB', (110, 110), 'white').save(path)
            assert_stale(fid)
            fid = scan()
            edit_feature(self.run, {**update, 'description': '更新后的可观察细节'})
            assert_stale(fid)
            fid = scan()
            self.run.data['tag_audit']['featureRun'].pop('input')
            assert_stale(fid)
            fid = scan()
            _, reference = self.run.locate(selection['source'], selection['candidate'])
            reference_path = asset(self.run.directory, reference['tag']['image'])
            Image.new('RGB', (90, 45), 'cyan').save(reference_path)
            assert_stale(fid)
            with self.assertRaises(ValueError):
                audit_run(self.run, self.options, lambda *_: None, feature_id)
            edit_feature(self.run, update)
            fid = scan()
            self.run.edit_tags([(selection['source'], selection['candidate'])],
                               {'mode': 'remove', 'tags': ['white shirt']})
            assert_stale(fid)
            self.run.edit_tags([(selection['source'], selection['candidate'])],
                               {'mode': 'add', 'tags': ['white shirt']})
            fid = scan()
            self.run.edit_tags([(self.source['id'], self.candidate['id'])],
                               {'mode': 'add', 'tags': ['white_shirt']})
            assert_stale(fid)
            self.assertEqual(self.candidate['tag']['tags'].count('white shirt'), 1)

    def test_ignored_feature_survives_rescans_and_other_features_preserve_undo(self):
        feature_data = {**FEATURE, 'reference': self.add_reference_sample()}
        one = edit_feature(self.run, feature_data)['id']
        two = edit_feature(self.run, {**feature_data, 'name': '红色蝴蝶结', 'tag': 'red bow'})['id']
        with patch('core.dataset_pipeline.tag_audit.observe_feature', return_value=PRESENT):
            def scan(feature_id):
                audit_run(self.run, self.options, lambda *_: None, feature_id)
                finding, = audit_view(self.run)['findings']
                return finding

            finding = scan(one)
            edit_audit(self.run, {'action': 'ignore_audit', 'ids': [finding['id']]})
            other = scan(two)
            edit_audit(self.run, {'action': 'apply_audit', 'ids': [other['id']]})
            batch = self.run.data['tag_audit']['batches'][-1]['id']
            self.run = Run.load(self.run.directory)
            ignored = scan(one)
            self.assertEqual((ignored['status'], ignored['id']), ('ignored', finding['id']))
            edit_audit(self.run, {'action': 'undo_audit', 'batch': batch})
            self.assertEqual(self.run.tag_file(self.candidate['tag']).read_bytes(), self.caption.read_bytes())
            edit_feature(self.run, {'action': 'delete_feature', 'featureId': one})
            self.assertEqual(audit_view(self.run)['findings'][0]['status'], 'stale')

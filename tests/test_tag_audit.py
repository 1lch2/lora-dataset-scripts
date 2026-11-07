"""标签检查的合成图片、模拟视觉接口与真实审核 HTTP 路由回归。"""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image

from dataset_pipeline.core import DEFAULTS, Run
from dataset_pipeline.datasets import import_sources
from dataset_pipeline.review import make_server
from dataset_pipeline.tag_audit import (audit_run, audit_view, edit_audit, observe,
                                        suggestions, validate_observation, validate_options)


OBSERVATION = {'people': 2, 'girls': 2, 'boys': 0, 'count_certain': True,
               'framing': 'lower_body', 'framing_certain': True,
               'count_reason': '两个人物', 'framing_reason': '只有下半身'}


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
        with patch('dataset_pipeline.tag_audit.observe', return_value=OBSERVATION):
            self.assertEqual(audit_run(self.run, self.options, lambda *_: None), [])
        return self.run.data['tag_audit']['findings']

    def test_check_preserves_captions_and_is_idempotent(self):
        before = self.run.tag_file(self.candidate['tag']).read_bytes()
        findings = self.check()
        self.assertEqual({f['tag'] for f in findings}, {'1girl', 'solo', 'full body', 'virtual youtuber'})
        self.assertEqual(self.run.tag_file(self.candidate['tag']).read_bytes(), before)
        self.assertEqual(self.caption.read_bytes(), before)
        self.check()
        self.assertEqual(len(findings), 4)

    def test_apply_and_undo_batch_preserve_unrelated_tags_and_original(self):
        findings = self.check()
        before = self.candidate['tag']['tags'][:]
        result = edit_audit(self.run, {'action': 'apply_audit', 'ids': [f['id'] for f in findings]})
        self.assertEqual(result['changed'], 1)
        self.assertEqual(self.candidate['tag']['tags'], ['blue hair'])
        batch = self.run.data['tag_audit']['batches'][-1]
        edit_audit(self.run, {'action': 'undo_audit', 'batch': batch['id']})
        self.assertEqual(self.candidate['tag']['tags'], before)
        self.assertEqual(self.caption.read_text(encoding='utf-8').strip(), ', '.join(before))
        self.assertTrue(all(f['status'] == 'pending' for f in findings))
        self.assertEqual(Run.load(self.run.directory).data['tag_audit']['batches'][-1]['undone'], True)

    def test_undo_refuses_later_manual_edit(self):
        finding = self.check()[0]
        edit_audit(self.run, {'action': 'apply_audit', 'ids': [finding['id']]})
        batch = self.run.data['tag_audit']['batches'][-1]
        self.candidate['tag']['tags'].append('manual tag')
        with self.assertRaisesRegex(ValueError, '已有变化'):
            edit_audit(self.run, {'action': 'undo_audit', 'batch': batch['id']})
        self.assertIn('manual tag', self.candidate['tag']['tags'])

    def test_individual_decisions_do_not_invalidate_other_count_findings(self):
        count_findings = [f for f in self.check() if f['category'] == 'count']
        for finding in count_findings:
            edit_audit(self.run, {'action': 'apply_audit', 'ids': [finding['id']]})
        self.assertNotIn('solo', self.candidate['tag']['tags'])
        self.assertNotIn('1girl', self.candidate['tag']['tags'])
        for batch in reversed(self.run.data['tag_audit']['batches']):
            edit_audit(self.run, {'action': 'undo_audit', 'batch': batch['id']})
        self.assertTrue(all(f['status'] == 'pending' for f in audit_view(self.run)['findings']))

    def test_ignored_finding_stays_ignored_after_check(self):
        finding = self.check()[0]
        edit_audit(self.run, {'action': 'ignore_audit', 'ids': [finding['id']]})
        self.check()
        self.assertEqual(next(f for f in self.run.data['tag_audit']['findings'] if f['id'] == finding['id'])['status'], 'ignored')

    def test_related_caption_edit_invalidates_only_related_results(self):
        findings = self.check()
        self.candidate['tag']['tags'].append('2girls')
        view = audit_view(self.run)
        self.assertTrue(all(f['status'] == 'stale' for f in view['findings'] if f['category'] == 'count'))
        self.assertTrue(all(f['status'] == 'pending' for f in view['findings'] if f['category'] != 'count'))
        with self.assertRaises(ValueError):
            edit_audit(self.run, {'action': 'apply_audit', 'ids': [f['id'] for f in findings]})
        self.assertEqual(self.run.data['tag_audit']['batches'], [])

    def test_changed_image_and_rule_invalidate_suggestions(self):
        self.check()
        self.run.data['tag_audit']['options']['forbidden'] = []
        self.assertEqual(audit_view(self.run)['findings'][0]['status'], 'stale')
        Image.new('RGB', (120, 120), 'black').save(self.run.directory / self.candidate['tag']['image'])
        self.assertTrue(all(f['status'] == 'stale' for f in audit_view(self.run)['findings']))

    def test_visual_failure_keeps_rule_results_and_reports_failure(self):
        with patch('dataset_pipeline.tag_audit.observe', side_effect=ValueError('invalid JSON')):
            errors = audit_run(self.run, self.options, lambda *_: None)
        self.assertEqual(len(errors), 1)
        self.assertEqual(self.run.data['tag_audit']['samples'][0]['status'], 'failed')
        self.assertEqual([f['tag'] for f in self.run.data['tag_audit']['findings']], ['virtual youtuber'])

    def test_uncertain_observation_never_deletes_and_unknown_gender_is_not_guessed(self):
        observation = {**OBSERVATION, 'count_certain': False, 'framing_certain': False}
        self.assertEqual(suggestions(['solo', '1girl', 'full body'], observation), [])
        observation = {**OBSERVATION, 'girls': None, 'boys': None, 'framing_certain': False}
        self.assertEqual([f[1] for f in suggestions(['solo', '1girl'], observation)], ['solo'])
        observation.update(girls=0, boys=0)
        self.assertEqual([f[1] for f in suggestions(['solo', '1girl'], observation)], ['solo'])

    def test_schema_and_endpoint_validation(self):
        for value in ({**OBSERVATION, 'people': True}, {**OBSERVATION, 'people': 1},
                      {**OBSERVATION, 'framing': 'unknown'}, {**OBSERVATION, 'count_certain': 'yes'}):
            with self.assertRaises(ValueError):
                validate_observation(value)
        for endpoint in ('https://example.com/v1', 'http://localhost@external/v1', 'http://localhost/v1?key=1'):
            with self.assertRaises(ValueError):
                validate_options({**self.options, 'endpoint': endpoint})

    def test_model_request_does_not_include_caption_and_rejects_malformed_json(self):
        path = self.run.directory / self.candidate['tag']['image']
        with patch('dataset_pipeline.tag_audit.requests.Session') as session:
            response = session.return_value.__enter__.return_value.post.return_value
            response.status_code = 200
            response.json.return_value = {'choices': [{'message': {'content': json.dumps(OBSERVATION)}}]}
            self.assertEqual(observe(path, self.options), OBSERVATION)
            call = session.return_value.__enter__.return_value.post.call_args
            prompt = call.kwargs['json']['messages'][0]['content'][0]['text']
            self.assertNotIn('virtual youtuber', prompt)
            self.assertFalse(call.kwargs['allow_redirects'])
            response.json.return_value = {'choices': [{'message': {'content': 'I cannot answer'}}]}
            with self.assertRaises(ValueError):
                observe(path, self.options)

    def test_write_failure_restores_caption_and_batch_record(self):
        finding = self.check()[0]
        path = self.run.tag_file(self.candidate['tag'])
        before = path.read_bytes()
        write = self.run.write_tag_file

        def fail_after_write(tag):
            write(tag)
            raise OSError('simulated disk failure')

        with patch.object(self.run, 'write_tag_file', side_effect=fail_after_write):
            with self.assertRaisesRegex(OSError, 'simulated'):
                edit_audit(self.run, {'action': 'apply_audit', 'ids': [finding['id']]})
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(Run.load(self.run.directory).data['tag_audit']['batches'], [])

    def test_truncated_reasoning_output_is_reported_not_parsed(self):
        with patch('dataset_pipeline.tag_audit.requests.Session') as session:
            response = session.return_value.__enter__.return_value.post.return_value
            response.status_code = 200
            response.json.return_value = {'choices': [{'finish_reason': 'length', 'message': {'content': ''}}]}
            with self.assertRaisesRegex(ValueError, '长度限制'):
                observe(self.run.directory / self.candidate['tag']['image'], self.options)

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
        with patch('dataset_pipeline.tag_audit.observe', return_value=OBSERVATION):
            response = session.post(url + '/api/edit', json={'action': 'start_audit', 'audit': self.options}, timeout=5)
            self.assertEqual(response.status_code, 202, response.text)
            for _ in range(100):
                job = session.get(url + '/api/job', timeout=5).json()
                if job['status'] != 'running':
                    break
                time.sleep(.02)
            self.assertEqual((job['status'], job['done'], job['total']), ('complete', 1, 1), job)
        audit = session.get(url + '/api/state', timeout=5).json()['tag_audit']
        ids = [f['id'] for f in audit['findings']]
        response = session.post(url + '/api/edit', json={'action': 'apply_audit', 'ids': ids}, timeout=5)
        self.assertEqual(response.status_code, 200, response.text)
        audit = session.get(url + '/api/state', timeout=5).json()['tag_audit']
        response = session.post(url + '/api/edit', json={'action': 'undo_audit', 'batch': audit['batches'][-1]['id']}, timeout=5)
        self.assertEqual(response.status_code, 200, response.text)
        response = session.post(url + '/api/edit', json={'action': 'ignore_audit', 'ids': ids}, timeout=5)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(all(f['status'] == 'ignored' for f in session.get(url + '/api/state', timeout=5).json()['tag_audit']['findings']))

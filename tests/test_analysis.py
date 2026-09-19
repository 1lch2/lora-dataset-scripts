"""Synthetic inputs only. No real datasets, model downloads, or private images."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import numpy as np
import requests
from PIL import Image

from dataset_pipeline.analysis import analyze_directory, csv_report, measure, pose_distance, pose_vector, write_progress
from dataset_pipeline.analysis_job import AnalysisJob
from dataset_pipeline.review import make_server


def joints(offset=0, scale=1):
    points = np.array([[i%3*20, i//3*30, .95] for i in range(18)],dtype=float)
    points[:,:2] = points[:,:2]*scale+offset
    return points


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def solid(self,name,color,size=(32,32)):
        Image.new('RGB',size,color).save(self.root/name)

    def test_brightness_boundaries_linear_and_equal_image_weighting(self):
        self.solid('black.png','black',(16,16))
        self.solid('white.png','white',(80,80))
        report=analyze_directory(self.root)
        self.assertAlmostEqual(report['summary']['brightness']['mean'],.5)
        self.assertAlmostEqual(report['summary']['highlights']['mean'],.5)
        self.assertAlmostEqual(report['summary']['shadows']['mean'],.5)
        self.assertAlmostEqual(sum(report['pixel_histogram']),1)
        self.assertAlmostEqual(report['pixel_histogram'][0],.5)
        self.assertAlmostEqual(report['pixel_histogram'][-1],.5)
        gray=measure(Image.new('RGB',(8,8),(128,128,128)))[0]
        self.assertAlmostEqual(gray['linear_luminance'],.21586,places=4)

    def test_exact_duplicates_and_flat_hash_false_positives(self):
        self.solid('one.png','white')
        (self.root/'two.png').write_bytes((self.root/'one.png').read_bytes())
        self.solid('black.png','black')
        r=analyze_directory(self.root)
        self.assertEqual(r['duplicates']['exact_extra'],1)
        self.assertEqual(r['duplicates']['near_count'],0)
        self.assertEqual(r['duplicates']['flat_excluded'],3)

    def test_pattern_near_duplicates_sampling_and_read_only(self):
        a=np.random.default_rng(42).integers(0,256,size=(32,32,3),dtype=np.uint8)
        Image.fromarray(a).save(self.root/'a.png')
        Image.fromarray(a).save(self.root/'b.bmp')
        before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.iterdir()}
        r=analyze_directory(self.root)
        self.assertEqual(r['duplicates']['near_count'],1)
        self.assertEqual(r['duplicates']['exact_extra'],0)
        after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.iterdir()}
        self.assertEqual(before,after)
        for i in range(5): self.solid(f'x{i}.png','gray')
        self.assertEqual(analyze_directory(self.root,pair_limit=3)['duplicates']['sampled'],3)

    def test_empty_corrupt_and_recursive(self):
        self.assertEqual(analyze_directory(self.root)['successful'],0)
        (self.root/'bad.png').write_text('not an image')
        (self.root/'sub').mkdir()
        self.solid('sub/good.png','red')
        r=analyze_directory(self.root)
        self.assertEqual((r['successful'],r['failed']),(1,1))
        self.assertEqual(analyze_directory(self.root,recursive=False)['successful'],0)
        self.assertEqual(set(r['errors'][0]),{'file','error'})

    def test_transparency_and_exif_orientation(self):
        Image.new('RGBA',(12,24),(255,255,255,0)).save(self.root/'transparent.png')
        image=Image.new('RGB',(10,20),'white');exif=Image.Exif();exif[274]=6
        image.save(self.root/'oriented.jpg',exif=exif)
        rows={r['file']:r for r in analyze_directory(self.root)['records']}
        self.assertAlmostEqual(rows['transparent.png']['brightness'],127/255,places=5)
        self.assertEqual(rows['transparent.png']['transparency'],1)
        self.assertEqual((rows['oriented.jpg']['width'],rows['oriented.jpg']['height']),(20,10))

    def test_pose_invariant_to_translation_and_scale_but_not_different_limbs(self):
        a=pose_vector(joints())
        b=pose_vector(joints(100,2))
        self.assertAlmostEqual(pose_distance(a,b),0)
        changed=joints();changed[4,:2]+=[300,-200]
        self.assertGreater(pose_distance(a,pose_vector(changed)),.18)
        missing=joints();missing[8,2]=0
        self.assertIsNone(pose_vector(missing))

    def test_pose_coverage_and_failure_preserve_pixel_analysis(self):
        self.solid('a.png','red');self.solid('b.png','blue')
        detector=lambda image:[{'box':[0,0,16,32],'points':joints().tolist()}]
        r=analyze_directory(self.root,pose=True,detector=detector)
        self.assertEqual(r['pose']['usable'],2)
        self.assertEqual(r['pose']['similar_pairs'],1)
        self.assertAlmostEqual(r['summary']['person_area']['mean'],.5)
        def fail(image):raise RuntimeError('private internal content')
        r=analyze_directory(self.root,pose=True,detector=fail)
        self.assertEqual(r['successful'],2)
        self.assertEqual(r['pose']['attempted'],1)
        self.assertNotIn('private internal content',json.dumps(r))

    def test_caption_opt_in_and_csv_formula_escape(self):
        self.solid('=danger.png','white')
        (self.root/'=danger.txt').write_text('blue_hair, blue_hair, smile',encoding='utf-8')
        r=analyze_directory(self.root)
        self.assertEqual(r['captions']['read'],0)
        r=analyze_directory(self.root,captions=True)
        self.assertEqual(dict(r['captions']['tags']),{'blue hair':1,'smile':1})
        self.assertIn("'=danger.png",csv_report(r))

    def test_invalid_options(self):
        for kwargs in ({'pair_limit':1},{'pose_threshold':float('nan')},{'hash_threshold':99}):
            with self.assertRaises(ValueError):analyze_directory(self.root,**kwargs)

    def test_offline_worker_and_cli_do_not_overwrite(self):
        self.solid('a.png','gray')
        output=self.root/'report.json'
        result=subprocess.run([sys.executable,'-m','dataset_pipeline.analysis',str(self.root),'--output',str(output)],capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        content=output.read_bytes()
        result=subprocess.run([sys.executable,'-m','dataset_pipeline.analysis',str(self.root),'--output',str(output)],capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(output.read_bytes(),content)
        code='from dataset_pipeline.analysis import offline_mode; offline_mode(); import socket; socket.create_connection(("127.0.0.1",80))'
        result=subprocess.run([sys.executable,'-c',code],capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(b'network access is disabled',result.stderr)

    @unittest.skipUnless(os.name == 'nt', 'Windows denies replacement while a reader holds the file')
    def test_progress_reader_cannot_abort_analysis(self):
        self.solid('synthetic.png','gray')
        progress = self.root/'progress.json'
        progress.write_text('{}',encoding='utf-8')
        report = self.root/'report.json'
        with progress.open('rb'):
            result = subprocess.run([sys.executable,'-m','dataset_pipeline.analysis',str(self.root),
                                     '--output',str(report),'--progress',str(progress)],capture_output=True)
        self.assertEqual(result.returncode,0,result.stdout.decode(errors='replace')+result.stderr.decode(errors='replace'))
        self.assertEqual(json.loads(report.read_text(encoding='utf-8'))['successful'],1)

    @unittest.skipUnless(os.name == 'nt', 'Windows file sharing semantics')
    def test_progress_retries_after_reader_releases_file(self):
        progress = self.root/'progress.json'
        write_progress(progress,{'done':1})
        with progress.open('rb'):
            write_progress(progress,{'done':2})
            self.assertEqual(json.loads(progress.read_text())['done'],1)
        write_progress(progress,{'done':3})
        self.assertEqual(json.loads(progress.read_text())['done'],3)

    def test_real_report_errors_are_not_suppressed(self):
        self.solid('synthetic.png','gray')
        error_file = self.root/'error.json'
        result = subprocess.run([sys.executable,'-m','dataset_pipeline.analysis',str(self.root),
            '--output',str(self.root/'missing'/'report.json'),'--error-file',str(error_file)],capture_output=True)
        self.assertEqual(result.returncode,1)
        detail = json.loads(error_file.read_text())
        self.assertEqual(detail['type'],'FileNotFoundError')
        self.assertEqual(detail['stage'],'report')
        self.assertNotIn(str(self.root),error_file.read_text())


class AnalysisHTTPTests(unittest.TestCase):
    def test_404_synthetic_images_with_frequent_status_polling(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image = Image.new('RGB',(16,16),'gray')
            for index in range(404):
                image.save(root/f'{index:04}.png')
            job = AnalysisJob()
            try:
                job.start({'directory':folder})
                deadline = time.monotonic()+30
                polls = 0
                while time.monotonic()<deadline:
                    status = job.status()
                    polls += 1
                    if status['status'] != 'running':
                        break
                    time.sleep(.001)
                self.assertEqual(status['status'],'complete',status)
                self.assertGreater(polls,1)
                report = job.report()
                self.assertEqual(report['successful'],404)
                self.assertEqual(report['duplicates']['compared_pairs'],81406)
            finally:
                job.close()

    def test_failure_diagnostics_hide_raw_paths_and_include_exit_code(self):
        job = AnalysisJob()
        job.temp = tempfile.TemporaryDirectory()
        try:
            folder = Path(job.temp.name)
            (folder/'worker.log').write_text('ModuleNotFoundError: private-path-and-caption\n',encoding='utf-8')
            message = job.failure_message(1)
            self.assertIn('ModuleNotFoundError',message)
            self.assertIn('0x00000001',message)
            self.assertNotIn('private-path',message)
            (folder/'error.json').write_text(json.dumps(dict(type='PermissionError',stage='report',winerror=5)))
            message = job.failure_message(1)
            self.assertIn('JSON',message)
            self.assertIn('WinError 5',message)
            (folder/'error.json').unlink()
            (folder/'worker.log').write_text('')
            self.assertIn('0xC0000005',job.failure_message(0xc0000005))
        finally:
            job.close()

    def test_standalone_auth_background_report_and_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            Image.new('RGB',(32,32),'gray').save(Path(folder)/'synthetic.png')
            server=make_server(None,0)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            try:
                html=requests.get(base).text
                self.assertIn('window.ANALYSIS_ONLY = true',html)
                token=re.search("window.REVIEW_TOKEN = '([^']+)'",html)[1]
                self.assertEqual(requests.get(base+'/analysis.js').status_code,200)
                self.assertEqual(requests.get(base+'/api/state').status_code,404)
                payload={'directory':folder}
                self.assertEqual(requests.post(base+'/api/analysis/start',json=payload).status_code,403)
                headers={'X-Review-Token':token}
                self.assertEqual(requests.post(base+'/api/analysis/start',json=payload,headers=headers).status_code,202)
                deadline=time.monotonic()+20
                while time.monotonic()<deadline:
                    status=requests.get(base+'/api/analysis/status').json()
                    if status['status']!='running':break
                    time.sleep(.05)
                self.assertEqual(status['status'],'complete',status)
                report=requests.get(base+'/api/analysis/report').json()
                self.assertEqual(report['successful'],1)
                self.assertIn('synthetic.png',requests.get(base+'/api/analysis/csv').text)
                self.assertEqual(requests.get(base+'/api/analysis/status',headers={'Host':'evil.test'}).status_code,403)
            finally:
                server.shutdown();server.server_close();thread.join()

    def test_job_rejects_concurrency_and_cancels(self):
        with tempfile.TemporaryDirectory() as folder:
            job=AnalysisJob()
            try:
                job.start({'directory':folder})
                # Keep a deterministic running process for the concurrency/cancel path.
                job.cancel()
                job.process=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'])
                job.state={'status':'running'}
                with self.assertRaises(ValueError):job.start({'directory':folder})
                self.assertEqual(job.cancel()['status'],'cancelled')
                with self.assertRaises(ValueError):job.report()
            finally:job.close()


if __name__=='__main__':unittest.main()

"""Synthetic inputs only. No real datasets, model downloads, or private images."""
import hashlib
import json
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

from tools.analysis.analysis import analyze_directory, csv_report
from webui.server import make_server


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

    def test_brightness_and_histogram_weight_images_equally(self):
        self.solid('black.png','black',(16,16))
        self.solid('white.png','white',(80,80))
        report=analyze_directory(self.root)
        self.assertAlmostEqual(report['summary']['brightness']['mean'],.5)
        self.assertAlmostEqual(report['pixel_histogram'][0],.5)
        self.assertAlmostEqual(report['pixel_histogram'][-1],.5)

    def test_exact_duplicates_and_flat_hash_false_positives(self):
        self.solid('one.png','white')
        (self.root/'two.png').write_bytes((self.root/'one.png').read_bytes())
        self.solid('black.png','black')
        r=analyze_directory(self.root)
        self.assertEqual(r['duplicates']['exact_extra'],1)
        self.assertEqual(r['duplicates']['near_count'],0)

    def test_near_duplicate_detection_leaves_sources_unchanged(self):
        a=np.random.default_rng(42).integers(0,256,size=(32,32,3),dtype=np.uint8)
        Image.fromarray(a).save(self.root/'a.png')
        Image.fromarray(a).save(self.root/'b.bmp')
        before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.iterdir()}
        r=analyze_directory(self.root)
        self.assertEqual(r['duplicates']['near_count'],1)
        self.assertEqual(r['duplicates']['exact_extra'],0)
        after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.iterdir()}
        self.assertEqual(before,after)

    def test_empty_corrupt_and_recursive(self):
        (self.root/'bad.png').write_text('not an image')
        (self.root/'sub').mkdir()
        self.solid('sub/good.png','red')
        r=analyze_directory(self.root)
        self.assertEqual((r['successful'],r['failed']),(1,1))
        self.assertEqual(analyze_directory(self.root,recursive=False)['successful'],0)

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
        self.assertNotIn('private internal content',json.dumps(r))

    def test_caption_opt_in_and_csv_formula_escape(self):
        self.solid('=danger.png','white')
        (self.root/'=danger.txt').write_text('blue_hair, blue_hair, smile',encoding='utf-8')
        r=analyze_directory(self.root)
        self.assertEqual(r['captions']['read'],0)
        r=analyze_directory(self.root,captions=True)
        self.assertEqual(dict(r['captions']['tags']),{'blue hair':1,'smile':1})
        self.assertIn("'=danger.png",csv_report(r))

    def run_worker(self, output):
        request = dict(directory=str(self.root), output=str(output),
                       progress=str(self.root/'progress.json'), error_file=str(self.root/'error.json'),
                       recursive=True, pose=False, captions=False, pair_limit=1500,
                       pose_threshold=.18, hash_threshold=6, model_cache=None)
        return subprocess.run([sys.executable,'-m','tools.analysis.worker'],
                              input=json.dumps(request).encode('utf-8'), capture_output=True)

    def test_offline_worker_does_not_overwrite(self):
        self.solid('a.png','gray')
        output=self.root/'report.json'
        result=self.run_worker(output)
        self.assertEqual(result.returncode,0,result.stderr)
        content=output.read_bytes()
        result=self.run_worker(output)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(output.read_bytes(),content)
        code='from tools.analysis.analysis import offline_mode; offline_mode(); import socket; socket.create_connection(("127.0.0.1",80))'
        result=subprocess.run([sys.executable,'-c',code],capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(b'network access is disabled',result.stderr)

class AnalysisHTTPTests(unittest.TestCase):
    def test_standalone_auth_background_report_and_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            Image.new('RGB',(32,32),'gray').save(Path(folder)/'synthetic.png')
            server=make_server(None,0)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            try:
                session=requests.get(base+'/api/session').json()
                self.assertTrue(session['analysisOnly'])
                token=session['token']
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

if __name__=='__main__':unittest.main()

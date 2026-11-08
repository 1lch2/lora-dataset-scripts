import copy
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image

from core.dataset_pipeline.core import DEFAULTS, Run, asset, file_digest, prepare
from core.dataset_pipeline.geometry import MIN_AREA, TARGET_AREA, area, expand_box, full_body_conflict, propose
from webui.server import make_server


def detection(size):
    w, h = size
    points = [[w * .5, h * .2, 0] for _ in range(24)]
    for left, right, y in [(2, 5, .24), (8, 11, .52), (9, 12, .73), (10, 13, .95), (14, 15, .12)]:
        points[left], points[right] = [w * .4, h * y, .95], [w * .6, h * y, .95]
    return {"persons": [{"box": [int(w*.2), int(h*.04), int(w*.8), int(h*.98)], "score": .96, "points": points}],
            "heads": [{"box": [int(w*.35), int(h*.05), int(w*.65), int(h*.21)], "score": .96}]}


def analyze(image, config):
    info = detection(image.size)
    crops, notes = propose(image.size, info, config["target_area"], config["min_area"], config["duplicate_iou"])
    return {"detection": info, "crops": crops, "notes": notes}


class FakeForge:
    def check(self, tagging=False):
        pass

    def upscale(self, image, scale):
        # Deliberately change color to prove that the full view never uses GAN output.
        return Image.new("RGB", tuple(round(v * scale / 8) * 8 for v in image.size), "blue")

    def tag(self, image):
        return {"full_body": .9, "white_shirt": .8, "wrong_character": .6,
                "rhodes_island_logo_(arknights)": .4}


class GeometryTests(unittest.TestCase):
    def test_expansion_and_total_area_not_short_edge(self):
        box = expand_box([0, 0, 700, 200], (800, 1800))
        self.assertGreaterEqual(area(box), TARGET_AREA)
        self.assertLess(box[2]-box[0], 1024)
        self.assertGreaterEqual(box[1], 0)
        self.assertLessEqual(box[3], 1800)
        tiny = expand_box([0, 0, 100, 100], (500, 800))
        self.assertEqual(tiny, [0, 0, 500, 800])

    def test_crop_candidates_follow_subject_and_image_size(self):
        crops, _ = propose((3000, 6000), detection((3000, 6000)))
        self.assertEqual({c["kind"] for c in crops}, {"head", "upper", "knees", "eyes_calf", "lower"})
        self.assertTrue(all(area(c["box"]) >= MIN_AREA for c in crops))
        small, _ = propose((800, 1200), detection((800, 1200)))
        self.assertEqual(small, [])

    def test_missing_and_multiple_people_are_reviewable(self):
        info = detection((3000, 6000))
        info["persons"].append(copy.deepcopy(info["persons"][0]))
        self.assertEqual(propose((3000, 6000), info)[0], [])
        self.assertTrue(propose((3000, 6000), info, person_index=0)[0])
        info["persons"] = []
        self.assertEqual(propose((3000, 6000), info)[0], [])

    def test_full_body_requires_positive_observation(self):
        size = (3000, 6000)
        info = detection(size)
        self.assertTrue(full_body_conflict([600, 3000, 2400, 6000], info, size))
        self.assertFalse(full_body_conflict([0, 0, *size], info, size))
        self.assertFalse(full_body_conflict(None, info, size))
        info["persons"][0]["points"] = []
        info["heads"] = []
        self.assertFalse(full_body_conflict([600, 3000, 2400, 6000], info, size))

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.input = self.root / "input"
        (self.input / "entelechia (dazzling blue)" / "nested").mkdir(parents=True)
        self.original = self.input / "entelechia (dazzling blue)" / "nested" / "a.jfif"
        Image.new("RGB", (1200, 1800), "red").save(self.original, format="JPEG")
        self.original_hash = file_digest(self.original)
        self.table = self.root / "selected_tags.csv"
        self.table.write_text("name,category\nwrong_character,4\nwhite_shirt,0\nrhodes_island_logo_(arknights),0\n", encoding="utf-8")
        self.config = {**DEFAULTS, "input_dir": str(self.input), "run_dir": str(self.root / "run"),
                       "output_dir": str(self.root / "export"), "tags_csv": str(self.table)}
        self.client = FakeForge()

    def prepared(self):
        run, errors = prepare(self.config, self.client, analyze)
        self.assertEqual(errors, [])
        self.assertEqual(len(run.data["sources"]), 1)
        return run, next(iter(run.data["sources"].values()))

    def accept(self, run, source):
        for candidate in source["candidates"]:
            if candidate["status"] == "pending":
                run.change_crop(source["id"], candidate["id"], status="accepted")

    def test_automatic_upscale_only_below_eighty_percent(self):
        for size, scale, working_size in [((819, 1024), 1.5, [1232, 1536]),
                                           ((820, 1024), 1, [820, 1024])]:
            with self.subTest(size=size):
                Image.new("RGB", size, "red").save(self.original, format="JPEG")
                run, source = self.prepared()
                self.assertEqual(source["scale"], scale)
                self.assertEqual(source["working_size"], working_size)

    def test_end_to_end_and_resume_preserve_source_and_manual_tags(self):
        run, source = self.prepared()
        self.accept(run, source)
        self.assertEqual(run.tag_all(), [])
        full = source["candidates"][0]
        with Image.open(asset(run.directory, full["tag"]["image"])) as image:
            self.assertEqual(image.size, (1200, 1800))
            self.assertGreater(image.getpixel((0, 0))[0], 200)
        selections = [[source["id"], c["id"]] for c in source["candidates"] if c["status"] == "accepted"]
        run.edit_tags(selections, {"mode": "add", "tags": ["special_trigger"]})
        count = run.export()
        captions = list((self.root / "export").rglob("*.txt"))
        self.assertEqual(count, len(captions))
        for caption in captions:
            text = caption.read_text(encoding="utf-8")
            self.assertTrue(text.startswith("entelechia (dazzling blue) (arknights), "))
            self.assertIn("special trigger", text)
            self.assertNotIn("wrong character", text)
            self.assertIn("rhodes island logo (arknights)", text)
        run2, errors = prepare(self.config, self.client, analyze)
        self.assertEqual(errors, [])
        self.assertEqual(run2.tag_all(), [])
        self.assertEqual(run2.export(), count)
        for caption in captions:
            self.assertIn("special trigger", caption.read_text(encoding="utf-8"))
        self.assertEqual(file_digest(self.original), self.original_hash)

    def test_crop_edit_retags_without_overwriting_manual_edits(self):
        run, source = self.prepared()
        self.accept(run, source)
        run.tag_all()
        crop = next(c for c in source["candidates"] if c["box"])
        run.edit_tags([[source["id"], crop["id"]]], {"mode": "add", "tags": ["trigger"]})
        box = crop["box"].copy()
        box[0] = max(0, box[0]-20)
        run.change_crop(source["id"], crop["id"], box, "accepted")
        self.assertFalse(run.current_tag(source, crop))
        run.tag_all()
        self.assertIn("trigger", crop["tag"]["tags"])

    def test_export_overwrites_prior_output_with_current_tags(self):
        run, source = self.prepared()
        for candidate in source["candidates"][1:]:
            run.change_crop(source["id"], candidate["id"], status="rejected")
        run.tag_all()
        run.export()
        caption = next((self.root / "export").rglob("*.txt"))
        run.edit_tags([[source["id"], "full"]], {"mode": "set", "tags": ["new trigger"]})
        self.assertEqual(run.export(), 1)
        self.assertIn("new trigger", caption.read_text(encoding="utf-8"))
        self.assertNotIn("white shirt", caption.read_text(encoding="utf-8"))
        unrelated = self.root / "export" / "unrelated.txt"
        unrelated.write_text("keep me", encoding="utf-8")
        with self.assertRaises(ValueError):
            run.export()
        self.assertEqual(unrelated.read_text(encoding="utf-8"), "keep me")

    def test_interrupted_export_recovers_partial_copy(self):
        run, source = self.prepared()
        for candidate in source["candidates"][1:]:
            run.change_crop(source["id"], candidate["id"], status="rejected")
        run.tag_all()
        original_copy = shutil.copyfile

        def interrupted(src, dst):
            if str(dst).endswith(".txt.tmp"):
                Path(dst).write_text("partial")
                raise OSError("simulated interruption")
            return original_copy(src, dst)

        with patch("core.dataset_pipeline.core.shutil.copyfile", side_effect=interrupted):
            with self.assertRaises(OSError):
                run.export()
        recovered = Run.load(run.directory, client=self.client, analyzer=analyze)
        self.assertEqual(recovered.export(), 1)
        self.assertFalse(list((self.root / "export").rglob("*.tmp")))

    def test_source_change_and_missing_source(self):
        run, source = self.prepared()
        Image.new("RGB", (1200, 1800), "green").save(self.original, format="JPEG")
        self.assertTrue(run.tag_all())
        self.original.unlink()
        self.assertTrue(run.tag_all())

    def test_api_requires_token_and_updates_real_manifest(self):
        run, source = self.prepared()
        server = make_server(run.directory, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}"
        self.assertEqual(requests.post(url + "/api/edit", json={}).status_code, 403)
        token = requests.get(url + '/api/session').json()['token']
        crop = source["candidates"][1]
        response = requests.post(url + "/api/edit", headers={"X-Review-Token": token}, json={
            "action": "crop", "source": source["id"], "candidate": crop["id"], "status": "rejected"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Run.load(run.directory).locate(source["id"], crop["id"])[1]["status"], "rejected")
        self.assertEqual(requests.get(url + "/image?source=../../escape").status_code, 400)

    def test_web_tag_job_retry_progress_and_export(self):
        run, source = self.prepared()
        server = make_server(run.directory, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}"
        token = requests.get(url + '/api/session').json()['token']
        def post(action, **values):
            return requests.post(url + '/api/edit', headers={'X-Review-Token': token},
                                 json={'action': action, **values}, timeout=5)
        def finished():
            for _ in range(150):
                result = requests.get(url + '/api/job', timeout=5).json()
                if result['status'] != 'running':
                    return result
                time.sleep(.05)
            self.fail('Background job did not finish')
        self.assertEqual(post('start_tag').status_code, 400)
        self.accept(run, source)
        self.assertEqual(post('export').status_code, 400)
        with patch('core.dataset_pipeline.core.ForgeClient', return_value=self.client):
            with patch.object(self.client, 'check', side_effect=RuntimeError('Forge unavailable')):
                self.assertEqual(post('start_tag').status_code, 202)
                self.assertEqual(finished()['status'], 'failed')
            entered, release = threading.Event(), threading.Event()
            original_tag = self.client.tag
            def slow_tag(image):
                entered.set()
                release.wait(5)
                return original_tag(image)
            with patch.object(self.client, 'tag', side_effect=slow_tag):
                try:
                    self.assertEqual(post('start_tag').status_code, 202)
                    self.assertTrue(entered.wait(5))
                    self.assertEqual(requests.get(url + '/api/job', timeout=5).json()['status'], 'running')
                    self.assertEqual(requests.get(url + '/api/state', timeout=5).status_code, 200)
                    self.assertEqual(post('start_tag').status_code, 400)
                    self.assertEqual(post('drop_tags', tags=['test']).status_code, 400)
                finally:
                    release.set()
                result = finished()
            self.assertEqual(result['status'], 'complete')
            selections = [[source['id'], c['id']] for c in source['candidates']]
            self.assertEqual(post('export').status_code, 202)
            result = finished()
            self.assertEqual(result['count'], len(selections), result)
            self.assertEqual(len(list(Path(run.config['output_dir']).rglob('*.txt'))), len(selections))
            self.assertEqual(post('tags', selections=[[source['id'], 'full']],
                                  operation={'mode': 'set', 'tags': ['web trigger']}).status_code, 200)
            self.assertEqual(post('export').status_code, 202)
            self.assertEqual(finished()['status'], 'complete')
            caption = Path(run.config['output_dir']) / source['group'] / f"{source['id']}_full.txt"
            self.assertIn('web trigger', caption.read_text(encoding='utf-8'))


if __name__ == "__main__":
    unittest.main()

import copy
import csv
import json
import re
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image

from dataset_pipeline.core import DEFAULTS, Run, asset, digest, file_digest, prepare, read_config, run_lock
from dataset_pipeline.forge import ForgeClient, encode_image
from dataset_pipeline.geometry import MIN_AREA, TARGET_AREA, area, default_scale, expand_box, full_body_conflict, iou, propose, to_original
from dataset_pipeline.review import make_server


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
    def __init__(self):
        self.upscales = 0
        self.tags = 0

    def check(self, tagging=False):
        pass

    def upscale(self, image, scale):
        self.upscales += 1
        # Deliberately change color to prove that the full view never uses GAN output.
        return Image.new("RGB", tuple(round(v * scale / 8) * 8 for v in image.size), "blue")

    def tag(self, image):
        self.tags += 1
        return {"full_body": .9, "white_shirt": .8, "wrong_character": .6,
                "rhodes_island_logo_(arknights)": .4}


class GeometryTests(unittest.TestCase):
    def test_scale_boundaries(self):
        for size, expected in [((819, 1024), 1.5), ((820, 1024), 1),
                               ((1024, 819), 1.5), ((1024, 820), 1),
                               ((800, 1200), 1), ((1023, 1024), 1),
                               ((1024, 1024), 1), ((2047, 2048), 1),
                               ((2048, 2048), 1)]:
            with self.subTest(size=size):
                self.assertEqual(default_scale(size), expected)

    def test_expansion_and_total_area_not_short_edge(self):
        box = expand_box([0, 0, 700, 200], (800, 1800))
        self.assertGreaterEqual(area(box), TARGET_AREA)
        self.assertLess(box[2]-box[0], 1024)
        self.assertGreaterEqual(box[1], 0)
        self.assertLessEqual(box[3], 1800)
        tiny = expand_box([0, 0, 100, 100], (500, 800))
        self.assertEqual(tiny, [0, 0, 500, 800])

    def test_five_crops_and_merge(self):
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

    def test_lower_requires_visible_knees_and_room_below(self):
        size = (3000, 6000)
        for bottom in (3400, 4380, 4500):
            info = detection(size)
            info["persons"][0]["box"][3] = bottom
            crops, notes = propose(size, info)
            self.assertNotIn("lower", {k for c in crops for k in [c["kind"], *c["aliases"]]})
            self.assertTrue(any("膝下范围" in note for note in notes))
        for missing in (9, 12):
            info = detection(size)
            info["persons"][0]["points"][missing][2] = 0
            self.assertNotIn("lower", {c["kind"] for c in propose(size, info)[0]})
        info = detection(size)
        info["persons"][0]["box"][3] = 4800
        self.assertIn("lower", {c["kind"] for c in propose(size, info)[0]})

    def test_full_body_requires_positive_observation(self):
        size = (3000, 6000)
        info = detection(size)
        self.assertTrue(full_body_conflict([600, 3000, 2400, 6000], info, size))
        self.assertFalse(full_body_conflict([0, 0, *size], info, size))
        self.assertFalse(full_body_conflict(None, info, size))
        info["persons"][0]["points"] = []
        info["heads"] = []
        self.assertFalse(full_body_conflict([600, 3000, 2400, 6000], info, size))

    def test_synthetic_neck_is_not_high_confidence_evidence(self):
        info = {"persons": [{"score": .95, "points": [[100, 100, 0], [100, 100, 1]]}], "heads": []}
        self.assertFalse(full_body_conflict([0, 500, 1000, 2000], info, (1000, 2000)))

    def test_mapping_uses_actual_rounded_dimensions(self):
        self.assertEqual(to_original([0, 0, 1504, 2000], (1504, 2000), (1001, 1333)), [0, 0, 1001, 1333])
        self.assertEqual(iou([0,0,100,100], [0,0,100,100]), 1)


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
        for size, scale, calls in [((819, 1024), 1.5, 1), ((820, 1024), 1, 1),
                                   ((1024, 1024), 1, 1), ((1200, 1800), 1, 1)]:
            with self.subTest(size=size):
                Image.new("RGB", size, "red").save(self.original, format="JPEG")
                run, source = self.prepared()
                self.assertEqual(source["scale"], scale)
                self.assertEqual(self.client.upscales, calls)
                if scale == 1:
                    self.assertEqual(source["working_size"], list(size))
                else:
                    self.assertEqual(source["working_size"], [round(v * scale / 8) * 8 for v in size])
                self.assertFalse(run.prepare_source(source))
                self.assertEqual(self.client.upscales, calls)

    def test_end_to_end_and_resume_preserve_source_and_manual_tags(self):
        run, source = self.prepared()
        self.accept(run, source)
        self.assertEqual(run.tag_all(), [])
        first_calls = self.client.tags
        for candidate in source["candidates"]:
            if candidate.get("tag"):
                tag = candidate["tag"]
                self.assertEqual(asset(run.directory, tag["image"]).with_suffix(".txt").read_text(encoding="utf-8"), ", ".join(tag["tags"]) + "\n")
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
        self.assertEqual(self.client.tags, first_calls)
        self.assertEqual(self.client.upscales, 0)
        self.assertEqual(run2.export(), count)
        self.assertEqual(file_digest(self.original), self.original_hash)

    def test_reexport_uses_latest_tags_without_confirmation(self):
        run, source = self.prepared()
        for candidate in source["candidates"][1:]:
            run.change_crop(source["id"], candidate["id"], status="rejected")
        run.tag_all()
        self.assertEqual(run.export(), 1)
        caption = next((self.root / "export").rglob("*.txt"))
        run.edit_tags([[source["id"], "full"]], {"mode": "set", "tags": ["new trigger"]})
        self.assertEqual(run.export(), 1)
        self.assertIn("new trigger", caption.read_text(encoding="utf-8"))
        self.assertNotIn("white shirt", caption.read_text(encoding="utf-8"))

    def test_scale_change_preserves_full_and_manual_operations(self):
        run, source = self.prepared()
        self.accept(run, source)
        run.tag_all()
        crop = next(c for c in source["candidates"] if c["box"])
        run.edit_tags([[source["id"], crop["id"]]], {"mode": "add", "tags": ["trigger"]})
        full_key = source["candidates"][0]["tag"]["key"]
        run.prepare_source(source, 1.5)
        self.assertEqual(source["candidates"][0]["tag"]["key"], full_key)
        self.assertTrue(run.current_tag(source, source["candidates"][0]))
        for candidate in source["candidates"][1:]:
            if candidate.get("tag"):
                self.assertFalse(run.current_tag(source, candidate))
        self.assertTrue(source["history"])

    def test_tags_original_and_unscaled_crops_before_materializing(self):
        Image.new("RGB", (1500, 2100), "red").save(self.original, format="JPEG")
        run, source = self.prepared()
        self.accept(run, source)
        candidates = [c for c in source["candidates"] if c["status"] == "accepted"]
        events = []
        materialize = run._materialize

        def tag(image):
            candidate = candidates[len(events) // 2]
            events.append(("tag", candidate["id"]))
            if candidate["box"] is None:
                self.assertEqual(image, self.original)
            else:
                x1, y1, x2, y2 = candidate["box"]
                self.assertEqual(image.size, (x2 - x1, y2 - y1))
            return {"white_shirt": .8}

        def save(source, candidate, key):
            self.assertEqual(events[-1], ("tag", candidate["id"]))
            events.append(("save", candidate["id"]))
            return materialize(source, candidate, key)

        with patch.object(self.client, "tag", side_effect=tag), patch.object(run, "_materialize", side_effect=save):
            self.assertEqual(run.tag_all(), [])
        self.assertEqual(len(events), 2 * len(candidates))
        full = next(c for c in candidates if c["box"] is None)
        with Image.open(asset(run.directory, full["tag"]["image"])) as image:
            self.assertEqual(image.size, (1280, 1792))

    def test_lower_rule_upgrade_preserves_existing_and_edited_crops(self):
        run, source = self.prepared()
        baseline = copy.deepcopy(source)
        for preserve in (None, 'accepted', 'rejected', 'edited', 'tagged'):
            source.clear()
            source.update(copy.deepcopy(baseline))
            source['proposal_version'] = 2
            source['detection']['persons'][0]['points'][9][2] = 0
            lower = next(c for c in source['candidates'] if c['kind'] == 'lower')
            if preserve in ('accepted', 'rejected'):
                lower['status'] = preserve
            elif preserve == 'edited':
                lower['box_history'] = [lower['box'][:]]
            elif preserve == 'tagged':
                lower['tag'] = {'operations': [{'mode': 'add', 'tags': ['trigger']}]}
            others = copy.deepcopy([c for c in source['candidates'] if c['kind'] != 'lower'])
            self.assertTrue(run.prepare_source(source))
            self.assertEqual([c for c in source['candidates'] if c['kind'] != 'lower'], others)
            self.assertEqual(any(c['kind'] == 'lower' for c in source['candidates']), preserve is not None)
            self.assertFalse(run.prepare_source(source))
        self.assertEqual(self.client.upscales, 0)

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
        self.assertNotIn("reviewed", crop["tag"])

    def test_reject_tiny_outside_duplicate_and_pending_export(self):
        run, source = self.prepared()
        with self.assertRaises(ValueError):
            run.change_crop(source["id"], box=[-1,0,1500,1500], status="accepted")
        with self.assertRaises(ValueError):
            run.change_crop(source["id"], box=[0,0,10,10], status="accepted")
        with self.assertRaises(ValueError):
            run.export()

    def test_export_overwrites_prior_output_with_current_tags(self):
        run, source = self.prepared()
        for candidate in source["candidates"][1:]:
            run.change_crop(source["id"], candidate["id"], status="rejected")
        run.tag_all()
        run.export()
        caption = next((self.root / "export").rglob("*.txt"))
        caption.write_text("external edit", encoding="utf-8")
        self.assertEqual(run.export(), 1)
        self.assertNotIn("external edit", caption.read_text(encoding="utf-8"))
        unrelated = self.root / "export" / "unrelated.txt"
        unrelated.write_text("keep me", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "非本运行生成"):
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

        with patch("dataset_pipeline.core.shutil.copyfile", side_effect=interrupted):
            with self.assertRaises(OSError):
                run.export()
        recovered = Run.load(run.directory, client=self.client, analyzer=analyze)
        self.assertEqual(recovered.export(), 1)
        self.assertFalse(list((self.root / "export").rglob("*.tmp")))

    def test_threshold_change_requires_retag(self):
        run, source = self.prepared()
        run.tag_all()
        run.config["tag_threshold"] = .4
        self.assertFalse(run.current_tag(source, source["candidates"][0]))
        run.tag_all()
        self.assertTrue(run.current_tag(source, source["candidates"][0]))

    def test_source_change_and_missing_source(self):
        run, source = self.prepared()
        Image.new("RGB", (1200, 1800), "green").save(self.original, format="JPEG")
        self.assertIn("源文件已变化", run.tag_all()[0])
        self.original.unlink()
        self.assertTrue(run.tag_all())

    def test_explicit_trigger_survives_export_drop_list(self):
        run, source = self.prepared()
        for candidate in source["candidates"][1:]:
            run.change_crop(source["id"], candidate["id"], status="rejected")
        run.tag_all()
        selections = [[source["id"], "full"]]
        run.data["drop_tags_override"] = ["white shirt"]
        run.edit_tags(selections, {"mode": "add", "tags": ["white shirt"]})
        run2, _ = prepare(self.config, self.client, analyze)
        self.assertEqual(run2.data["drop_tags_override"], ["white shirt"])
        run2.export()
        self.assertIn("white shirt", next((self.root / "export").rglob("*.txt")).read_text())

    def test_single_flat_image_identity(self):
        self.config["input_dir"] = str(self.original.parent)
        self.config["identity"] = "entelechia (dazzling blue)"
        _, source = self.prepared()
        self.assertEqual(source["group"], self.config["identity"])

    def test_same_name_in_subfolders_stays_unique(self):
        other = self.original.parent.parent / "a.jfif"
        shutil_copy = self.original.read_bytes()
        other.write_bytes(shutil_copy)
        run, errors = prepare(self.config, self.client, analyze)
        self.assertEqual(errors, [])
        self.assertEqual(len(run.data["sources"]), 2)

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
        with patch("dataset_pipeline.review.os.startfile") as open_directory:
            self.assertEqual(requests.post(url + "/api/edit", json={"action": "open_workdir"}).status_code, 403)
            open_directory.assert_not_called()
            response = requests.post(url + "/api/edit", headers={"X-Review-Token": token},
                                     json={"action": "open_workdir", "path": "C:/untrusted"})
            self.assertEqual(response.status_code, 200)
            open_directory.assert_called_once_with(run.directory)

    def test_bad_paths_and_lock(self):
        config = self.root / "config.json"
        config.write_text(json.dumps({"input_dir": "input", "run_dir": "input/work"}))
        with self.assertRaises(ValueError):
            read_config(config)
        with run_lock(self.root / "lock"):
            with self.assertRaises(ValueError):
                with run_lock(self.root / "lock"):
                    pass

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
        with patch('dataset_pipeline.core.ForgeClient', return_value=self.client):
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
            self.assertEqual(result['done'], result['total'])
            count = self.client.tags
            self.assertEqual(post('start_tag').status_code, 202)
            self.assertEqual(finished()['status'], 'complete')
            self.assertEqual(self.client.tags, count)
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


class ForgeTests(unittest.TestCase):
    def test_exact_payload_and_dimension_rounding(self):
        client = ForgeClient(DEFAULTS)
        image = Image.new("RGB", (1001, 1001))
        result = Image.new("RGB", (1504, 1504))
        with patch.object(client, "request", return_value={"image": encode_image(result)}) as request:
            self.assertEqual(client.upscale(image, 1.5).size, (1504, 1504))
            payload = request.call_args.kwargs["json"]
            self.assertEqual(payload["extras_upscaler_2_visibility"], .3)
            self.assertEqual(payload["gfpgan_visibility"], 0)
            self.assertEqual(payload["codeformer_visibility"], 0)


if __name__ == "__main__":
    unittest.main()

import copy
import tempfile
import unittest
from pathlib import Path

from dataset_pipeline.core import Run, apply_tag_operation, edited_tags, manual_additions


class TagEditingTests(unittest.TestCase):
    def test_batch_dedupe_previews_and_saves_each_sidecar_independently(self):
        with tempfile.TemporaryDirectory() as temporary:
            run = self.make_run(Path(temporary))
            captions = [run.directory / f"images/{i}.txt" for i in (0, 1)]
            captions[0].write_text("blue hair, white shirt, blue_hair\n", encoding="utf-8")
            captions[1].write_text("red hair, red hair, white shirt\n", encoding="utf-8")
            targets = [["0", "full"], ["1", "full"]]
            before = [p.read_bytes() for p in captions]
            preview = run.edit_tags(targets, {"mode": "dedupe"}, preview=True)
            self.assertEqual(preview["changed"], 2)
            self.assertEqual([p.read_bytes() for p in captions], before)
            run.edit_tags(targets, {"mode": "dedupe"})
            self.assertEqual(captions[0].read_text(), "blue hair, white shirt\n")
            self.assertEqual(captions[1].read_text(), "red hair, white shirt\n")
            self.assertEqual(run.edit_tags(targets, {"mode": "dedupe"}, preview=True)["changed"], 0)

    def test_match_modes_and_empty_replacement(self):
        tags = ["blue hair", "blue skirt", "dark blue", "blue"]
        cases = [("exact", ["blue hair", "blue skirt", "dark blue", "red"]),
                 ("prefix", ["red hair", "red skirt", "dark blue", "red"]),
                 ("suffix", ["blue hair", "blue skirt", "dark red", "red"]),
                 ("contains", ["red hair", "red skirt", "dark red", "red"])]
        for match, expected in cases:
            self.assertEqual(apply_tag_operation(tags, {"mode": "match", "match": match, "search": "blue", "new": "red"}), expected)
        self.assertEqual(apply_tag_operation(tags, {"mode": "match", "match": "contains", "search": "blue", "new": ""}), [])

    def test_regex_groups_case_and_invalid_references(self):
        operation = {"mode": "match", "match": "regex", "search": r"^(blue|red) (.*)$", "new": r"green \g<2>"}
        self.assertEqual(apply_tag_operation(["blue hair", "red skirt", "white shirt"], operation), ["green hair", "green skirt", "white shirt"])
        self.assertEqual(apply_tag_operation(["BLUE hair"], {**operation, "case_sensitive": False}), ["green hair"])
        for bad in ({"search": "["}, {"new": r"\g<9>"}):
            with self.assertRaises(ValueError):
                apply_tag_operation([], {**operation, **bad})

    def test_prepend_sort_and_deduplicate(self):
        self.assertEqual(apply_tag_operation(["blue", "red"], {"mode": "add", "tags": ["red", "trigger"], "prepend": True}), ["red", "trigger", "blue"])
        self.assertEqual(apply_tag_operation(["zebra", "apple", "blue"], {"mode": "sort", "by": "frequency", "order": "desc", "counts": {"zebra": 2, "apple": 2, "blue": 3}}), ["blue", "apple", "zebra"])
        self.assertEqual(apply_tag_operation(["zebra", "apple"], {"mode": "sort", "by": "alpha", "order": "asc"}), ["apple", "zebra"])

    def test_replay_preserves_manual_replacement_for_export(self):
        tag = {"raw": ["blue hair", "character name"], "auto_removed": [], "operations": [
            {"mode": "match", "match": "exact", "search": "blue hair", "new": "new_character, trigger"}]}
        tag["tags"] = edited_tags(tag)
        self.assertEqual(tag["tags"], ["new character", "trigger", "character name"])
        self.assertEqual(manual_additions(tag), {"new character", "trigger"})

    def make_run(self, root):
        run = Run.__new__(Run)
        run.directory = root
        run.data = {"sources": {}}
        for number, tags in enumerate((["blue hair", "white shirt"], ["red hair", "white shirt"])):
            sid = str(number)
            tag = {"image": f"images/{sid}.png", "raw": tags, "tags": tags[:], "auto_removed": [], "operations": []}
            run.data["sources"][sid] = {"id": sid, "relative": sid + ".png", "active": True,
                "candidates": [{"id": "full", "kind": "full", "status": "accepted", "tag": tag}]}
            run.write_tag_file(tag)
        run.current_tag = lambda source, candidate: True
        run.save()
        return run

    def test_preview_is_read_only_and_apply_only_changes_matches(self):
        with tempfile.TemporaryDirectory() as temporary:
            run = self.make_run(Path(temporary))
            before = copy.deepcopy(run.data)
            disk = (run.directory / "manifest.json").read_bytes()
            targets = [["0", "full"], ["1", "full"]]
            operation = {"mode": "match", "match": "prefix", "search": "blue", "new": "green"}
            preview = run.edit_tags(targets, operation, preview=True)
            self.assertEqual((preview["total"], preview["changed"]), (2, 1))
            self.assertEqual(run.data, before)
            self.assertEqual((run.directory / "manifest.json").read_bytes(), disk)
            self.assertEqual(run.edit_tags(targets, operation), preview)
            self.assertNotIn("reviewed", run.locate("0", "full")[1]["tag"])
            self.assertNotIn("reviewed", run.locate("1", "full")[1]["tag"])
            run.edit_tags([["0", "full"]], {"mode": "restore"})
            self.assertEqual(run.locate("0", "full")[1]["tag"]["tags"], ["blue hair", "white shirt"])

    def test_invalid_batch_is_atomic_and_sort_counts_use_all_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            run = self.make_run(Path(temporary))
            before = copy.deepcopy(run.data)
            targets = [["0", "full"], ["1", "full"]]
            with self.assertRaises(ValueError):
                run.edit_tags(targets, {"mode": "match", "match": "regex", "search": "[", "new": "x"})
            self.assertEqual(run.data, before)
            run.edit_tags(targets, {"mode": "sort", "by": "frequency", "order": "desc"})
            for sid in ("0", "1"):
                self.assertEqual(run.locate(sid, "full")[1]["tag"]["tags"][0], "white shirt")
            run.edit_tags([["0", "full"]], {"mode": "set", "tags": ["trigger", "trigger"]})
            self.assertEqual(run.locate("0", "full")[1]["tag"]["tags"], ["trigger"])

    def test_external_txt_is_read_before_edit_and_preserved_in_replay(self):
        with tempfile.TemporaryDirectory() as temporary:
            run = self.make_run(Path(temporary))
            caption = run.directory / "images/0.txt"
            caption.write_text("external_tag, blue hair\n", encoding="utf-8-sig")
            run.read_tag_files()
            tag = run.locate("0", "full")[1]["tag"]
            self.assertEqual(tag["tags"], ["external tag", "blue hair"])
            self.assertNotIn("reviewed", tag)
            self.assertEqual(edited_tags(tag), tag["tags"])
            run.edit_tags([["0", "full"]], {"mode": "add", "tags": ["new tag"]})
            self.assertEqual(caption.read_text(encoding="utf-8"), "external tag, blue hair, new tag\n")
            caption.write_text("", encoding="utf-8")
            run.read_tag_files()
            self.assertEqual(tag["tags"], [])

    def test_backfill_only_creates_missing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            run = self.make_run(Path(temporary))
            for sid in ("0", "1"):
                (run.directory / f"images/{sid}.png").touch()
            (run.directory / "images/0.txt").unlink()
            (run.directory / "images/1.txt").write_text("custom", encoding="utf-8")
            self.assertEqual(run.ensure_tag_files(), 1)
            self.assertEqual((run.directory / "images/0.txt").read_text(), "blue hair, white shirt\n")
            self.assertEqual((run.directory / "images/1.txt").read_text(), "custom")
            self.assertEqual(run.ensure_tag_files(), 0)

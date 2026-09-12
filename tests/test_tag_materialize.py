import base64
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from dataset_pipeline.core import DEFAULTS, Run
from dataset_pipeline.forge import ForgeClient, encode_image
from resize import resize_images_in_folder


class MaterializeTests(unittest.TestCase):
    def test_pixels_match_legacy_resize_for_full_and_cropped_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = Run.__new__(Run)
            run.directory = root
            run.config = {"min_area": 1}
            image = Image.effect_noise((1501, 1703), 64).convert("RGB")
            image.save(root / "source.png")
            source = {"id": "source", "original": "source.png", "working": "source.png"}
            for index, box in enumerate((None, [10, 20, 1401, 1650], [10, 20, 510, 720])):
                with self.subTest(box=box):
                    legacy = root / "legacy"
                    folder = legacy / "identity"
                    folder.mkdir(parents=True, exist_ok=True)
                    expected = image.copy() if box is None else image.crop(box)
                    expected.save(folder / "image.png")
                    resize_images_in_folder(str(legacy), 1280, False)
                    candidate = {"id": str(index), "kind": "full" if box is None else "head", "box": box}
                    relative = run._materialize(source, candidate, "test")
                    self.assertEqual(Path(relative).parent, Path("images"))
                    self.assertTrue(Path(relative).name.startswith("source_"))
                    with Image.open(root / relative) as actual, Image.open(folder / "image.png") as expected:
                        self.assertEqual(actual.size, expected.size)
                        self.assertEqual(actual.mode, expected.mode)
                        self.assertEqual(actual.tobytes(), expected.tobytes())
                    with patch.object(Image, "open", side_effect=AssertionError("cache was ignored")):
                        self.assertEqual(run._materialize(source, candidate, "test"), relative)

    def test_failed_save_does_not_leave_cached_image(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = Run.__new__(Run)
            run.directory = root
            run.config = {"min_area": 1}
            Image.new("RGB", (10, 10)).save(root / "source.png")
            source = {"id": "s", "original": "source.png"}
            candidate = {"id": "c", "kind": "full", "box": None}

            def fail_save(image, path, **kwargs):
                Path(path).write_bytes(b"partial")
                raise OSError("disk full")

            with patch.object(Image.Image, "save", fail_save), self.assertRaises(OSError):
                run._materialize(source, candidate, "test")
            self.assertEqual(list((root / "images").iterdir()), [])

    def test_api_png_preserves_alpha_and_pixels(self):
        image = Image.new("RGBA", (31, 47), (12, 34, 56, 78))
        with Image.open(io.BytesIO(base64.b64decode(encode_image(image)))) as decoded:
            self.assertEqual(decoded.mode, image.mode)
            self.assertEqual(decoded.tobytes(), image.tobytes())

    def test_tagger_sends_original_jpeg_bytes_without_transcoding(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "original.jpg"
            Image.new("RGB", (1500, 1700), "red").save(path)
            client = ForgeClient(DEFAULTS)
            with patch.object(client, "request", return_value={"caption": {"tag": {}}}) as request, \
                    patch("dataset_pipeline.forge.encode_image", side_effect=AssertionError("transcoded")):
                client.tag(path)
            self.assertEqual(base64.b64decode(request.call_args.kwargs["json"]["image"]), path.read_bytes())

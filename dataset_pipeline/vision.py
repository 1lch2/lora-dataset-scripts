"""waifuc extension; expensive model imports happen only during preparation."""
import os
from pathlib import Path
from .geometry import propose


def detect(image):
    from imgutils.detect import detect_heads, detect_person
    from imgutils.pose import dwpose_estimate

    persons = detect_person(image, level="m", version="v1.1", conf_threshold=0.3)
    heads = detect_heads(image, model_name="head_detect_v2.0_s", conf_threshold=0.4)
    poses = dwpose_estimate(image, auto_detect=False, out_bboxes=[p[0] for p in persons]) if persons else []
    return {
        "persons": [{"box": [int(v) for v in p[0]], "score": float(p[2]),
                     "points": poses[i].all.tolist() if i < len(poses) else []}
                    for i, p in enumerate(persons)],
        "heads": [{"box": [int(v) for v in p[0]], "score": float(p[2])} for p in heads],
    }


def analyze(image, config):
    os.environ.setdefault("HF_HOME", str(Path(config["run_dir"]).parent / ".models"))
    from waifuc.action import ProcessAction
    from waifuc.model import ImageItem
    from waifuc.source.base import BaseDataSource

    class ImageSource(BaseDataSource):
        def _iter(self):
            # Read only our own image and metadata, not downloaded pickle sidecars.
            yield ImageItem(image)

    class CropProposalAction(ProcessAction):
        def process(self, item):
            detection = detect(item.image)
            crops, notes = propose(item.image.size, detection, config["target_area"],
                                   config["min_area"], config["duplicate_iou"])
            return ImageItem(item.image, {"detection": detection, "crops": crops, "notes": notes})

    return next(iter(ImageSource().attach(CropProposalAction()))).meta

import copy
import csv
import hashlib
import json
import math
import os
import shutil
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageOps

from edit_caption import process_text_files_in_dataset
from resize import resize_images_in_folder
from .forge import ForgeClient
from .geometry import MIN_AREA, TARGET_AREA, area, default_scale, full_body_conflict, iou, propose, tag_suggestions, validate_box


DEFAULTS = {
    "input_dir": "dataset-raw", "run_dir": "runs/default", "output_dir": "dataset-ready",
    "forge_url": "http://127.0.0.1:7860", "upscaler_1": "4x-UltraSharpV2", "upscaler_2": "ScuNET",
    "blend": 0.3, "tagger_model": "wd-eva02-large-tagger-v3", "tag_threshold": 0.3,
    "target_area": TARGET_AREA, "min_area": MIN_AREA, "duplicate_iou": 0.95,
    "copyright": "arknights", "drop_tags": [], "tags_csv": "",
    "identity": "",
}
EXTENSIONS = {".png", ".jpg", ".jpeg", ".jfif", ".webp", ".bmp", ".tif", ".tiff", ".gif"}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def file_digest(path):
    sha = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def inside(path, root):
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
        return True
    except ValueError:
        return False


def asset(run_dir, relative):
    path = (Path(run_dir) / relative).resolve()
    if not inside(path, run_dir):
        raise ValueError("路径超出工作目录")
    return path


def read_config(path):
    path = Path(path).resolve()
    values = json.loads(path.read_text(encoding="utf-8-sig"))
    unknown = set(values) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"未知配置项: {sorted(unknown)}")
    config = {**DEFAULTS, **values}
    for key in ("input_dir", "run_dir", "output_dir", "tags_csv"):
        if config[key]:
            config[key] = str((path.parent / config[key]).resolve())
    validate_config(config)
    return config


def validate_config(config):
    roots = [Path(config[key]).resolve() for key in ("input_dir", "run_dir", "output_dir")]
    for i, root in enumerate(roots):
        for other in roots[i + 1:]:
            if inside(root, other) or inside(other, root):
                raise ValueError("输入、工作和输出目录不能相同或互相包含")
    if not 0 < config["min_area"] <= config["target_area"]:
        raise ValueError("像素下限必须大于零且不超过目标")
    for key in ("blend", "tag_threshold", "duplicate_iou"):
        if not math.isfinite(config[key]) or not 0 <= config[key] <= 1:
            raise ValueError(f"{key} 必须在 0 到 1 之间")
    if config["duplicate_iou"] == 0:
        raise ValueError("duplicate_iou 必须大于零")
    if urlparse(config["forge_url"]).scheme not in ("http", "https"):
        raise ValueError("forge_url 必须是 HTTP 地址")
    if not isinstance(config["drop_tags"], list) or any(not isinstance(t, str) for t in config["drop_tags"]):
        raise ValueError("drop_tags 必须是标签列表")
    identity = config["identity"]
    if identity and (identity in (".", "..") or any(c in identity for c in '/\\:*?"<>|') or identity.endswith((".", " "))):
        raise ValueError("identity 必须是可用的单层目录名")


@contextmanager
def run_lock(directory):
    """OS lock, released even on process termination; review and CLI cannot race."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / ".lock").open("a+b") as stream:
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise ValueError("此运行正由另一个命令或审核操作处理，请稍后重试") from error
        try:
            yield
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


class Run:
    def __init__(self, directory, data, client=None, analyzer=None):
        self.directory = Path(directory).resolve()
        self.data = data
        self.config = data["config"]
        validate_config(self.config)
        if Path(self.config["run_dir"]).resolve() != self.directory:
            raise ValueError("运行目录与记录不一致")
        self.client = client or ForgeClient(self.config)
        self.analyzer = analyzer

    @classmethod
    def load(cls, directory, **kwargs):
        data = json.loads((Path(directory) / "manifest.json").read_text(encoding="utf-8"))
        if data.get("version") != 1:
            raise ValueError("不支持的运行记录版本")
        return cls(directory, data, **kwargs)

    def save(self):
        self.data["updated_at"] = time.time()
        atomic_json(self.directory / "manifest.json", self.data)

    def _prepare_key(self, fingerprint, scale):
        keys = ("forge_url", "upscaler_1", "upscaler_2", "blend", "target_area", "min_area", "duplicate_iou")
        return digest([fingerprint, scale, {k: self.config[k] for k in keys}, "crop-v1-imgutils-0.19.0"])

    def prepare_source(self, record, scale=None):
        started = time.monotonic()
        source = Path(record["source_path"])
        if not inside(source, self.config["input_dir"]):
            raise ValueError("源文件超出输入目录")
        fingerprint = file_digest(source)
        with Image.open(source) as image:
            original = ImageOps.exif_transpose(image).copy()
        if original.mode not in ("RGB", "RGBA"):
            original = original.convert("RGBA" if "transparency" in original.info else "RGB")
        selected_scale = scale if scale is not None else record.get("scale_override", default_scale(original.size))
        if selected_scale not in (1, 1.5, 2):
            raise ValueError("倍率只能为 1、1.5 或 2")
        key = self._prepare_key(fingerprint, selected_scale)
        cached = (record.get("prepare_key") == key and not record.get("error")
                and asset(self.directory, record["original"]).is_file()
                and asset(self.directory, record["working"]).is_file())
        if cached and record.get("proposal_version") == 3:
            return False
        if cached and record.get("proposal_version") == 2:
            crops, notes = propose(record["working_size"], record["detection"],
                                   self.config["target_area"], self.config["min_area"],
                                   self.config["duplicate_iou"], record.get("person_index"))
            lower_allowed = any(c["kind"] == "lower" or "lower" in c["aliases"] for c in crops)
            record.setdefault("history", []).append({"at": time.time(), "working": record["working"],
                                                       "candidates": copy.deepcopy(record["candidates"])})
            if not lower_allowed:
                record["candidates"] = [c for c in record["candidates"]
                                        if not (c["kind"] == "lower" and c["status"] == "pending"
                                                and not c.get("box_history") and not c.get("tag"))]
                for candidate in record["candidates"]:
                    candidate["aliases"] = [k for k in candidate.get("aliases", []) if k != "lower"]
            record.update(proposal_version=3, notes=notes)
            self.save()
            return True
        original_path = f"original/{record['id']}-{fingerprint[:16]}.png"
        original_file = asset(self.directory, original_path)
        original_file.parent.mkdir(parents=True, exist_ok=True)
        if not original_file.exists():
            original.save(original_file)
        working_path = f"working/{record['id']}-{key[:16]}.png"
        working_file = asset(self.directory, working_path)
        working_file.parent.mkdir(parents=True, exist_ok=True)
        if working_file.exists():
            with Image.open(working_file) as image:
                working = image.copy()
        else:
            if selected_scale != 1:
                self.client.check()
                working = self.client.upscale(original, selected_scale)
            else:
                working = original.copy()
            working.save(working_file)
        if cached:
            crops, notes = propose(working.size, record["detection"], self.config["target_area"],
                                   self.config["min_area"], self.config["duplicate_iou"])
            analysis = {"detection": record["detection"], "crops": crops, "notes": notes}
        elif self.analyzer is None:
            from .vision import analyze
            analysis = analyze(working, self.config)
        else:
            analysis = self.analyzer(working, self.config)
        old_candidates = {c["id"]: c for c in record.get("candidates", [])}
        if old_candidates:
            record.setdefault("history", []).append({
                "at": time.time(), "working": record.get("working"),
                "candidates": copy.deepcopy(record["candidates"]),
            })
        candidates = [{"id": "full", "kind": "full", "box": None, "aliases": [], "status": "accepted"},
                      *analysis["crops"]]
        for candidate in candidates:
            previous = old_candidates.get(candidate["id"], {})
            if previous.get("tag"):
                candidate["tag"] = copy.deepcopy(previous["tag"])
                if candidate["id"] != "full" or fingerprint != record.get("fingerprint"):
                    candidate["tag"]["stale"] = True
                    candidate["tag"]["reviewed"] = False
        record.update(fingerprint=fingerprint, original=original_path, working=working_path,
                      original_size=list(original.size), working_size=list(working.size),
                      scale=selected_scale, prepare_key=key, candidates=candidates,
                      detection=analysis["detection"], notes=analysis["notes"],
                      proposal_version=3,
                      prepare_seconds=round(time.monotonic() - started, 3))
        record.pop("error", None)
        record.pop("person_index", None)
        if scale is not None:
            record["scale_override"] = scale
        self.save()
        return True

    def locate(self, source_id, candidate_id=None):
        source = self.data["sources"].get(source_id)
        if not source or not source.get("active", True):
            raise ValueError("图片不存在或已移出输入目录")
        if candidate_id is None:
            return source
        candidate = next((c for c in source.get("candidates", []) if c["id"] == candidate_id), None)
        if candidate is None:
            raise ValueError("裁切候选不存在")
        return source, candidate

    def change_crop(self, source_id, candidate_id=None, box=None, status=None):
        source = self.locate(source_id)
        if source.get("error"):
            raise ValueError("请先重新 prepare 修复图片处理错误")
        if candidate_id is None:
            box = validate_box(box, source["working_size"])
            number = 1 + max([int(c["id"].split("_")[-1]) for c in source["candidates"]
                              if c["id"].startswith("manual_")] or [0])
            candidate = {"id": f"manual_{number}", "kind": "manual", "box": box,
                         "aliases": [], "status": "pending"}
            source["candidates"].append(candidate)
        else:
            _, candidate = self.locate(source_id, candidate_id)
        if candidate["kind"] == "full":
            raise ValueError("完整原图固定保留，不可修改裁框")
        if box is not None:
            box = validate_box(box, source["working_size"])
            if box != candidate["box"]:
                candidate.setdefault("box_history", []).append(candidate["box"])
                candidate["box"] = box
                candidate["status"] = "pending"
                if candidate.get("tag"):
                    candidate["tag"].update(stale=True, reviewed=False)
        if status is not None:
            if status not in ("pending", "accepted", "rejected"):
                raise ValueError("无效审核状态")
            if status == "accepted":
                if area(candidate["box"]) < self.config["min_area"]:
                    raise ValueError("裁片不足像素下限，请扩大范围")
                if iou(candidate["box"], [0, 0, *source["working_size"]]) >= self.config["duplicate_iou"]:
                    raise ValueError("与完整构图重复")
                for other in source["candidates"]:
                    if other is not candidate and other["box"] and other["status"] == "accepted":
                        if iou(candidate["box"], other["box"]) >= self.config["duplicate_iou"]:
                            raise ValueError("与已接受裁片重复，请只保留一张")
            candidate["status"] = status
        self.save()
        return candidate

    def select_person(self, source_id, index):
        source = self.locate(source_id)
        crops, notes = propose(source["working_size"], source["detection"], self.config["target_area"],
                               self.config["min_area"], self.config["duplicate_iou"], index)
        source.setdefault("history", []).append({"at": time.time(), "working": source["working"],
                                                  "candidates": copy.deepcopy(source["candidates"])})
        previous = {c["id"]: c for c in source["candidates"]}
        for crop in crops:
            if previous.get(crop["id"], {}).get("tag"):
                crop["tag"] = copy.deepcopy(previous[crop["id"]]["tag"])
                crop["tag"].update(stale=True, reviewed=False)
        source["candidates"] = [previous["full"], *crops]
        source.update(notes=notes, person_index=index)
        self.save()

    def tag_key(self, source, candidate):
        image_key = source["fingerprint"] if candidate["kind"] == "full" else source["prepare_key"]
        return digest([image_key, candidate["box"], 1280, self.config["tagger_model"],
                       self.config["tag_threshold"],
                       source.get("detection") if candidate["box"] else None, "tag-v1"])

    def current_tag(self, source, candidate):
        tag = candidate.get("tag")
        return bool(tag and not tag.get("stale") and tag["key"] == self.tag_key(source, candidate))

    def _materialize(self, source, candidate, key):
        relative = f"images/{source['id']}/{candidate['id']}-{key[:16]}.png"
        destination = asset(self.directory, relative)
        if destination.exists():
            return relative
        with Image.open(asset(self.directory, source["original"] if candidate["kind"] == "full" else source["working"])) as image:
            output = image.copy() if candidate["box"] is None else image.crop(candidate["box"])
        if candidate["box"] and output.width * output.height < self.config["min_area"]:
            raise ValueError("裁片低于像素下限")
        # The unmodified legacy routine operates on one level of identity directories.
        with tempfile.TemporaryDirectory(dir=self.directory) as temporary:
            folder = Path(temporary) / "identity"
            folder.mkdir()
            output.save(folder / "image.png")
            resize_images_in_folder(temporary, 1280, False)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(folder / "image.png", destination)
        return relative

    def tag_all(self):
        failures = []
        self.client.check(tagging=True)
        for source in self.data["sources"].values():
            if not source.get("active", True):
                continue
            if source.get("error"):
                failures.append(f"{source['relative']}: prepare 失败")
                continue
            if not Path(source["source_path"]).is_file() or file_digest(source["source_path"]) != source["fingerprint"]:
                failures.append(f"{source['relative']}: 源文件已变化，请重新 prepare")
                continue
            for candidate in source["candidates"]:
                if candidate["status"] != "accepted":
                    continue
                if self.current_tag(source, candidate) and asset(self.directory, candidate["tag"]["image"]).is_file():
                    continue
                started = time.monotonic()
                try:
                    key = self.tag_key(source, candidate)
                    relative = self._materialize(source, candidate, key)
                    with Image.open(asset(self.directory, relative)) as image:
                        scores = self.client.tag(image)
                    raw = list(dict.fromkeys(normalize(t) for t in scores))
                    removed = ["full body"] if "full body" in raw and full_body_conflict(
                        candidate["box"], source["detection"], source["working_size"]) else []
                    old = candidate.get("tag", {})
                    if old:
                        candidate.setdefault("tag_history", []).append(copy.deepcopy(old))
                    tag = {"key": key, "image": relative, "raw": raw, "scores": scores,
                           "auto_removed": removed, "operations": old.get("operations", []),
                           "suggestions": tag_suggestions(raw, removed, candidate["box"], source["detection"]),
                           "restore_raw": old.get("restore_raw", False), "reviewed": False, "stale": False,
                           "seconds": round(time.monotonic() - started, 3)}
                    tag["tags"] = edited_tags(tag)
                    candidate["tag"] = tag
                    candidate.pop("error", None)
                    self.save()
                except Exception as error:
                    candidate["error"] = str(error)
                    failures.append(f"{source['relative']}/{candidate['id']}: {error}")
                    self.save()
        return failures

    def edit_tags(self, selections, operation):
        # Validate the whole batch before changing any image.
        targets = [self.locate(s[0], s[1]) for s in selections]
        if not targets:
            raise ValueError("请先选择图片")
        mode = operation.get("mode")
        if mode not in ("add", "remove", "replace", "restore", "approve"):
            raise ValueError("未知标签操作")
        if mode in ("add", "remove") and not isinstance(operation.get("tags"), list):
            raise ValueError("需要标签列表")
        if mode == "replace" and (not operation.get("old") or not operation.get("new")):
            raise ValueError("替换需要原标签和新标签")
        for source, candidate in targets:
            if not self.current_tag(source, candidate) or candidate["status"] != "accepted":
                raise ValueError("选中图片的标签过期或尚未打标，请先运行 tag")
        for _, candidate in targets:
            tag = candidate["tag"]
            if mode == "approve":
                tag["reviewed"] = True
            elif mode == "restore":
                tag.setdefault("edit_history", []).append(copy.deepcopy(tag["operations"]))
                tag.update(operations=[], restore_raw=True, reviewed=False)
            else:
                tag["operations"].append(copy.deepcopy(operation))
                tag["reviewed"] = False
            tag["tags"] = edited_tags(tag)
        self.save()

    def export(self):
        sources = [s for s in self.data["sources"].values() if s.get("active", True)]
        selected = []
        for source in sources:
            if (source.get("error") or not Path(source["source_path"]).is_file()
                    or file_digest(source["source_path"]) != source["fingerprint"]):
                raise ValueError("输入已变化或 prepare 失败，请先重新处理")
            if any(c["status"] == "pending" for c in source["candidates"]):
                raise ValueError("仍有待审核裁框，请接受或拒绝后再导出")
            for candidate in source["candidates"]:
                if candidate["status"] == "accepted":
                    if not self.current_tag(source, candidate) or not candidate["tag"]["reviewed"]:
                        raise ValueError("仍有未确认或过期标签，请在标签审核页确认")
                    selected.append((source, candidate))
        if not selected:
            raise ValueError("没有可导出的图片")
        csv_path = Path(self.config["tags_csv"])
        if not self.config["tags_csv"] or not csv_path.is_file():
            raise ValueError("请配置 EVA02-Large 模型配套的 selected_tags.csv 路径")
        with csv_path.open(encoding="utf-8-sig", newline="") as stream:
            character_tags = {normalize(row["name"]) for row in csv.DictReader(stream) if row["category"] == "4"}
        output = Path(self.config["output_dir"])
        previous = self.data.get("exports", {})
        pending = self.data.get("export_pending", {})
        # Never overwrite unowned or externally edited output files.
        if output.exists():
            for file in output.rglob("*"):
                if file.is_file():
                    relative = file.relative_to(output).as_posix()
                    if relative.endswith(".tmp") and relative[:-4] in pending:
                        continue  # Recorded temporary destination from an interrupted copy.
                    if file_digest(file) not in (previous.get(relative), pending.get(relative)):
                        raise ValueError(f"输出含非本运行生成或已被外部修改的文件: {relative}")
        with tempfile.TemporaryDirectory(dir=self.directory) as temporary:
            staging = Path(temporary)
            for source, candidate in selected:
                tag = candidate["tag"]
                folder = staging / source["group"]
                folder.mkdir(parents=True, exist_ok=True)
                name = f"{source['id']}_{candidate['id']}"
                shutil.copyfile(asset(self.directory, tag["image"]), folder / f"{name}.png")
                protected = manual_additions(tag)
                extra_drop = self.data.get("drop_tags_override", self.config["drop_tags"])
                drop = (character_tags | {normalize(t) for t in extra_drop}) - protected
                tags = [t for t in tag["tags"] if t not in drop]
                # Existing caption routine skips an empty file; seed its identity in that case.
                caption = ", ".join(tags) or f"{source['group']} ({self.config['copyright']})"
                (folder / f"{name}.txt").write_text(caption, encoding="utf-8")
            process_text_files_in_dataset(str(staging), self.config["copyright"])
            new_files = {p.relative_to(staging).as_posix(): file_digest(p)
                         for p in staging.rglob("*") if p.is_file()}
            # Persist intended hashes before copying, so interrupted exports can resume.
            self.data["export_pending"] = new_files
            self.save()
            for relative in new_files:
                destination = output / relative
                if not inside(destination, output):
                    raise ValueError("导出路径越界")
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary_file = destination.with_suffix(destination.suffix + ".tmp")
                shutil.copyfile(staging / relative, temporary_file)
                temporary_file.replace(destination)
            for relative in set(previous) - set(new_files):
                old_file = output / relative
                if inside(old_file, output) and old_file.is_file():
                    old_file.unlink()
            self.data["exports"] = new_files
            self.data.pop("export_pending", None)
            self.save()
        return len(selected)


def normalize(tag):
    return tag.replace("_", " ").strip()


def edited_tags(tag):
    tags = [t for t in tag["raw"] if tag.get("restore_raw") or t not in tag["auto_removed"]]
    for operation in tag["operations"]:
        mode = operation["mode"]
        if mode == "add":
            tags.extend(normalize(t) for t in operation["tags"])
        elif mode == "remove":
            remove = {normalize(t) for t in operation["tags"]}
            tags = [t for t in tags if t not in remove]
        elif mode == "replace":
            tags = [normalize(operation["new"]) if t == normalize(operation["old"]) else t for t in tags]
    return list(dict.fromkeys(t for t in tags if t))


def manual_additions(tag):
    additions = set()
    for operation in tag["operations"]:
        if operation["mode"] == "add":
            additions.update(normalize(t) for t in operation["tags"])
        elif operation["mode"] == "replace":
            additions.add(normalize(operation["new"]))
    return additions & set(tag["tags"])


def prepare(config, client=None, analyzer=None):
    directory = Path(config["run_dir"])
    input_dir = Path(config["input_dir"])
    if not input_dir.is_dir():
        raise ValueError(f"输入目录不存在: {input_dir}")
    if (directory / "manifest.json").exists():
        run = Run.load(directory, client=client, analyzer=analyzer)
        for key in ("input_dir", "output_dir"):
            if run.config[key] != config[key]:
                raise ValueError(f"现有运行不能更改 {key}，请创建新的 run_dir")
        run.data["config"] = run.config = config
        if client is None:
            run.client = ForgeClient(config)
    else:
        run = Run(directory, {"version": 1, "config": config, "sources": {}}, client, analyzer)
    for record in run.data["sources"].values():
        record["active"] = False
    failures = []
    files = sorted(p for p in input_dir.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS)
    for file in files:
        relative = file.relative_to(input_dir)
        if len(relative.parts) < 2 and not config["identity"]:
            failures.append(f"{relative}: 图片必须放在身份子目录内")
            continue
        source_id = digest(relative.as_posix())[:20]
        record = run.data["sources"].setdefault(source_id, {
            "id": source_id, "relative": relative.as_posix(), "source_path": str(file),
            "group": config["identity"] or relative.parts[0], "candidates": [],
        })
        record["active"] = True
        record["group"] = config["identity"] or relative.parts[0]
        try:
            changed = run.prepare_source(record)
            print(f"{'Prepared' if changed else 'Skipped'}: {relative}")
        except Exception as error:
            record["error"] = str(error)
            failures.append(f"{relative}: {error}")
        run.save()
    run.save()
    return run, failures

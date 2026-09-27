"""按数字顺序整理 LoRA 文件名。"""

import re
import uuid
from pathlib import Path


DIR = Path(__file__).resolve().parent.parent / "output"
NUMBERED = re.compile(r"^(.+)-(\d+)\.safetensors$", re.IGNORECASE)
SAFETENSORS = re.compile(r"^(.+)\.safetensors$", re.IGNORECASE)


def plan_renames(directory=DIR):
    folder = Path(directory).expanduser().resolve()
    if not folder.is_dir():
        raise ValueError(f"LoRA 目录不存在：{folder}")

    groups = {}
    for path in folder.iterdir():
        if not path.is_file():
            continue
        numbered = NUMBERED.fullmatch(path.name)
        plain = SAFETENSORS.fullmatch(path.name)
        if numbered:
            prefix, index = numbered.groups()
            groups.setdefault(prefix, []).append((int(index), path.name))
        elif plain:
            groups.setdefault(plain.group(1), []).append((float("inf"), path.name))

    changes = []
    for prefix, files in sorted(groups.items()):
        for index, (_, name) in enumerate(sorted(files, key=lambda item: (item[0], item[1]))):
            target = f"{prefix}-{index}.safetensors"
            if name != target:
                changes.append({"from": name, "to": target})

    sources = {change["from"] for change in changes}
    for change in changes:
        if (folder / change["to"]).exists() and change["to"] not in sources:
            raise ValueError(f"目标文件已存在：{change['to']}")
    return changes


def rename_files(directory=DIR, expected=None):
    folder = Path(directory).expanduser().resolve()
    changes = plan_renames(folder)
    if expected is not None and changes != expected:
        raise ValueError("LoRA 文件已变化，请刷新预览后重试")

    staged = []
    completed = []
    try:
        for change in changes:
            temporary = folder / f".{uuid.uuid4().hex}.rename-tmp"
            (folder / change["from"]).rename(temporary)
            staged.append((change, temporary))
        for change, temporary in staged:
            temporary.rename(folder / change["to"])
            completed.append((change, temporary))
    except OSError:
        for change, _ in reversed(completed):
            (folder / change["to"]).rename(folder / change["from"])
        for change, temporary in reversed(staged[len(completed):]):
            temporary.rename(folder / change["from"])
        raise
    return changes


def rename():
    changes = rename_files()
    for change in changes:
        print(f"{change['from']} -> {change['to']}")
    print(f"已重命名 {len(changes)} 个 LoRA 文件")


if __name__ == "__main__":
    rename()

"""生成 LoRA 效果对比用的提示词列表。"""

import re
from pathlib import Path


DIR = Path(__file__).resolve().parent.parent / "output"
NUMBERED = re.compile(r"^.+-(\d+)\.safetensors$", re.IGNORECASE)


def generate_lora_tags(directory=DIR):
    folder = Path(directory).expanduser().resolve()
    if not folder.is_dir():
        raise ValueError(f"LoRA 目录不存在：{folder}")
    files = []
    for path in folder.iterdir():
        match = NUMBERED.fullmatch(path.name)
        if path.is_file() and match:
            files.append((int(match.group(1)), path.name))
    files.sort(key=lambda item: (item[0], item[1]))
    return "\n".join(f"<lora:{name[:-12]}:1>" for _, name in files)


def compare():
    import pyperclip

    prompts = generate_lora_tags()
    print(prompts)
    pyperclip.copy(prompts)


if __name__ == "__main__":
    compare()

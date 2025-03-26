import os
import re
import pyperclip

DIR = os.path.join(os.path.dirname(__file__), "output")


def compare():
    files = os.listdir(DIR)

    def extract_number(filename):
        # 匹配 "固定前缀-数字.扩展名" 格式中的数字部分
        match = re.search(r"-(\d+)\.", filename)
        if match:
            return int(match.group(1))  # 提取并转换为整数
        return float(
            "inf"
        )  # 如果没有匹配到数字，返回一个很大的值（确保排序时排到最后）

    # 按提取的数字对文件列表进行排序
    sorted_files = sorted(files, key=extract_number)

    match_reg = re.compile(r"^.+-\d+")

    prompts = []
    weight = "1"
    lora_list = []
    for file in sorted_files:
        if not match_reg.match(file):
            continue

        lora_prompt = "<lora:" + file.replace(".safetensors", f":{weight}>")
        lora_list.append(lora_prompt)

    lora_prompts = "\n".join(lora_list)
    prompts.append(lora_prompts)
    print(lora_prompts)

    pyperclip.copy("\n".join(prompts))


if __name__ == "__main__":
    compare()

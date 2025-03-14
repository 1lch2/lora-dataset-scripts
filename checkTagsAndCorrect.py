import os


def check_txt_files_in_folder(folderPath: str):
    """
    检查打标文件是否以 `1girl, {character} ({copyright}), {copyright}` 的 tag 开头。
    需要配合 kohya_ss 中的 keep_tokens=3 选项使用。
    """
    # 确保传入的folderPath是存在的目录
    if not os.path.isdir(folderPath):
        print(f"Error: The provided folder path '{folderPath}' does not exist.")
        return

    # 遍历文件夹下的所有子文件夹
    for subdir, _, files in os.walk(folderPath):
        characterName = os.path.basename(
            subdir
        )  # 获取当前子文件夹的名称作为characterName

        # 循环处理子文件夹内的每个txt文件
        for filename in files:
            if filename.endswith(".txt"):  # 确保文件是txt文件
                file_path = os.path.join(subdir, filename)
                with open(file_path, "r", encoding="utf-8") as file:
                    content = file.read().strip()  # 读取文件内容并去除首尾空白字符
                    data_array = [
                        x.strip() for x in content.split(",")
                    ]  # 按逗号分割并去除每个字符串的首尾空格

                    # 检查数组开头元素是否符合条件
                    if (
                        ("1girl" in data_array)
                        and (
                            data_array[:3]
                            == ["1girl", f"{characterName} (arknights)", "arknights"]
                        )
                        or ("2girls" in data_array)
                    ):
                        pass  # 检查通过，无需操作
                    else:
                        print(
                            f"Check failed for file: {file_path}"
                        )  # 检查未通过，打印文件路径

                        oneGirl = data_array.index("1girl")
                        data_array.pop(oneGirl)

                        name = data_array.index(f"{characterName} (arknights)")
                        data_array.pop(name)

                        arknights = data_array.index("arknights")
                        data_array.pop(arknights)

                        data_array = [
                            "1girl",
                            f"{characterName} (arknights)",
                            "arknights",
                        ] + data_array

                        new_content = ", ".join(data_array)

                        # 写入并覆盖原文件
                        with open(file_path, "w", encoding="utf-8") as file:
                            file.write(new_content)

                        print(f"Correct file: {file_path}\n")


if __name__ == "__main__":
    check_txt_files_in_folder("../../dataset-raw")

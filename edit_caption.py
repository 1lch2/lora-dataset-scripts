import os

DATASET_PATH = './dataset-raw'
COPYRIGHT = 'arknights'

def edit_caption(folder_path, character_names):
    for character_name in character_names:
        # 获取指定文件夹中的文件列表
        files = os.listdir(os.path.join(folder_path, character_name))
        for file in files:
            if file.endswith('.txt'):
                tag_file_path = os.path.join(folder_path, character_name, file)
                with open(tag_file_path, 'r', encoding='utf-8') as f:
                    tag_file = f.read()
                tag_list = tag_file.split(', ')
                new_tags = [tag.replace('_', ' ') for tag in tag_list]
                new_tags.insert(1, f'{character_name} ({COPYRIGHT})')
                new_tags.insert(2, COPYRIGHT)

                # 将 1girl 标签移到最前面
                if '1girl' in new_tags and '2girls' not in new_tags:
                    new_tags.remove('1girl')
                    new_tags.insert(0, '1girl')

                with open(tag_file_path, 'w', encoding='utf-8') as f:
                    f.write(', '.join(new_tags))

                print('Write tag file: ', tag_file)

    print('Edit tag files complete')

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
                            == ["1girl", f"{characterName} ({COPYRIGHT})", "{COPYRIGHT}"]
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

                        name = data_array.index(f"{characterName} ({COPYRIGHT})")
                        data_array.pop(name)

                        arknights = data_array.index("{COPYRIGHT}")
                        data_array.pop(arknights)

                        data_array = [
                            "1girl",
                            f"{characterName} ({COPYRIGHT})",
                            "{COPYRIGHT}",
                        ] + data_array

                        new_content = ", ".join(data_array)

                        # 写入并覆盖原文件
                        with open(file_path, "w", encoding="utf-8") as file:
                            file.write(new_content)

                        print(f"Correct file: {file_path}\n")


if __name__ == "__main__":
    character_names = os.listdir(DATASET_PATH)
    edit_caption(DATASET_PATH, character_names)
    check_txt_files_in_folder(DATASET_PATH)

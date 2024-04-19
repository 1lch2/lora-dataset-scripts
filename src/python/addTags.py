import os


def process_txt_files(tags, folder, index=None):
    # 获取当前脚本的绝对路径
    script_dir = os.path.abspath(os.path.dirname(__file__))
    # 计算完整的文件夹路径（处理相对路径）
    full_folder_path = os.path.abspath(os.path.join(script_dir, folder))

    # 确保full_folder_path是一个存在的目录
    if not os.path.isdir(full_folder_path):
        print(f"Error: The folder '{full_folder_path}' does not exist.")
        return

    # 遍历full_folder_path目录下的所有文件
    for filename in os.listdir(full_folder_path):
        if filename.endswith(".txt"):
            file_path = os.path.join(full_folder_path, filename)

            # 读取txt文件
            with open(file_path, "r", encoding="utf-8") as file:
                content = file.read()

            # 将内容按逗号分隔为字符串数组，并去除首尾空格
            lines = [line.strip() for line in content.split(",")]

            # 根据index的值处理tags数组
            if index is not None:
                if index >= 0 and index < len(lines):
                    # 插入到指定位置
                    lines.insert(index, ", ".join(tags))
            else:
                # 插入到末尾
                lines.extend(tags)

            # 将数组用逗号空格链接成字符串
            new_content = ", ".join(lines)

            # 写入并覆盖原文件
            with open(file_path, "w", encoding="utf-8") as file:
                file.write(new_content)

            print(f"Write file: {file.name}")


if __name__ == "__main__":
    process_txt_files(
        ["official alternate costume"],
        "../../addTags",
    )

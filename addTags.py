import os
import sys


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
                elif index < 0:
                    # 负数索引，从末尾开始计算位置
                    # -1 表示在末尾插入，-2 表示在倒数第二个位置插入，以此类推
                    insert_pos = len(lines) + index + 1
                    # 确保插入位置在有效范围内
                    if insert_pos < 0:
                        insert_pos = 0
                    elif insert_pos > len(lines):
                        insert_pos = len(lines)
                    lines.insert(insert_pos, ", ".join(tags))
            else:
                # 默认插入到开头
                lines.insert(0, ", ".join(tags))

            # 将数组用逗号空格链接成字符串
            new_content = ", ".join(lines)

            # 写入并覆盖原文件
            with open(file_path, "w", encoding="utf-8") as file:
                file.write(new_content)

            print(f"Write file: {file.name}")


def main():
    # Check argument count
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("Usage: python addTags.py <tag> [position]")
        print("  <tag>: The tag to be added to each txt file")
        print("  [position]: The position to insert the tag (optional)")
        print("    - If not provided, tag will be added at the beginning")
        print("    - If negative, counts from the end (-1 means at the end)")
        sys.exit(1)

    # Get tag from first argument
    tag = sys.argv[1]

    # Get position from second argument if provided
    index = None
    if len(sys.argv) == 3:
        try:
            index = int(sys.argv[2])
        except ValueError:
            print("Error: Position must be an integer")
            sys.exit(1)

    # Process files with the provided arguments
    process_txt_files([tag], "./addTags", index)


if __name__ == "__main__":
    main()

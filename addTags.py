import os
import sys
import argparse


def process_txt_files(tags: list[str], folder: str, index: int = 0):
    """批量为txt tag文件添加指定tag。

    Args:
        tags: 要添加的tag列表
        folder: 目标文件夹路径（相对于脚本所在目录）
        index: 插入位置。0为最开头，-1为末尾，负数表示从后向前的位置
    """
    script_dir = os.path.abspath(os.path.dirname(__file__))
    full_folder_path = os.path.abspath(os.path.join(script_dir, folder))

    if not os.path.isdir(full_folder_path):
        print(f"Error: The folder '{full_folder_path}' does not exist.")
        return

    # 递归收集所有txt文件（支持一层子文件夹）
    txt_files = []
    for entry in os.listdir(full_folder_path):
        entry_path = os.path.join(full_folder_path, entry)
        if os.path.isdir(entry_path):
            # 遍历子文件夹中的txt文件
            for filename in os.listdir(entry_path):
                if filename.endswith(".txt"):
                    txt_files.append(os.path.join(entry_path, filename))
        elif entry.endswith(".txt"):
            txt_files.append(entry_path)

    if not txt_files:
        print(f"No .txt files found in '{full_folder_path}'.")
        return

    for file_path in txt_files:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        # 按逗号分隔为列表，去除每个tag的首尾空格
        existing_tags = [tag.strip() for tag in content.split(",") if tag.strip()]

        # 处理插入位置
        if index == 0:
            insert_pos = 0
        elif index < 0:
            # 负数：从后向前计算。-1表示末尾（即append），-2表示倒数第二个之前
            insert_pos = max(0, len(existing_tags) + index + 1)
        else:
            insert_pos = min(index, len(existing_tags))

        # 在指定位置逐个插入新tag
        for i, tag in enumerate(tags):
            existing_tags.insert(insert_pos + i, tag)

        # 用逗号+空格连接，最后一个tag后无符号和空格
        new_content = ", ".join(existing_tags)

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)

        print(f"Processed: {file_path}")


def main():
    parser = argparse.ArgumentParser(description="批量为txt tag文件添加指定tag")
    parser.add_argument(
        "tags",
        help="要添加的tag，多个tag使用逗号分隔",
    )
    parser.add_argument(
        "position",
        type=int,
        help="插入位置：0为最开头，-1为末尾，负数表示从后向前的位置",
    )
    parser.add_argument(
        "--folder",
        default="addTags",
        help="目标文件夹路径，相对于脚本所在目录（默认: addTags）",
    )

    args = parser.parse_args()

    # 解析tags：按逗号分隔，去除首尾空格
    tags = [tag.strip() for tag in args.tags.split(",") if tag.strip()]

    if not tags:
        print("Error: No tags provided.")
        sys.exit(1)

    print(f"Tags to add: {tags}")
    print(f"Insert position: {args.position}")
    print(f"Target folder: {args.folder}")
    print("---")

    process_txt_files(tags, args.folder, args.position)


if __name__ == "__main__":
    main()

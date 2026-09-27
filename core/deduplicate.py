import cv2
import numpy as np
from PIL import Image
import os
from collections import defaultdict
import hashlib


def calculate_image_hash(image_path):
    """
    计算图像的感知哈希值（Perceptual Hash）
    """
    # 读取图像
    image = cv2.imread(image_path)
    if image is None:
        return None

    # 转换为灰度图
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # 缩放到8x8大小
    resized = cv2.resize(gray, (8, 8), interpolation=cv2.INTER_AREA)

    # 计算平均值
    avg = resized.mean()

    # 生成哈希值
    hash_str = ""
    for i in range(8):
        for j in range(8):
            hash_str += "1" if resized[i, j] > avg else "0"

    return hash_str


def hamming_distance(hash1, hash2):
    """
    计算两个哈希值之间的汉明距离
    """
    if len(hash1) != len(hash2):
        return float("inf")

    return sum(c1 != c2 for c1, c2 in zip(hash1, hash2))


def find_duplicate_images(folder_path="./dup", threshold=10):
    """
    在指定文件夹中查找重复图像

    Args:
        folder_path: 要搜索的文件夹路径
        threshold: 判定为重复图像的汉明距离阈值

    Returns:
        duplicates: 重复图像的分组列表
    """
    # 检查文件夹是否存在
    if not os.path.exists(folder_path):
        print(f"文件夹 {folder_path} 不存在")
        return []

    # 存储图像哈希值
    image_hashes = {}

    # 遍历文件夹中的所有文件
    for filename in os.listdir(folder_path):
        file_path = os.path.join(folder_path, filename)

        # 检查是否为图像文件
        if filename.lower().endswith(
            (".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".gif", ".webp")
        ):
            # 计算图像哈希值
            img_hash = calculate_image_hash(file_path)
            if img_hash is not None:
                image_hashes[file_path] = img_hash

    # 分组相似的图像
    hash_groups = defaultdict(list)
    processed = set()
    duplicates = []

    # 比较所有图像对
    image_paths = list(image_hashes.keys())
    for i, path1 in enumerate(image_paths):
        if path1 in processed:
            continue

        group = [path1]
        processed.add(path1)

        for j, path2 in enumerate(image_paths[i + 1 :], i + 1):
            if path2 in processed:
                continue

            # 计算汉明距离
            distance = hamming_distance(image_hashes[path1], image_hashes[path2])

            # 如果距离小于阈值，则认为是重复图像
            if distance <= threshold:
                group.append(path2)
                processed.add(path2)

        # 如果组中有多个图像，则认为存在重复
        if len(group) > 1:
            duplicates.append(group)

    return duplicates


def remove_duplicate_images(folder_path="./dup", threshold=10, method="move"):
    """
    删除或移动重复图像

    Args:
        folder_path: 要处理的文件夹路径
        threshold: 判定为重复图像的汉明距离阈值
        method: 处理方法，"remove" 删除重复图像，"move" 移动到 duplicates 文件夹
    """
    # 统计去重前的图片数量
    image_exts = (".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".gif", ".webp")
    all_files = [
        f
        for f in os.listdir(folder_path)
        if os.path.isfile(os.path.join(folder_path, f))
    ]
    image_files_before = [f for f in all_files if f.lower().endswith(image_exts)]
    print(f"去重前图片数量: {len(image_files_before)}")

    # 查找重复图像
    duplicates = find_duplicate_images(folder_path, threshold)

    if not duplicates:
        print("未找到重复图像")
        # 统计去重后的图片数量
        image_files_after = [
            f
            for f in os.listdir(folder_path)
            if os.path.isfile(os.path.join(folder_path, f))
            and f.lower().endswith(image_exts)
        ]
        print(f"去重后图片数量: {len(image_files_after)}")
        return

    # 创建 duplicates 文件夹（如果需要）
    duplicates_folder = os.path.join(folder_path, "duplicates")
    if method == "move" and not os.path.exists(duplicates_folder):
        os.makedirs(duplicates_folder)

    # 处理重复图像
    removed_count = 0
    for group in duplicates:
        print(f"发现重复图像组:")
        # 获取每个文件的大小
        file_sizes = [(path, os.path.getsize(path)) for path in group]
        # 按文件大小排序，保留最大的文件，移动其他文件
        file_sizes.sort(key=lambda x: x[1], reverse=True)

        # 打印文件信息
        for i, (path, size) in enumerate(file_sizes):
            size_mb = size / (1024 * 1024)  # 转换为MB
            print(f"  {i+1}. {os.path.basename(path)} ({size_mb:.2f} MB)")

        # 保留最大的文件，处理其余图像
        for path, size in file_sizes[1:]:
            if method == "remove":
                try:
                    os.remove(path)
                    print(f"    已删除: {os.path.basename(path)}")
                except Exception as e:
                    print(f"    删除失败: {os.path.basename(path)}，错误: {e}")
            elif method == "move":
                # 移动到 duplicates 文件夹
                filename = os.path.basename(path)
                new_path = os.path.join(duplicates_folder, filename)
                try:
                    os.rename(path, new_path)
                    print(f"    已移动: {filename} -> duplicates/")
                except Exception as e:
                    print(f"    移动失败: {filename}，错误: {e}")

            removed_count += 1

    # 统计去重后的图片数量
    image_files_after = [
        f
        for f in os.listdir(folder_path)
        if os.path.isfile(os.path.join(folder_path, f))
        and f.lower().endswith(image_exts)
    ]
    print(f"总共处理了 {removed_count} 个重复图像")
    print(f"去重后图片数量: {len(image_files_after)}")


if __name__ == "__main__":
    # 查找并删除重复图像
    remove_duplicate_images("./dup", threshold=10, method="move")

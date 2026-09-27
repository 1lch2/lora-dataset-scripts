from os import listdir, path
from PIL import Image


def resize_images_in_folder(folderPath: str, length=1200, rename=False):
    """
    缩放 dataset-raw 下的所有图片，保持长宽比不变，最短边长度缩放到 length。默认值为 1200 像素。

    若最短边小于 length 则不执行缩放。

    默认覆盖源文件，rename 设为 True 则以 `{原文件名}_{length}` 的格式保存一份新文件。
    """

    # 获取指定文件夹下所有子文件夹的名称
    characterNames = [
        name for name in listdir(folderPath) if path.isdir(path.join(folderPath, name))
    ]

    # 遍历每个角色文件夹
    for characterName in characterNames:
        characterFolderPath = path.join(folderPath, characterName)

        # 遍历文件夹中的所有图片文件
        for imageFile in listdir(characterFolderPath):
            imageFilePath = path.join(characterFolderPath, imageFile)

            # 检查文件是否为图片
            if imageFile.lower().endswith(
                (".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".gif", ".webp")
            ):
                # 打开图片
                with Image.open(imageFilePath) as img:
                    # 获取图片原始尺寸
                    original_width, original_height = img.size

                    # 计算最短边
                    shortest_side = min(original_width, original_height)

                    if rename:
                        # 构造新文件名，添加 _1200 后缀
                        new_filename = f"{path.splitext(imageFile)[0]}_1200{path.splitext(imageFile)[1]}"

                        # 构造新文件路径
                        new_filepath = path.join(characterFolderPath, new_filename)

                    # 构造新文件路径
                    new_filepath = path.join(characterFolderPath, imageFile)

                    # 如果最短边小于length，则只重命名不缩放
                    if shortest_side < length:
                        # 直接保存原始图片到新文件名
                        img.save(new_filepath)

                        print(f"Renamed image:{imageFilePath}")
                    else:
                        # 计算缩放比例
                        ratio = length / shortest_side

                        # 计算缩放后的尺寸
                        new_width = int(original_width * ratio)
                        new_height = int(original_height * ratio)

                        # 缩放图片
                        resized_img = img.resize((new_width, new_height), Image.LANCZOS)

                        # 保存缩放后的图片为新文件
                        resized_img.save(new_filepath)

                        print(f"Resized image:{imageFilePath}")


if __name__ == "__main__":
    resize_images_in_folder("./dataset-raw", 1280, False)

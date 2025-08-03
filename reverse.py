from os import listdir, path, makedirs
from PIL import Image


def reverse_images_in_folder(folderPath: str, outputFolderPath: str):
    """
    将指定文件夹下的所有图片水平镜像，并保存到新的文件夹中。
    """

    # 获取指定文件夹下所有子文件夹的名称
    characterNames = [
        name for name in listdir(folderPath) if path.isdir(path.join(folderPath, name))
    ]

    # 遍历每个角色文件夹
    for characterName in characterNames:
        characterFolderPath = path.join(folderPath, characterName)
        outputCharacterFolderPath = path.join(outputFolderPath, characterName)

        # 如果输出文件夹不存在，则创建
        if not path.exists(outputCharacterFolderPath):
            makedirs(outputCharacterFolderPath)

        # 遍历文件夹中的所有图片文件
        for imageFile in listdir(characterFolderPath):
            imageFilePath = path.join(characterFolderPath, imageFile)

            # 检查文件是否为图片
            if imageFile.lower().endswith(
                (".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".gif", ".webp")
            ):
                # 打开图片
                with Image.open(imageFilePath) as img:
                    # 水平镜像图片
                    reversed_img = img.transpose(Image.FLIP_LEFT_RIGHT)

                    # 构造输出文件路径
                    output_filepath = path.join(outputCharacterFolderPath, imageFile)

                    # 保存镜像后的图片
                    reversed_img.save(output_filepath)

                    print(f"Reversed image: {imageFilePath} -> {output_filepath}")


if __name__ == "__main__":
    reverse_images_in_folder("./dataset-raw", "./reverse")

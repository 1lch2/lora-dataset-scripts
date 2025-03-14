import os

DATASET_PATH = './dataset-raw'

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
                new_tags.insert(1, f'{character_name} (arknights)')
                new_tags.insert(2, 'arknights')

                # 将 1girl 标签移到最前面
                if '1girl' in new_tags and '2girls' not in new_tags:
                    new_tags.remove('1girl')
                    new_tags.insert(0, '1girl')

                with open(tag_file_path, 'w', encoding='utf-8') as f:
                    f.write(', '.join(new_tags))

                print('Write tag file: ', tag_file)

    print('Edit tag files complete')

if __name__ == "__main__":
    character_names = os.listdir(DATASET_PATH)
    edit_caption(DATASET_PATH, character_names)

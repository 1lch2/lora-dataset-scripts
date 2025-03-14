import os
import re

DIR = os.path.join(os.path.dirname(__file__), '../../output')

def rename():
    files = os.listdir(DIR)
    if files[0] == '.keep':
        files.pop(0)

    regex = re.compile(r'\.safetensors$')
    prefix = files[0].split('-')[0]

    for i, file_name in enumerate(files):
        if not regex.search(file_name):
            continue

        new_name = re.sub(f'^{prefix}', f'{prefix}-___', file_name).replace('___', f'{i}.safetensors')

        print(new_name)
        os.rename(os.path.join(DIR, file_name), os.path.join(DIR, new_name))

if __name__ == "__main__":
    rename()

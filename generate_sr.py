import os
import re
import pyperclip

DIR = os.path.join(os.path.dirname(__file__), '../../output')

def compare():
    files = os.listdir(DIR)
    match_reg = re.compile(r'^.+-\d+')

    prompts = []
    weight = '1'
    lora_list = []
    for file in files:
        if not match_reg.match(file):
            continue

        lora_prompt = '<lora:' + file.replace('.safetensors', f':{weight}>')
        lora_list.append(lora_prompt)
    
    lora_prompts = '\n'.join(lora_list)
    prompts.append(lora_prompts)
    print(lora_prompts)
    
    pyperclip.copy('\n'.join(prompts))

if __name__ == "__main__":
    compare()

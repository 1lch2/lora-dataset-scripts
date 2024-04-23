# lora-dataset-utils

_This is a WIP repo_

---

Some scripts for processing dataset for training stable diffusion lora.

Contains NodeJS and Python scripts. Maybe I will re-write NodeJS scripts in Python sometime(or you
can just use AI to do that).

## Install

### NodeJS
You need to install NodeJS on your computer first.

Use command:  to install the freaking heavy dependencies.

### Python

You know the rules, install Python 3.10 first.

Use command: `pip install -r requirements.txt` or `python -m pip install -r requirements.txt`.

## Set up your directory

If you find a directory missed from your repo, create it yourself.

Your repo directory should be like this:

```
├─addTags
├─dataset-raw
│  └─character name
└─src
    ├─javascript
    ├─python
    └─utils
```

`dataset-raw/character name` and `addTags` is where your tag files should be at.

You can set multiple folders under `dataset-raw` for different characters or character with
different costumes.

## How to use scripts

Because I mainly train Arknights lora, so the default copyright tag will be `"arknights"`. Feel free
to change it yourself. The code is located at line 21 of `src/javascript/editCaption.js`.

### Add character name and copyright tags

Command: `npm run edit`

You should use `keep_tokens=3` in your koyha_ss lora script config. Otherwise, this script will be
useless.

The folder name under `dataset-raw` will be the character name tag. For example, if I have
`dataset-raw/amiya`, then this script will add `1girl, amiya (arknights), arknights` to the front of
each your tag file under this folder.

Don't worry, if the tag file already contains `1girl` or it has `2girls` tag, it won't add
additional `1girl` tag.

### Check and correct tag files

As mentioned above, you will need to make sure every (or at least most of your tag files) tag files
starts with such tags: `1girl, amiya (arknights), arknights`. But the first script sometimes fails
to follow such format. You should run this script after the first one to correct possible errors in
tag files.

Use `cd src/python` to change to `src/python` directory first.

Command: `py checkTagsAndCorrect.py`

### Resize your images

Use `cd src/python` to change to `src/python` directory first.

Command: `py resize.py`

By default it will resize your images by the short edge to 1200 pixel. If the image's shortest edge
is shorter than 1200 pixel, it will be ignored.

It will overwrite your original image by default. You can change the third param to True to save a
copy.

### Add tags to any location

TODO

### Batch rename lora files

Place your lora files under `output`.

Command: `npm run rename`.

This will rename your lora files with number at the end. Use it with the next script for testing
your lora files' performance.

### Generate prompts Prompt S/R for XYZ plot script

Command: `npm compare <weight_1,weight_2,...,weight_n>`

Let's say you have 5 lora files named like this:

- myLora-0.safetensors
- myLora-1.safetensors
- myLora-2.safetensors
- myLora-3.safetensors
- myLora-4.safetensors

You want to test which lora performs best at what weight with Prompt S/R. But you don't want to type
`<lora:myLora-0:0.8>` over and over. Use this script to generate prompts that you can simply paste
to sd-webui.

Just type the weights your want to test for each lora. For example, if you want to test 2 weights:
0.8 and 1, type `npm run compare 0.8,1`. Don't forget the comma. The script will generate lora
prompts for your and add to your system clipboard. Then paste it to webui and you are good to go.

---

To be continued...

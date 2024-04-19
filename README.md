# lora-dataset-utils

_This is a WIP repo_

_仓库施工中_

---

Some scripts for processing dataset for training stable diffusion lora.

Contains NodeJS and Python scripts. Maybe I will re-write NodeJS scripts in Python sometime(or you
can just use AI to do that).

自己写的一些处理用来训练 stable diffusion lora 数据集的脚本。

有NodeJS也有Python。以后也许会把Node的部分用Python重写吧（或者你也可以让AI重写）。

## Install | 安装

### NodeJS

You need to install NodeJS on your computer first.

Use command: `npm install` to install the freaking heavy dependencies.

先下载安装 Node，再用上面那个命令安装依赖。

### Python

You know the rules, install Python 3.10 first.

Use command: `pip install -r requirements.txt` or `python -m pip install -r requirements.txt`.

还是先安装 Python 3.10，再用上面的任意一条命令安装依赖。

## Set up your directory | 设置目录

If you find a directory missed from your repo, create it yourself.

如果你发现仓库里少了某个文件夹，自己新建一个。最终结构应该如下面的树状图所示。

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

`dataset-raw/character name` 和 `addTags` 是用来存放打标文件的。

`dataset-raw` 下面也可以创建多个文件夹用来存不同角色或者同角色不同服装。

## Scripts | 脚本

Because I mainly train Arknights lora, so the default copyright tag will be `"arknights"`. Feel free
to change it yourself. The code is located at line 21 of `src/javascript/editCaption.js`.

因为我主要炼明日方舟的lora，所以默认的版权 tag 是 `"arknights"`。你自己可以随意改。相关代码在
`src/javascript/editCaption.js` 的第 21 行。

### Add character name and copyright tags | 添加角色名和版权tag

Command | 命令: `npm run edit`

You should use `keep_tokens=3` in your koyha_ss lora script config. Otherwise, this script will be
useless.

你应该在你的lora训练配置中使用 `keep_tokens=3` 这个选项，否则这个脚本就没啥用了。

The folder name under `dataset-raw` will be the character name tag. For example, if I have
`dataset-raw/amiya`, then this script will add `1girl, amiya (arknights), arknights` to the front of
each your tag file under this folder.

`dataset-raw` 下面的文件夹名会作为角色名 tag 被添加进去。比如我有这么个目录，`dataset-raw/amiya`，那
这个脚本会把 `1girl, amiya (arknights), arknights` 加到这个目录下每个打标文件的最开头。

Don't worry, if the tag file does not contains `1girl`, it won't add additional `1girl` tag.

如果某个打标文件里没有 `1girl` tag，脚本也不会多加一个进去。

### Resize your images | 缩放图片素材

Use `cd src/python` to change to `src/python` directory first.

先用 `cd src/python` 命令切换到 `src/python` 目录下。

Command | 命令: `py resize.py`

By default it will resize your images by the short edge to 1200 pixel. If the image's shortest edge
is shorter than 1200 pixel, it will be ignored.

默认会把图片的短边缩放到1200像素。如果图片的短边小于1200像素，则不变。

It will overwrite your original image by default. You can change the third param to True to save a
copy.

默认会把原文件覆盖。可以把脚本的第三个参数改为 True 来保存一份副本。

### Add tags to any location | 往任意位置添加 tag

TODO

### Batch rename lora files | 批量重命名 lora 文件

Place your lora files under `output`.

把你炼好的 lora 文件放进 `output` 目录下。

Command | 命令: `npm run rename`.

This will rename your lora files with number at the end. Use it with the next script for testing
your lora files' performance.

这个脚本会批量重命名你的 lora 文件，新文件名以数字结尾。搭配下一个脚本来测试lora的性能。

### Generate prompts Prompt S/R for XYZ plot script | 为XYZ图的提示词搜索替换功能生成提示词

Command | 命令: `npm compare <weight_1,weight_2,...,weight_n>`

假设你有这么5个炼好的lora文件：

Let's say you have 5 lora files named like this:

- myLora-0.safetensors
- myLora-1.safetensors
- myLora-2.safetensors
- myLora-3.safetensors
- myLora-4.safetensors

You want to test which lora performs best at what weight with Prompt S/R. But you don't want to type
`<lora:myLora-0:0.8>` over and over. Use this script to generate prompts that you can simply paste
to sd-webui.

你想测一下哪个lora在什么权重下表现最好，但是又不想反复写 `<lora:myLora-0:0.8>` 这种提示词。用这个脚
本就能生成一套提示词并且可以直接粘贴进webui里面。

Just type the weights your want to test for each lora. For example, if you want to test 2 weights:
0.8 and 1, type `npm run compare 0.8,1`. Don't forget the comma. The script will generate lora
prompts for your and add to your system clipboard. Then paste it to webui and you are good to go.

输入你想给每个lora测试的权重即可。比如你想让每个lora都试一下 0.8 和 1 这两个权重，就输
`npm run compare 0.8,1`。别忘了逗号。脚本会生成lora 提示词并且复制到你的系统剪贴板。然后你就能直接粘
贴到webui里了。

---

To be continued...

未完待续...

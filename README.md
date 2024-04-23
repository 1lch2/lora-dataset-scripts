# lora-dataset-utils
[English version](./README_EN.md)

---

_仓库施工中_

---

自己写的一些处理用来训练 stable diffusion lora 数据集的脚本。

脚本功能包括缩放图片，统一添加角色名和版权tag，批量重命名lora，生成XYZ图对比用的lora提示词。

有NodeJS也有Python。以后也许会把Node的部分用Python重写吧（或者你也可以让AI重写）。

## 安装环境

### NodeJS

先下载安装 Node，再用 `npm install` 命令安装依赖。

### Python

先安装 Python 3.10，再用 `pip install -r requirements.txt` 或 `python -m pip install -r requirements.txt` 安装依赖。

## 设置目录

如果你发现仓库里少了某个文件夹，自己新建一个。最终结构应该如下面的树状图所示。

```
├─addTags
├─dataset-raw
│  └─character name
└─src
    ├─javascript
    ├─python
    └─utils
```

`dataset-raw/character name` 和 `addTags` 是用来存放打标文件的。

`dataset-raw` 下面也可以创建多个文件夹用来存不同角色或者同角色不同服装。

## 如何使用脚本

因为我主要炼明日方舟的lora，所以默认的版权 tag 是 `"arknights"`。你自己可以随意改。相关代码在
`src/javascript/editCaption.js` 的第 21 行。

### 添加角色名和版权tag

命令: `npm run edit`

你应该在你的lora训练配置中使用 `keep_tokens=3` 这个选项，否则这个脚本就没啥用了。

`dataset-raw` 下面的文件夹名会作为角色名 tag 被添加进去。比如我有这么个目录，`dataset-raw/amiya`，那这个脚本会把 `1girl, amiya (arknights), arknights` 加到这个目录下每个打标文件的最开头。

如果某个打标文件里已经有了 `1girl` 或者有 `2girls` 的 tag ，脚本也不会多加一个进去。

### 检查并修正打标文件

如上文所说，需要保证每个打标文件（至少是大部分的打标文件）都以这种格式开头：
`1girl, amiya (arknights), arknights`。但前一个脚本有时候会出些小问题。你应该在前一个脚本运行完之后再运行这个来修正可能存在的错误打标。

先用 `cd src/python` 命令切换到 `src/python` 目录下。

Command: `py checkTagsAndCorrect.py`

### 缩放图片素材

Use `cd src/python` to change to `src/python` directory first.

先用 `cd src/python` 命令切换到 `src/python` 目录下。

命令: `py resize.py`

默认会把图片的短边缩放到1200像素。如果图片的短边小于1200像素，则不变。

默认会把原文件覆盖。可以把脚本的第三个参数改为 `True` 来保存一份副本。

### 往任意位置添加 tag

TODO

### 批量重命名 lora 文件

把你炼好的 lora 文件放进 `output` 目录下。

Command: `npm run rename`.

这个脚本会批量重命名你的 lora 文件，新文件名以数字结尾。搭配下一个脚本来测试lora的性能。

### 为XYZ图的提示词搜索替换功能生成提示词

命令: `npm compare <weight_1,weight_2,...,weight_n>`

假设你有这么5个炼好的lora文件：

- myLora-0.safetensors
- myLora-1.safetensors
- myLora-2.safetensors
- myLora-3.safetensors
- myLora-4.safetensors

你想测一下哪个lora在什么权重下表现最好，但是又不想反复写 `<lora:myLora-0:0.8>` 这种提示词。用这个脚本就能生成一套提示词并且可以直接粘贴进webui里面。

输入你想给每个lora测试的权重即可。比如你想让每个lora都试一下 0.8 和 1 这两个权重，就输
`npm run compare 0.8,1`。别忘了逗号。脚本会生成lora 提示词并且复制到你的系统剪贴板。然后你就能直接粘贴到webui里了。

---

未完待续...

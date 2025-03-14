# lora-dataset-utils

一些处理用来训练 stable diffusion lora 数据集的脚本。

功能包括缩放图片，统一添加角色名和版权 tag，批量重命名 lora，生成 XYZ 图对比用的 lora 提示词。

## 安装环境

### Python

先安装 Python 3.10，再用 `pip install -r requirements.txt` 或 `python -m pip install -r requirements.txt` 安装依赖。

## 设置目录

如果你发现仓库里少了某个文件夹，自己新建一个。最终结构应该如下面的树状图所示。

```
├─addTags
├─output
├─dataset-raw
│  └─character_name
└─src
    ├─javascript
    ├─python
    └─utils
```

`dataset-raw/character name` 和 `addTags` 是用来存放打标文件的。

`dataset-raw` 下面也可以创建多个文件夹用来存不同角色或者同角色不同服装。

## 如何使用脚本

### 添加角色名和版权 tag

脚本: `edit_caption.py`

你应该在你的 lora 训练配置中使用 `keep_tokens=3` 这个选项，否则这个脚本就没啥用了。

`dataset-raw` 下面的文件夹名会作为角色名 tag 被添加进去。比如我有这么个目录，`dataset-raw/amiya`，那这个脚本会把 `1girl, amiya (arknights), arknights` 加到这个目录下每个打标文件的最开头。

如果某个打标文件里已经有了 `1girl` 或者有 `2girls` 的 tag ，脚本也不会多加一个进去。

### 检查并修正打标文件

脚本：`checkTagsAndCorrect.py`

如上文所说，需要保证每个打标文件（至少是大部分的打标文件）都以这种格式开头：
`1girl, amiya (arknights), arknights`。但前一个脚本有时候会出些小问题。你应该在前一个脚本运行完之后再运行这个来修正可能存在的错误打标。

### 缩放图片素材

脚本: `resize.py`

默认会把图片的短边缩放到 1200 像素。如果图片的短边小于 1200 像素，则不变。

默认会把原文件覆盖。可以把脚本的第三个参数改为 `True` 来保存一份副本。

### 批量重命名 lora 文件

把你炼好的 lora 文件放进 `output` 目录下。

脚本: `rename.py`.

这个脚本会批量重命名你的 lora 文件，新文件名以数字结尾。搭配下一个脚本来测试 lora 的性能。

### 为 XYZ 图的提示词搜索替换功能生成提示词

脚本：`generate_sr.py`

假设你有这么 5 个炼好的 lora 文件：

- myLora-0.safetensors
- myLora-1.safetensors
- myLora-2.safetensors
- myLora-3.safetensors
- myLora-4.safetensors

生成 `<lora:myLora-0:1>` 在 WebUI 的 XYZ 图中用于对比的 Lora 提示词。

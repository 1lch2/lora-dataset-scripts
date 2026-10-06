# 独立图片与角色标签脚本

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-06。已核对下列脚本的命令入口、目录范围与写入行为，未运行真实数据集处理。其他独立脚本不在本专题覆盖范围内。

## 入口与职责

- [core/resize.py](../../core/resize.py)：`resize_images_in_folder` 遍历输入目录下一级角色文件夹内的顶层图片。函数默认短边目标为 1200，但命令入口传入 1280；短边达到目标时等比例缩小，否则尺寸不变，均保存回原路径。当前 `rename` 分支计算的副本路径随后被原路径覆盖，不能依靠该参数另存副本。
- [core/reverse.py](../../core/reverse.py)：`reverse_images_in_folder` 将角色文件夹内的顶层图片水平翻转；命令入口从 `dataset-raw/` 读取，保存到 `reverse/<角色>/`。
- [core/edit_caption.py](../../core/edit_caption.py)：`process_text_files_in_dataset` 将一级子目录视为角色名，递归处理其中的 TXT。非空标签通过 `_process_single_caption_file` 将 `<角色> (<作品>)` 前置，并清除其余位置的同名角色标签；若该标签已位于首位则直接返回。命令入口使用 `DATASET_PATH = "./dataset-raw"` 与 `COPYRIGHT = "arknights"`，不自动插入 `1girl` 或独立作品标签。

这些命令需从仓库根目录执行。当前脚本不提供 WebUI 的修改预览与确认流程；LoRA 文件工具见 [LoRA 文件专题](lora-files.md)。使用命令见 [README.md](../../README.md)。

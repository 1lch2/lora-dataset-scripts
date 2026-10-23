# 独立图片与角色标签脚本

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-24。已核对 core 顶层全部 7 个旧工具脚本与当前系统的调用、算法及写入行为；preprocess.py 与 launch_webui.py 是现役入口，不计为旧工具。未运行真实数据集处理。

## 入口与职责

- [core/resize.py](../../core/resize.py)：`resize_images_in_folder` 遍历输入目录下一级角色文件夹内的顶层图片。函数默认短边目标为 1200，但命令入口传入 1280；短边达到目标时等比例缩小，否则尺寸不变，均保存回原路径。当前 `rename` 分支计算的副本路径随后被原路径覆盖，不能依靠该参数另存副本。
- [core/reverse.py](../../core/reverse.py)：`reverse_images_in_folder` 将角色文件夹内的顶层图片水平翻转；命令入口从 `dataset-raw/` 读取，保存到 `reverse/<角色>/`。
- [core/dataset_pipeline/edit_caption.py](../../core/dataset_pipeline/edit_caption.py)：`process_text_files_in_dataset` 将一级子目录视为角色名，递归处理其中的 TXT。非空标签通过 `_process_single_caption_file` 将 `<角色> (<作品>)` 前置，并清除其余位置的同名角色标签；若该标签已位于首位则直接返回。已并入包内，由 `Run.export` 传入暂存标签目录及配置的作品名；旧命令入口已删除，不自动插入 `1girl` 或独立作品标签。

这些命令需从仓库根目录执行。当前脚本不提供 WebUI 的修改预览与确认流程；LoRA 文件工具见 [LoRA 文件专题](lora-files.md)。使用命令见 [README.md](../../README.md)。

## 功能重合审计

以下为独立脚本合并时的审计记录。后续已新增 [数据集处理工具 tab](dataset-tools.md)，将缩放、镜像、去重接入可选择范围的另存流程；旧独立脚本仍未修改。

统计口径为业务处理能力及实际调用关系，不以代码行数或同名函数估算百分比。7 个旧工具中，3 个核心处理能力完全被当前流程使用，3 个部分重合，1 个无对应功能。完全重合的 3 个原本就是被主系统直接导入的唯一实现，此次迁入包内并改为相对导入，没有另造算法；旧命令入口移除。部分重合及无重合脚本保持原样。

| 旧工具 | 重合程度 | 当前对应与保留差异 | 处理 |
| --- | --- | --- | --- |
| edit_caption | 核心处理完全重合 | `Run.export` 原本直接调用其角色目录递归整理函数；当前流程另有词表清理、空标签预填和导出暂存，未将这些上游行为视为脚本能力 | 实现迁入包内，删除旧入口 |
| rename | 核心处理完全重合 | `/api/lora/files` 与 `/api/lora/rename` 直接使用同一预览、排序和两阶段改名实现 | 实现迁入包内，删除旧入口 |
| generate_lora_tag | 提示词生成完全重合 | `/api/lora/files` 直接使用相同排序、权重和文本格式；旧脚本通过 pyperclip 复制，网页通过浏览器复制 | 生成实现迁入包内，删除旧 CLI 与 pyperclip 适配 |
| resize | 缩放算法高度重合，整项仅部分重合 | `Run._materialize` 的 auto 模式使用相同 1280 短边、整数取整及 LANCZOS；独立函数可配置短边（默认 1200），遍历一级角色目录顶层并重写原文件，流水线处理候选、EXIF 和 PNG 缓存，导入完整图及 manual/prepared 不走此缩放 | 不改动 |
| addTags | 部分重合 | `apply_tag_operation` 支持前置/追加，但旧脚本支持任意正负插入位置、保留重复及下划线，并直接覆盖目录顶层和一级子目录 TXT；流水线会规范化、去重且只编辑所选已登记样本 | 不改动 |
| deduplicate | 目标部分重合，算法与处置不同 | 旧脚本为 OpenCV 灰度 8×8 平均哈希（虽注释称感知哈希）、阈值默认 10、按首图贪心成组，保留文件字节数最大者并移动/删除其余图片；analysis 为 SHA-256 精确重复及 9×8 dHash 近似配对，默认阈值 6，有采样和低对比度排除，只生成报告 | 不改动 |
| reverse | 无业务重合 | 独立生成水平镜像图片；当前流水线的 EXIF 方向校正不等于镜像增强，未找到对应批量增强功能 | 不改动 |

补充入口：[addTags.py](../../core/addTags.py)、[deduplicate.py](../../core/deduplicate.py)、[core.py](../../core/dataset_pipeline/core.py)、[analysis.py](../../core/dataset_pipeline/analysis.py)。现有像素对照验证见 [test_tag_materialize.py](../../tests/test_tag_materialize.py)，导出链路见 [test_preprocess.py](../../tests/test_preprocess.py)。LoRA 合并后的入口见 [LoRA 文件专题](lora-files.md)。

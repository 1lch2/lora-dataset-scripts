# 数据集处理工具

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-24。覆盖独立 tab、文件范围选择、后台预览和另存主链路；仅用合成图片验证，不代表真实素材质量验收。

## 入口

- [DatasetTools](../../app/src/Pages/tools/DatasetTools/DatasetTools.tsx)：桌面双栏工具页，选择已导入数据集的来源目录、当前审核数据集或自定义目录；扫描后按子目录、相对路径搜索和逐张勾选确定范围。筛选与选择分离，提供仅选筛选结果、追加筛选结果及清空选择。
- [api.ts](../../app/src/Pages/tools/DatasetTools/api.ts)、[types.ts](../../app/src/Pages/tools/DatasetTools/types.ts)：文件扫描、预览、执行、取消、状态轮询协议。
- [ReviewPage](../../app/src/Pages/review/ReviewPage/ReviewPage.tsx)、[Header](../../app/src/Pages/review/ReviewPage/__internal__/Header/Header.tsx)、[useReview](../../app/src/Pages/review/useReview.ts)：tab 接入；空白审核及独立分析会话均可使用，切换 tab 保留选择，不因打标完成跳离工具页。
- [review.py](../../core/dataset_pipeline/review.py)：`/api/tools/scan`、`preview`、`execute`、`cancel` POST 均校验会话 token；`/api/tools/status` 读取后台状态。工具处理期间拒绝删除数据集。
- [tools.py](../../core/dataset_pipeline/tools.py)：扫描普通本地文件、选择范围校验、图片及 TXT 指纹、后台处理和取消。每个服务器同时仅运行一个工具任务，预览 ID 绑定执行。

## 处理规则

- **短边缩放**：默认目标 1280，可设置 1–16384；短边达到目标才按比例用 LANCZOS 缩小，尺寸取整数，小图及无需改变尺寸的图片按原字节复制，不执行模型超分。
- **水平镜像**：校正 EXIF 方向后水平翻转另存；TXT 原样复制，不自动交换方向标签。
- **去重**：沿用旧 deduplicate 的 OpenCV 灰度 8×8 平均哈希、距离阈值默认 10、按首图贪心分组，每组保留字节数最大文件。按相对路径排序使结果稳定；阈值可设 0–64，0 也只表示哈希一致。预览列出每组保留项和重复项。分离保存时输出到 `kept/` 与 `duplicates/`；只导出去重结果时跳过重复项。原始图片不会被移动或删除。
- **输出**：所有工具只处理所选图片，保留相对目录和原文件名，同名 TXT（扩展名不区分大小写）一起复制；多个同名 TXT 会报错。输出必须是不存在的新目录，且不与输入重叠，不覆盖现有结果。导出目录可随后作为自定义输入或从首页导入。
- **预览**：显示尺寸变化、输出相对路径及去重分组；修改参数、输入选项或图片选择后必须重做预览。执行前核对全部图片与已有 TXT 的指纹，变化则拒绝执行。拒绝路径越界、符号链接、目录联接及多帧图片。
- **中断**：预览与执行在后台线程运行，支持取消。失败/取消时原图不变，已另存的文件保留，页面显示错误和输出目录；重试应选新目录。状态和预览保存在服务器内存中，重启后需重新扫描预览。

旧独立脚本入口已移除。工具页使用包内实现，所有处理均经显式范围选择、预览和另存流程。

验证入口：现有 Python 测试、前端构建，以及合成数据的 HTTP 检查。

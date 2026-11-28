# 图像降噪（Forge ScuNET 1×）

[返回功能导航](../feature-map.yaml)

核对日期：2026-11-28。覆盖「数据集工具 → 图像降噪」的单图和文件夹批量处理。可在导入数据集前使用。

- [ScunetPage](../../app/src/Pages/DatasetToolsPage/ScunetPage/ScunetPage.tsx) 采用双栏布局，左侧切换单张图片和文件夹批量、预览原图或填写目录，右侧提交任务并查看对比、PNG 下载或批量进度。单图上传支持 PNG、JPEG、WebP，最多 20 MiB。图片处理上限为 3600 万像素和单边 8192 像素。
- [server.py](../../webui/server.py) 提供 `POST /api/scunet/start`、`GET /api/scunet/status` 和 `GET /api/scunet/image`，复用会话校验、Forge 启动和任务互斥。单图结果暂存在服务内存中。批量逐张处理，反馈保存数量和失败项。
- [scunet.py](../../tools/scunet.py) 仅在输入目录以 `/**` 或 `\**` 结尾时递归。输出目录须与输入目录分开，可以是已有目录。PNG 结果沿用相对目录，文件名添加 `_denoised`，遇到同名文件自动编号。
- [forge.py](../../core/dataset_pipeline/forge.py) 提供模型列表和 `/sdapi/v1/extra-single-image` 调用。ScuNET 工具固定发送 `upscaler_1: ScuNET` 和 `upscaling_resize: 1`，复制图像边缘补齐 Forge 的尺寸对齐要求，返回后裁回原尺寸并恢复透明通道。

# 图像降噪（Forge 1× 与双模型融合）

[返回功能导航](../feature-map.yaml)

核对日期：2026-11-29。覆盖「数据集工具」左侧的图像降噪与降噪设置。可在导入数据集前使用。

- [ScunetPage](../../app/src/Pages/DatasetToolsPage/ScunetPage/ScunetPage.tsx) 采用双栏布局，左侧切换单张图片和文件夹批量、预览原图或填写目录，右侧提交任务并查看对比、PNG 下载或批量进度。单图上传支持 PNG、JPEG、WebP，最多 20 MiB。图片处理上限为 3600 万像素和单边 8192 像素。
- [DenoiseSettings](../../app/src/Pages/DatasetToolsPage/ScunetPage/__internal__/DenoiseSettings/DenoiseSettings.tsx) 从左侧「降噪设置」打开，读取运行中的 Forge 所列本地模型。单模型默认 ScuNET，融合默认关闭。开启融合后可分别选择提供亮度细节和色度的模型，推荐默认组合为 `1x_Manhwa_Null` 与 `ScuNET`。开关旁的问号提供下载链接和 Forge 安装目录。页面会话内的设置用于下一次任务。
- [server.py](../../webui/server.py) 提供 `POST /api/scunet/start`、`GET /api/scunet/models`、`GET /api/scunet/status` 和 `GET /api/scunet/image`，复用会话校验、Forge 启动和任务互斥。单图结果暂存在服务内存中。批量逐张处理，反馈保存数量和失败项。
- [scunet.py](../../tools/scunet.py) 仅在输入目录以 `/**` 或 `\**` 结尾时递归。输出目录须与输入目录分开，可以是已有目录。PNG 结果沿用相对目录，文件名添加 `_denoised`，遇到同名文件自动编号。
- [forge.py](../../core/dataset_pipeline/forge.py) 提供模型列表和 `/sdapi/v1/extra-single-image` 调用。降噪工具独立调用所选模型，倍率固定为 1×。输入复制图像边缘补齐 Forge 的尺寸对齐要求，返回后裁回原尺寸并恢复透明通道。
- [scunet_texture.py](../../tools/scunet_texture.py) 实现双模型融合和单模型的「保留排线（实验性）」。融合使用两个模型各自处理同一张原图的结果，在 YCbCr 中组合亮度和色度，仅加入原图差异的低频色调成分；单图与批量融合都另存为 `_denoised_fused` PNG。单模型保留排线时，将亮度按原图和模型各 50% 混合并采用模型的色度，单图下载名以 `_denoised_texture.png` 结尾。双模型模式独立应用融合算法。

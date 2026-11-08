# 图像降噪

[返回功能导航](../feature-map.yaml)

核对日期：2026-11-08。覆盖独立单图页、现有 Forge 超分调用、CPU L0、任务状态、原图对比与 PNG 下载。不依赖已导入的数据集。

## 入口与职责

- [DenoisePage](../../app/src/Pages/denoise/DenoisePage/DenoisePage.tsx)：点击或拖入 PNG / JPEG / WebP，上传后右侧原图预览按容器宽高完整显示，支持重新选择或拖入新图片替换；三档预设、预缩放比例、超分模型及 L0 开关与强度；TanStack Query 提交和轮询任务，切换 tab 保留状态。
- [ImageCompare](../../app/src/Pages/denoise/DenoisePage/__internal__/ImageCompare/ImageCompare.tsx)：同一坐标系叠放原图与结果，指针拖动及键盘滑块调整分割线，支持原图 / 结果模式、适应宽度、100% / 200% 与容器滚动。
- [api.ts](../../app/src/Pages/denoise/DenoisePage/api.ts)：复用同源请求与会话 token，读取图片后提交，预览与下载使用同一结果 URL。
- [ReviewPage](../../app/src/Pages/review/ReviewPage/ReviewPage.tsx)、[Header](../../app/src/Pages/review/ReviewPage/__internal__/Header/Header.tsx)、[useReview](../../app/src/Pages/review/useReview.ts)：接入 `denoise` tab，沿用桌面工具页布局，避免后台降噪完成触发数据集打标或导出反馈。
- [server.py](../../webui/server.py)：`POST /api/denoise/start`、`POST /api/denoise/models`、`GET /api/denoise/status`、`GET /api/denoise/image`。沿用现有后台线程、全局任务互斥、本地 Host 与写请求会话校验，通过原 `model_setup` 按需启动 Forge。没有取消接口；断开请求不会被视为取消。
- [denoise.py](../../tools/denoise.py)：格式与资源验证、EXIF 转向、Alpha 分离、BOX 缩小、调用选定模型、LANCZOS 恢复原尺寸、可选 CPU NumPy float64 L0、恢复 Alpha 与 PNG 编码。固定输入 FFT 和差分频谱在迭代中复用，联合 RGB 梯度阈值，`beta` 倍增至 `1e5`。
- [forge.py](../../core/dataset_pipeline/forge.py)：模型列表来自 `/sdapi/v1/upscalers`；降噪传入 `model` 选择单模型和接口声明的原生倍率，禁用辅助模型混合，接受实际返回尺寸。原有未传 `model` 的超分继续保留配置混合与 8 像素尺寸校验；连接地址和超时仍共用 `ForgeClient.request`。
- [上游 MIT 许可](../../third_party/gpt-anime-denoise-LICENSE)：L0 改编来源为 [gpt-anime-denoise/denoise.py](https://github.com/CXP-2024/gpt-anime-denoise/blob/main/denoise.py)，源文件记录版本；不复制模型推理或权重。

输入文件最多 20 MiB；超过 400 万像素或单边 8192 的图片仍可在前端预览和替换，但上传区显示处理限制并禁用开始降噪，后端处理上限不变。读取与格式校验反馈紧邻上传区显示。预计及返回超分图最多 3600 万像素。接口必须提供有效原生倍率，模型路径若指向下载 URL 则拒绝调用，避免触发 Forge 下载权重。Forge 内部仍可能将结果对齐到 8 的倍数，后续恢复以实际图像为准。

输入与最后一次结果仅保留在当前服务内存中，不写入数据集；重新降噪会替换结果，服务重启后清空。下载 PNG 保存到浏览器选择的位置。没有新增依赖、批处理、局部保护笔刷或 GPU L0。

## 验证入口

[test_denoise.py](../../tests/test_denoise.py)：聚焦 L0 去噪与边缘保留、透明度与输出尺寸、资源限制及禁止自动下载模型，以及本地模拟 Forge HTTP 处理成功与失败链路。模拟服务验证不代表真实模型效果评估。

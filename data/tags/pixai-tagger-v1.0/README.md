# PixAI meta 类别表

`meta.json` 来自当前插件使用的 [PixAI mixed BF16 config.json](https://huggingface.co/DraconicDragon/pixai-tagger-v1.0-mixed-bf16/blob/b7b4ce5b5d8e3c24a1171ff2b266e3345761eb0e/config.json)，revision 为 `b7b4ce5b5d8e3c24a1171ff2b266e3345761eb0e`。

按 `tags_split` 的类别区间提取 `meta` 对应的全部 145 个标签；不加载权重、不运行模型代码。当前模型词表没有 `masterpiece`，客户端额外明确排除此标签。

2026-10-29 核对本机插件：`tagger/ui.py` 支持分类阈值，但 `tagger/api_models.py` 与 `tagger/api.py` 的 HTTP 单图接口仅支持统一阈值，不执行界面排除规则。因此当前由本项目接收结果后、保存模型证据和合并 TXT 前按完整类别表排除。不会向 API 发送不受支持而被静默忽略的选项。

如果更新 PixAI 模型词表或切换模型版本，应同步重新提取类别表，并重新核对插件 HTTP API。当前功能仅支持文档所列模型。

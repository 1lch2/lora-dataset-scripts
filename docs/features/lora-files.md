# LoRA 文件重命名与效果对比提示词

[返回功能导航](../feature-map.yaml)

核对日期：2026-09-27。已核对新分页、文件预览、重命名与提示词生成的 API 主链路。默认目录为仓库根目录 `output/`，也可在页面输入其他本地目录；普通审核与独立分析入口均可打开此页。

## 入口与职责

- [LoraTools](../../app/src/Pages/lora/LoraTools/LoraTools.tsx)：目录输入、文件列表、重命名预览、执行反馈、提示词展示与浏览器剪贴板复制。
- [client.ts](../../app/src/api/client.ts)：`getLoraFilesInfo` 与 `renameLoraFiles` 请求；后者携带会话 token 和当前预览。
- [ReviewPage](../../app/src/Pages/review/ReviewPage/ReviewPage.tsx)：挂载 LoRA 分页；页头标签与阶段切换沿用审核页状态。
- [review.py](../../core/dataset_pipeline/review.py)：`/api/lora/files` 返回文件、预览及提示词；`/api/lora/rename` 校验会话并执行重命名。独立分析入口也开放这两个接口。
- [rename.py](../../core/rename.py)：按文件名前缀分组，将数字序号整理为从 0 开始的连续编号；无序号文件排在组末。执行前核对当前预览，改名时先使用临时文件名避免目标占用。
- [generate_lora_tag.py](../../core/generate_lora_tag.py)：按数字序号生成每行一个、权重为 1 的 LoRA 效果对比提示词。命令行入口仍可复制到系统剪贴板，WebUI 在浏览器中复制。

仅处理目录顶层 `.safetensors` 文件；其他文件保留原状。页面上的重命名必须由用户点击执行。现有验证入口为前端构建与临时目录的 HTTP 冒烟检查，未新增单元测试。

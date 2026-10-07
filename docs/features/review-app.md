# 审核前端与 Python 目录

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-07。覆盖 React 入口、空白启动、数据集接入/切换/同步、手动超分/识别与裁切/标签 API 主链路；检测模型内部未在本专题展开。

## 入口与职责

- [app/src/main.tsx](../../app/src/main.tsx)：React StrictMode 与 TanStack Query Provider。
- [app/src/App/App.tsx](../../app/src/App/App.tsx)：从 `/api/session` 获取审核会话，再挂载页面。
- [ReviewPage](../../app/src/Pages/review/ReviewPage/ReviewPage.tsx)：组合页头、图片库、裁切编辑、标签工具、分析页、LoRA 文件工具、底部状态与大图弹窗；专属一级组件位于同目录 `__internal__/`。
- [useReview](../../app/src/Pages/review/useReview.ts)：审核状态、裁框草稿、阶段切换、编辑 mutation、任务轮询与提示；服务端数据由 TanStack Query 管理，客户端状态使用 Hooks。
- [DatasetManager](../../app/src/Pages/review/ReviewPage/__internal__/DatasetManager/DatasetManager.tsx)：空白会话的目录选择、已接入运行列表与切换；只导入文件，按 TXT 存在与否识别成品/纯图片，纯图片提供按当前身份范围超分和识别的独立按钮。
- [useTags](../../app/src/Pages/review/useTags.ts)：筛选、选择、图片过滤篮、标签统计与操作范围。
- [CropCanvas](../../app/src/Pages/review/CropCanvas/CropCanvas.tsx)：原裁框坐标与拖动算法；通过 ref 管理 Canvas 与图片加载，卸载时释放 ResizeObserver。
- [styles.module.css](../../app/src/Pages/review/ReviewPage/styles.module.css)：保留原页面选择器、数值、媒体查询。全局选择器用于保持已有 DOM 样式契约，局部 `.page` 不生成布局盒。
- [app/src/api/client.ts](../../app/src/api/client.ts)：同源请求与会话 token；请求 URL、操作载荷沿用 Python 协议。
- [core/dataset_pipeline/review.py](../../core/dataset_pipeline/review.py)：API、图片、编辑/后台任务、会话，以及可选的 `app/dist` 静态资源。
- [core/dataset_pipeline/datasets.py](../../core/dataset_pipeline/datasets.py)：发现运行、验证目录并生成独立路径；`import_config` 按目录中是否有 TXT 选择 `prepared` / `manual`，`import_sources` 只复制原始图片和同名标签，保留未变化的审核记录；`upscale_source` 只更新工作图并映射已有裁框，`detect_source` 在当前工作图生成候选并保留已审核/编辑的裁框。
- [core/dataset_pipeline/core.py](../../core/dataset_pipeline/core.py)：保留原来的运行记录、预处理、标签与导出组织；其相邻模块的相对导入不变。
- [core/dataset_pipeline/geometry.py](../../core/dataset_pipeline/geometry.py)：`default_scale` 决定按尺寸超分倍率；总像素小于 `1024² × 80%` 时为 1.5 倍，其余为 1 倍。网页 `start_upscale` 只处理需要提高倍率的图片；CLI `Run.prepare_source` 仍支持完整自动预处理，手动或保存的 `scale_override` 优先。

网页首次进入只读取状态，不加载目录；空白会话返回 `datasetLoaded=false`。显式导入、打开已接入数据集或顶部刷新通过带会话 token 的 `sync_sources` 调用 `import_sources`，不执行图片处理；切换重置筛选和选择。`start_upscale`、`start_detect`、`start_tag` 与导出共用任务互斥；前两者接受 `group` 指定角色范围。含 TXT 的成品禁止自动超分/识别，缺少对应 TXT 的图片以空标签导入并提示；已有标签编辑优先。导入成品保留原格式与尺寸，导出沿用实际图片扩展名，避免 JPEG 字节被错误命名为 PNG。

文件名称由 `import_sources` 记录：`preserve_filename` 标记导入素材，原图片存入版本父目录并保留 `relative` 的原名、扩展名大小写与层级；`caption_name` 与标签的 `caption` 路径保留原 TXT 名称。旧记录同步时更新完整图及标签存储路径，保留当前编辑。`Run.tag_file` 统一读写已登记的标签路径；`_materialize` 对导入完整图返回原文件。`Run.export` 按原相对路径导出完整图和标签，图片直接复制源字节；标签先按角色清理再写入原路径，冲突在写入输出目录前报错。新裁片仍使用生成名称和 PNG，其他几何处理不受此命名规则影响。

Python 源文件整体移入 `core/`，原顶层脚本与 `dataset_pipeline/` 的相对关系不变。数据、配置、虚拟环境、测试与 BAT 仍在仓库根目录。原脚本中相对 `__file__` 的数据目录已校正到仓库根目录。

## 开发与验证

在 `app/` 执行 `npm install`、`npm run dev`、`npm run build`。Vite 默认代理 `http://127.0.0.1:8765` 的 `/api` 与 `/image`；启动器通过 `REVIEW_API_URL` 传递所选 API 端口。生产构建输出 `app/dist/`；Python API 可在构建后直接提供该产物。

Python 验证从根目录执行：

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'core')
.venv-preprocess/Scripts/python.exe -m unittest discover -s tests
```

现有验证入口：[test_preprocess.py](../../tests/test_preprocess.py)、[test_tag_editing.py](../../tests/test_tag_editing.py)、[test_tag_materialize.py](../../tests/test_tag_materialize.py)、[test_datasets.py](../../tests/test_datasets.py)。数据集接入检查使用合成图片，通过本地 HTTP API 核对目录同步、切换、成品尺寸、TXT 与审核记录保留；不代表真实模型运行验证。

相关专题：[启动链](launcher.md)、[数据集分析](dataset-analysis.md)、[LoRA 文件工具](lora-files.md)。

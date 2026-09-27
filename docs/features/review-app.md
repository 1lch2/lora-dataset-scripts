# 审核前端与 Python 目录

[返回功能导航](../feature-map.yaml)

核对日期：2026-09-27。覆盖 React 入口、裁切/标签状态与 API 主链路；检测和预处理算法内部未在本专题展开。

## 入口与职责

- [app/src/main.tsx](../../app/src/main.tsx)：React StrictMode 与 TanStack Query Provider。
- [app/src/App/App.tsx](../../app/src/App/App.tsx)：从 `/api/session` 获取审核会话，再挂载页面。
- [ReviewPage](../../app/src/Pages/review/ReviewPage/ReviewPage.tsx)：组合页头、图片库、裁切编辑、标签工具、分析页、LoRA 文件工具、底部状态与大图弹窗；专属一级组件位于同目录 `__internal__/`。
- [useReview](../../app/src/Pages/review/useReview.ts)：审核状态、裁框草稿、阶段切换、编辑 mutation、任务轮询与提示；服务端数据由 TanStack Query 管理，客户端状态使用 Hooks。
- [useTags](../../app/src/Pages/review/useTags.ts)：筛选、选择、图片过滤篮、标签统计与操作范围。
- [CropCanvas](../../app/src/Pages/review/CropCanvas/CropCanvas.tsx)：原裁框坐标与拖动算法；通过 ref 管理 Canvas 与图片加载，卸载时释放 ResizeObserver。
- [styles.module.css](../../app/src/Pages/review/ReviewPage/styles.module.css)：保留原页面选择器、数值、媒体查询。全局选择器用于保持已有 DOM 样式契约，局部 `.page` 不生成布局盒。
- [app/src/api/client.ts](../../app/src/api/client.ts)：同源请求与会话 token；请求 URL、操作载荷沿用 Python 协议。
- [core/dataset_pipeline/review.py](../../core/dataset_pipeline/review.py)：API、图片、编辑/后台任务、会话，以及可选的 `app/dist` 静态资源。
- [core/dataset_pipeline/core.py](../../core/dataset_pipeline/core.py)：保留原来的运行记录、预处理、标签与导出组织；其相邻模块的相对导入不变。

Python 源文件整体移入 `core/`，原顶层脚本与 `dataset_pipeline/` 的相对关系不变。数据、配置、虚拟环境、测试与 BAT 仍在仓库根目录。原脚本中相对 `__file__` 的数据目录已校正到仓库根目录。

## 开发与验证

在 `app/` 执行 `npm install`、`npm run dev`、`npm run build`。Vite 默认代理 `http://127.0.0.1:8765` 的 `/api` 与 `/image`；启动器通过 `REVIEW_API_URL` 传递所选 API 端口。生产构建输出 `app/dist/`；Python API 可在构建后直接提供该产物。

Python 验证从根目录执行：

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'core')
.venv-preprocess/Scripts/python.exe -m unittest discover -s tests
```

现有验证入口：[test_preprocess.py](../../tests/test_preprocess.py)、[test_tag_editing.py](../../tests/test_tag_editing.py)、[test_tag_materialize.py](../../tests/test_tag_materialize.py)。本次只适配现有测试的会话获取方式，未增加单元测试。

相关专题：[启动链](launcher.md)、[数据集分析](dataset-analysis.md)、[LoRA 文件工具](lora-files.md)。

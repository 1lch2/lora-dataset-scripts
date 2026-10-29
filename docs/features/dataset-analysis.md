# 本地数据集分析

[返回功能导航](../feature-map.yaml)

核对日期：2026-09-27。已核对前端表单、后台任务、报告展示及内部工作进程；统计公式内部未在本次重构中修改。

- [AnalysisView](../../app/src/Pages/analysis/AnalysisView/AnalysisView.tsx)：原分析表单、报告操作和逐图筛选分页；`__internal__/` 中拆分 Histogram、Metrics、Similarity。
- [useAnalysis](../../app/src/Pages/analysis/useAnalysis.ts)：TanStack Query 轮询、任务 mutation、JSON/CSV 下载及本地对照报告。
- [review.py](../../core/dataset_pipeline/review.py)：`/api/analysis/*` 路由与会话校验。
- [analysis_job.py](../../core/dataset_pipeline/analysis_job.py)：启动、取消分析子进程；工作目录仍为 `dataset_pipeline` 的父目录，迁移后为 `core/`，确保模块导入成立。
- [analysis.py](../../core/dataset_pipeline/analysis.py)：统计与报告算法保持原状。
- [analysis_worker.py](../../core/dataset_pipeline/analysis_worker.py)：仅供 `AnalysisJob` 启动的离线子进程，从标准输入读取后台生成的 JSON 任务；不提供用户 CLI 参数。报告与进度写到任务临时目录，由 WebUI 提供下载。

已有验证：[test_analysis.py](../../tests/test_analysis.py)。使用说明：[ANALYSIS.md](../../ANALYSIS.md)。

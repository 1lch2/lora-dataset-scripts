# 本地数据集分析

[返回功能导航](../feature-map.yaml)

核对日期：2026-09-27。已核对前端表单、后台任务、报告展示及 CLI 入口；统计公式内部未在本次重构中修改。

- [AnalysisView](../../app/src/features/analysis/AnalysisView/AnalysisView.tsx)：原分析表单、报告操作和逐图筛选分页；`__internal__/` 中拆分 Histogram、Metrics、Similarity。
- [useAnalysis](../../app/src/features/analysis/useAnalysis.ts)：TanStack Query 轮询、任务 mutation、JSON/CSV 下载及本地对照报告。
- [review.py](../../core/dataset_pipeline/review.py)：`/api/analysis/*` 路由与会话校验。
- [analysis_job.py](../../core/dataset_pipeline/analysis_job.py)：启动、取消分析子进程；工作目录仍为 `dataset_pipeline` 的父目录，迁移后为 `core/`，确保模块导入成立。
- [analysis.py](../../core/dataset_pipeline/analysis.py)：统计与报告算法保持原状。
- [preprocess.py](../../core/preprocess.py)：`analyze` 独立入口，默认 API 8766 / Vite 5174，不要求 Forge 或运行记录。

已有验证：[test_analysis.py](../../tests/test_analysis.py)。使用说明：[ANALYSIS.md](../../ANALYSIS.md)。

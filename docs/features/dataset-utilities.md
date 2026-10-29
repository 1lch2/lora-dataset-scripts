# 共享角色标签整理与旧工具迁移

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-29。数据集处理统一从 WebUI 使用，旧独立脚本及预处理 CLI 已移除。

## 现有实现

- [edit_caption.py](../../core/dataset_pipeline/edit_caption.py)：由 `Run.export` 显式传入暂存标签目录与作品名，递归整理角色标签前缀；没有默认素材目录，也不提供命令入口。
- [core.py](../../core/dataset_pipeline/core.py)：审核、打标、标签批量操作与导出。历史自动流程的内部处理方法保留，用于已有运行记录与回归验证，不再提供用户 CLI。
- [数据集处理工具](dataset-tools.md)：网页缩放、镜像、去重采用显式选择范围和另存语义，不覆盖或移动原始素材。
- [审核前端](review-app.md)：标签批量前置、追加、删除、替换和排序均在网页预览后应用。旧加标签脚本的任意位置插入及直接覆盖目录 TXT 行为不再提供独立入口。
- [LoRA 文件工具](lora-files.md)：网页重命名和对比提示词。

现有验证：[test_tag_materialize.py](../../tests/test_tag_materialize.py) 保留历史裁片缩放的像素与缓存检查，[test_preprocess.py](../../tests/test_preprocess.py) 覆盖处理、审核及导出。分析内部进程见[数据集分析](dataset-analysis.md)。

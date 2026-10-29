# 单模型与混合打标

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-29。覆盖独立打标 tab、Forge 模型调用、合并证据、置信度过滤及源 TXT 恢复。

## 入口与实现

- [Header](../../app/src/Pages/review/ReviewPage/__internal__/Header/Header.tsx)：打标 tab 位于裁切之后、标签编辑之前；未加载数据集时禁用。页头不再直接启动打标。
- [Tagging](../../app/src/Pages/review/ReviewPage/__internal__/Tagging/Tagging.tsx)：选择 WD EVA02 Large v3、PixAI v1.0 或混合模式；整个数据集全部已接受样本运行，待审裁框阻止启动。有旧标签时要求确认替换；完整打标数据集常驻提示，并提供重新导入源 TXT。
- [taggingUtils](../../app/src/Pages/review/ReviewPage/__internal__/Tagging/taggingUtils.ts)：前端合并预览、互斥分组与热力图分箱。主视图按共同支持 → WD 补充 → PixAI 补充 → 已过滤的优先级归组，保留条件与后端一致；分组表示保留依据，不是准确率。
- [tagging.py](../../core/dataset_pipeline/tagging.py)：输入校验、双模型同图推理、完整证据保存、合并和源标签恢复。任一模型失败保留该样本原有标签并报告错误；任务逐样本写入，已成功样本不会因后续样本失败回滚。重新运行会重新请求全部已接受样本，不复用旧标签跳过推理。
- [forge.py](../../core/dataset_pipeline/forge.py)：单次调用接受明确模型及采集阈值；使用现有 `/tagger/v1/interrogators` 和 `/tagger/v1/interrogate`。
- [review.py](../../core/dataset_pipeline/review.py)：`start_tag` 的 `tagging` 参数开启新流程，`replaceConfirmed` 防止未确认覆盖；`filter_tagging` 和 `restore_captions` 均受会话、运行锁及后台任务互斥保护。旧的无 `tagging` 参数调用仍保留历史行为。
- [PixAI 类别资源](../../data/tags/pixai-tagger-v1.0/README.md)：固定版本完整 meta 表。当前插件分类阈值仅有 UI 支持，HTTP 不支持；客户端在证据与 TXT 合并前过滤全部 meta 和 `masterpiece`。rating 响应不参与训练标签。

## 分数与工作标签

两模型均以 0.01 采集下限请求，保存 `tag.evidence.scores` 中各自的原始分数。规范化下划线和空格，不平均跨模型分数、不将未返回当作 0 分。达到任一模型独立接受下限，或同时达到两项共同支持下限，即进入合并结果。保留现有裁框几何冲突排除。

四项下限可在 0.01–1.00 间调整，先预览再明确应用到全部有效模型结果或某个样本。应用只重算保存的分数，不再次推理；旧标签人工编辑会被替换，界面要求确认。原始证据不变，降低下限可恢复被过滤标签；采集下限以下结果及 meta 不可恢复。现有标签编辑页保持独立，本轮未添加逐标签人工审核。

主视图默认展示全部保留项，四个分组可点击筛选标签明细；WD / PixAI 独立下限放在对应组内，共同支持的两项下限默认折叠。顶部显示保留、过滤及相对当前工作标签的新增/移除数量，可单独查看变化；工作 TXT 中没有模型分数的标签也参与移除预览，避免漏报被覆盖的编辑。列表显示两套独立分数条、保留依据及应用后的变化；选择单样本时显示图片预览。分组、搜索及分页不缩小实际应用范围。

原二维热力图移至底部“额外参考”，默认折叠，展开后才挂载矩阵。灰阶表示原始分数区间内图片—标签数量，“未返回”单独分箱；原始返回重合率包含低分候选，不等于共同支持率或准确率。点击格子只筛选明细，收起时清除格子筛选；无模型分数的工作标签不计入热力图。

工作 TXT 和当前 manifest 标签同步写入，历史记录保留；导入来源图片及 TXT 不写入。完整打标数据集的“重新导入源 TXT”重新读取同名标签，恢复完整图工作标签，不处理裁片；源图片变化或主体底图被替换时拒绝恢复，避免套错标签。普通刷新及主页重复导入仍按既有规则保留工作编辑，不等于恢复。

标签成功写入后沿用现有 `tag_current` 和导出协议。完成打标保留在打标 tab；前往标签页可继续既有编辑和导出。模式与过滤参数记录在运行的 `tagging_options` 中。

## 验证边界

现有回归入口：[test_tag_materialize.py](../../tests/test_tag_materialize.py)、[test_tag_editing.py](../../tests/test_tag_editing.py)、[test_datasets.py](../../tests/test_datasets.py)。这些已有测试主要覆盖原打标、导出及导入兼容；双模型推理与阈值交互需另做 HTTP 和浏览器验证，不能由前端构建推断已运行模型。

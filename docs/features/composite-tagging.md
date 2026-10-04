# 未标注数据集复合打标

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-04。已接入独立页签、任务 API、实际 Forge 推理和输出。原 OpenPose 标签审查实现及其词表提取入口已移除；`vision.py`、裁切几何和数据集姿态相似分析继续保留。

## 使用

在“复合打标”页签填写图片目录、输出根目录与 Forge 地址，点击“开始复合打标”。独立分析模式也能使用，不要求裁切审核记录。输入或切换页签不触发模型推理。

模型名称读取 preprocess JSON：`tagger_model` 指定 WD，`pixai_tagger_model` 指定 PixAI，默认分别为 `wd-eva02-large-tagger-v3` 和 `pixai-tagger-v1.0`。BAT 启动使用本次加载的配置；直接 review 使用运行记录中的配置，旧记录缺少 PixAI 字段时补默认值。独立 analyze 可用 `--config preprocess.local.json` 指定配置，不指定则使用默认模型。修改配置后须重启审核服务，已运行的服务不会热加载。模型值是 Forge API 的注册键；替换 PixAI 模型仍须与内置类别词表兼容。任务与证据文件记录实际使用的模型名。

输出根目录必须不存在或为空，且不能与输入目录相同或互相包含。输入按相对目录保留层次；已有同名 TXT（包括空 TXT）的图片跳过。同目录同名但扩展名不同的未标注图片会在任务开始前报错，避免 TXT 冲突。源图片和标签只读，不覆盖旧输出。

```text
输出根目录/
  dataset/子目录/example.png
  dataset/子目录/example.txt
  probabilities/子目录/example.json
  evidence/子目录/example.json
  job.json
  report.json
```

训练仅使用 `dataset/`。`probabilities` 的 JSON 是平面的 `tag: probability` 对象，标签与最终 TXT 一致。`evidence` 保存两模型全部概率、各自过滤结果、合并前标签、单人判据、移除动作及获胜证据、同分待核项、阈值、规则版本和图片 SHA-256。原始推理概率可包含被排除的 meta，但它们不会进入训练 TXT 或最终概率 JSON。

取消在当前模型请求返回后生效，不再运行下一个模型或写出当前未完成样本；已经成功的样本保留。单张失败不会生成不完整的图片/TXT/概率组合，其余图片继续。报告保存逐图错误。取消或失败后可从报告定位剩余图片，在新的输出目录重跑；本阶段没有断点续跑合并旧目录功能。

## 入口与实现

- [CompositeTagging](../../app/src/Pages/composite/CompositeTagging/CompositeTagging.tsx)：目录表单、任务进度、结果、动作移除证据及错误；TanStack Query 管理请求和轮询。
- [api.ts](../../app/src/Pages/composite/api.ts)：`getCompositeJobInfo`、`startCompositeTagging`、`cancelCompositeTagging`。
- [review.py](../../core/dataset_pipeline/review.py)：`GET /api/composite/status`、`POST /api/composite/start`、`POST /api/composite/cancel`，复用本机会话 token；与原审核后台任务互斥启动。
- [composite_job.py](../../core/dataset_pipeline/composite_job.py)：输入预检、可取消后台线程、逐图依次调用两模型、输出目录隔离与逐项失败回滚。
- [forge.py](../../core/dataset_pipeline/forge.py)：`tag_bytes` 使用同一份图片字节调用不同模型，API 请求阈值为 0，保留原始概率；最终阈值过滤在本项目中完成。
- [composite_tags.py](../../core/dataset_pipeline/composite_tags.py)：类别过滤、同义动作归一化、单人标签判据、最大值合并与互斥动作消解。
- [action_conflicts.json](../../core/dataset_pipeline/action_conflicts.json)：人工维护的动作族、同义词、明确互斥关系和中文理由。
- [tagger_catalog.json](../../core/dataset_pipeline/tagger_catalog.json)：PixAI 类别及 meta 排除快照，运行时不依赖 Forge 扩展的本地安装路径。
- [build_tagger_catalog.py](../../core/build_tagger_catalog.py)：从 Danbooru CSV 和固定 PixAI 配置重新生成类别快照。

## 标签合并规则

1. WD 使用 `wd-eva02-large-tagger-v3`，阈值 0.30。
2. PixAI 使用 `pixai-tagger-v1.0`：general 0.17、character 0.27、style 0.15、copyright 0.24；meta 和 rating 不进入训练标签。插件默认 meta 0.17、rating 0.41 作为参数记录保留。
3. 去掉所有已知 meta：PixAI meta 类、Danbooru CSV 类别 5（包括其同义词）以及明确质量词 `highres`、`absurdres`、`best quality` 等。不以出现数量限制 meta 排除。
4. 所有下划线换为空格，不转义括号；动作同义词按清单统一，其余标签不做无关语义合并。
5. 保留任一模型达到其阈值的标签，并取两个模型原始概率的最大值作为合并分数。这是比较规则，不代表校准后的真实概率，不取平均。
6. 检查动作族的直接互斥关系。族内以最高分标签代表证据，保留分数较高的动作族，移除较低动作族的相关标签，避免删除 `standing` 后遗留冲突的 `standing on one leg`。完全相等时保留并显示待核。非互斥动作不因属于同一连通关系而被删除。

例如 WD 的 standing=0.4、sitting=0.8，PixAI 的 standing=0.9、sitting=0.2：合并后 standing=0.9，sitting=0.8，单人条件成立时移除 sitting。TXT 与概率 JSON 都保留 standing，处理记录保留被删除标签及原因。

## 单人条件与互斥范围

自动消解要求两个模型各自过滤后都有 `solo`；任一模型出现多人数量标签、跨性别/人物类别的数量冲突、多视图、漫画分格、动作序列、额外肢体等证据时不自动删除。多人、人数不明和同分情况保留标签并显示待核。这里是模型标签支持的单人推断，不是视觉真值保证；两模型共同漏掉第二个人仍可能误判。

清单沿用前期从 Danbooru `category=0`、`count>=200` 筛选出的常见姿态，当前直接互斥包括：

- 站立与坐下、躺卧、跪姿、完全蹲姿；坐下与躺卧。
- 单手与双手上举；单臂与双臂上举。
- 单臂／双臂上举与双臂垂在身体两侧。
- 单腿与双腿上举。

不把“抬手与抬臂”“坐姿与抬腿”“站立与行走”“坐姿与跪姿（如 seiza）”列为互斥；不把半躺、部分蹲姿硬归入相邻状态。不处理服饰、发色、物体、内容评级等非动作冲突。

语义参考 Danbooru 的 [standing](https://safebooru.donmai.us/wiki_pages/standing)、[sitting](https://safebooru.donmai.us/wiki_pages/sitting)、[arms_up](https://safebooru.donmai.us/wiki_pages/arms_up)。规则限定于同一个人在同一时刻的姿态；单复数按词条单侧／双侧语义解释。模型分数更高不能证明画面更正确，冲突删除记录必须保留供后续复核。

## 维护与验证

类别快照固定到 PixAI mixed-BF16 revision `b7b4ce5b5d8e3c24a1171ff2b266e3345761eb0e`。模型标签词表更新后，用 `python core/build_tagger_catalog.py <danbooru.csv> <PixAI config.json> core/dataset_pipeline/tagger_catalog.json` 更新。API 返回未收录的 PixAI 标签时明确报错，不猜类别以免漏掉 meta。

本次通过前端构建、临时 HTTP 端到端场景（单人、多人数不明、多视图、同分、可共存动作、已有标签、部分 API 失败、取消、并发及路径保护），并在浏览器新页签通过实际 Forge 完成 13 张临时无标签图片的双模型任务。输出图片字节一致、TXT/概率配对、meta 排除与目录隔离已核对。真实样本触发站坐和单手／双手两处消解；这证明程序按规则执行，不等于确认模型结论的视觉准确率。未新增单元测试。

# 审核前端与 Python 目录

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-22。覆盖 React 入口、启动主页、数据集接入/切换/同步、手动超分/识别与裁切/标签 API 主链路；检测模型内部未在本专题展开。

## 入口与职责

- [app/src/main.tsx](../../app/src/main.tsx)：React StrictMode 与 TanStack Query Provider。
- [app/src/App/App.tsx](../../app/src/App/App.tsx)：从 `/api/session` 获取审核会话，再挂载页面。
- [ReviewPage](../../app/src/Pages/review/ReviewPage/ReviewPage.tsx)：组合页头、启动主页、图片库、裁切编辑、标签工具、分析页、LoRA 文件工具、底部状态与大图弹窗；主页隐藏审核工作区与底部状态，专属一级组件位于同目录 `__internal__/`。
- 页头“设置”由 [Settings](../../app/src/Pages/review/ReviewPage/__internal__/Settings/Settings.tsx) 管理 Forge 目录和处理参数，首次未配置时自动打开；持久化、固定插件来源和内置 CSV 见[启动链的网页配置](launcher.md#网页配置)。
- [useReview](../../app/src/Pages/review/useReview.ts)：审核状态、裁框草稿、阶段切换、编辑 mutation、任务轮询与提示；服务端数据由 TanStack Query 管理，客户端状态使用 Hooks。
- [DatasetManager](../../app/src/Pages/review/ReviewPage/__internal__/DatasetManager/DatasetManager.tsx)：IDE 风格主页，提供已有数据集的名称/路径搜索、打开、刷新，以及显式选择完整打标/待处理类型后填写目录的导入表单；工作区显示当前目录与切换入口，待处理模式顶部明确标注超分和主体识别作用于数据集全部图片，不受筛选影响。
- [useTags](../../app/src/Pages/review/useTags.ts)：筛选、选择、图片过滤篮、标签统计与操作范围。
- [Library](../../app/src/Pages/review/ReviewPage/__internal__/Library/Library.tsx)：左侧图片列表与当前图选择；按筛选后的显示顺序从 1 编号，序号以独立背景色块显示在文件名前。
- [CropCanvas](../../app/src/Pages/review/CropCanvas/CropCanvas.tsx)：图片四周增加长边 4% 的背景留白，让贴边手柄完整显示并可从留白区域起拖；绘制与鼠标坐标扣除留白偏移，选框新建、移动和缩放均限制在图片内，保存坐标仍相对图片。普通裁切与主体裁切共用该逻辑；通过 ref 管理 Canvas 与图片加载，卸载时释放 ResizeObserver。
- [CropEditor](../../app/src/Pages/review/ReviewPage/__internal__/CropEditor/CropEditor.tsx)：裁切审核与倍率/主体设置，提供“识别此图主体”的单图后台任务；仅在当前图检测到人物时显示主体下拉框及生成主体裁框按钮。倍率选项根据 `original_size` 在括号内显示输出分辨率，不放大保留原尺寸，1.5/2 倍按后端 Python `round` 的中点取偶规则对齐到 8 的倍数。
- CropEditor 的完整图按钮右侧提供“裁切主体”：画布切换为当前完整底图，在原图坐标内手动画框后应用；恢复入口在存在 `original_backup` 时显示。取消只放弃草稿，应用及恢复调用 `useReview.replaceSourceImage` 并清理本图的编辑选择。
- 工作区文件名后显示灰底分辨率标记，与左侧序号共用基础样式；普通裁切显示 `working_size`，主体裁切模式显示 `original_size`，对应当前画布的图片尺寸，不包含画布留白。
- “删除裁切”对未保存画框丢弃草稿，对已保存候选调用 `delete_crop`；`Run.delete_crop` 保留删除历史并从活动候选数组移除对应项，完整图禁止删除。`advanceReview` 从删除项原位置继续定位待审候选。`/api/state` 隐藏旧版 `rejected` 记录，前端只展示待审/已接受状态；文件同步保留已删除后的候选清单。
- [styles.module.css](../../app/src/Pages/review/ReviewPage/styles.module.css)：统一使用桌面审核布局，无移动端或窄屏宽度断点；全局选择器用于保持已有 DOM 样式契约，局部 `.page` 不生成布局盒。主页样式位于 DatasetManager 同目录的 CSS Module，保留桌面窗口高度调整及减少动态效果的可访问性设置。
- [app/src/theme.css](../../app/src/theme.css)：黑白灰语义色板与共享间距；页头、主页及普通工具页使用 `--review-page-gutter`，裁切和标签主体不增加外层留白，其数据集栏沿用 `--review-editor-gutter`。
- 裁切和标签 tab 隐藏左侧身份选择及顶部“切换数据集”入口，切换使用主页；目录、全部图片处理范围、超分及主体识别按钮合为一行，说明由各按钮旁的问号提供悬停与键盘聚焦提示。两个 tab 使用相同的精简显示，处理范围和后端调用不变。
- [app/src/api/client.ts](../../app/src/api/client.ts)：同源请求与会话 token；请求 URL、操作载荷沿用 Python 协议。
- [core/dataset_pipeline/review.py](../../core/dataset_pipeline/review.py)：API、图片、编辑/后台任务、会话，以及可选的 `app/dist` 静态资源。
- [core/dataset_pipeline/datasets.py](../../core/dataset_pipeline/datasets.py)：发现运行、验证目录并生成独立路径；`import_config` 使用请求的 `cropMode=prepared/manual`，未传或为 `auto` 的旧请求仍按 TXT 存在与否判断；`import_sources` 只复制原始图片和按模式接入同名标签，保留未变化的审核记录；`upscale_source` 只更新工作图并映射已有裁框，`detect_source` 在当前工作图生成候选并保留已审核/编辑的裁框。
- `datasets.replace_source_image` 负责 `crop_subject` / `restore_original`：新底图保存于工作目录，首轮主体裁切保存可恢复的 `original_backup`；每次替换重置倍率、全部裁框、检测结果和活动标签，完整图重新登记为已接受。输入目录不被覆盖，多次主体裁切仍可恢复首轮裁切前原图。`manual_processing` 阻止同步重新导入旧 TXT，并允许成品数据集中重置后的单图重新识别和超分；源文件内容变化后同步会丢弃旧底图替换状态。
- [core/dataset_pipeline/core.py](../../core/dataset_pipeline/core.py)：保留原来的运行记录、预处理、标签与导出组织；其相邻模块的相对导入不变。
- `atomic_json` 先写入并刷盘临时文件，再原子替换记录；Windows 访问/共享冲突（5/32/33）最多重试两秒，兼容页面轮询短暂读取 manifest。不会先删除旧记录；持续占用、权限不足及其他写入错误仍报告失败。
- [core/dataset_pipeline/geometry.py](../../core/dataset_pipeline/geometry.py)：`default_scale` 决定按尺寸超分倍率；总像素小于 `1024² × 80%` 时为 1.5 倍，其余为 1 倍。网页 `start_upscale` 只处理需要提高倍率的图片；历史自动流程的内部 `Run.prepare_source` 保留运行记录兼容能力，手动或保存的 `scale_override` 优先。

普通审核启动进入 `home`，首次只读取状态和已有运行列表，不加载目录；空白会话返回 `datasetLoaded=false`，裁切/标签 tab 在加载数据集前禁用。独立分析及 `?analysis` 入口仍进入分析页。显式导入、打开已有数据集或顶部刷新通过带会话 token 的 `sync_sources` 调用 `import_sources`，不执行图片处理；切换重置筛选和选择。完整打标数据集在没有待审裁框时进入标签页，待处理数据集进入裁切页；返回主页保留当前工作，继续按钮恢复本次会话的审核阶段。主页不会被后台打标完成自动跳转。

2026-10-29：裁切后新增独立[打标 tab](tagging.md)，同样要求已导入数据集；页头打标按钮已移入此页。支持 WD / PixAI 单模型与混合打标，完成后停留打标页查看合并分组、标签增减与置信度过滤，热力图默认折叠作为额外参考；标签编辑页保持原有职责。完整数据集重新导入源 TXT 的恢复行为见该专题。

主页“管理数据集”显示逐项删除操作，确认框列出工作目录和导出目录。`/api/datasets/delete` 校验会话 token、任务互斥和运行锁，通过 `datasets.delete_dataset` 清理项目 `runs/<名称>` 与同名 `dataset-ready/<名称>`，保留输入素材及共享模型；项目外、非独立目录、链接或与其他运行/输入目录重叠的目标拒绝删除。清理成功后刷新首页列表；删除当前运行时清空后端会话及前端审核选择，停留首页。删除过程中出错会报告错误，不承诺已删除文件可回滚。

`start_upscale`、`start_detect`、`start_tag` 与导出共用任务互斥。顶部超分/主体识别不发送 `group`，作用于全部活跃图片；超分仅执行尺寸判定后需要放大的项。单图识别发送 `start_detect` 与 `source`，后端验证图片存在且活跃，只处理指定图片并保留已有审核和手动裁框。API 的超分/识别仍兼容 `group` 角色范围，单图 `source` 优先。完整打标模式禁止自动超分/识别，缺少对应 TXT 的图片以空标签导入并提示；待处理模式不导入源 TXT 标签。已有标签编辑优先，同一目录和角色以不同模式导入使用独立运行。导入成品保留原格式与尺寸，导出沿用实际图片扩展名，避免 JPEG 字节被错误命名为 PNG。

文件名称由 `import_sources` 记录：`preserve_filename` 标记导入素材，原图片存入版本父目录并保留 `relative` 的原名、扩展名大小写与层级；`caption_name` 与标签的 `caption` 路径保留原 TXT 名称。旧记录同步时更新完整图及标签存储路径，保留当前编辑。`Run.tag_file` 统一读写已登记的标签路径；`_materialize` 对导入完整图返回原文件。`Run.export` 按原相对路径导出完整图和标签，图片直接复制源字节；标签先按角色清理再写入原路径，冲突在写入输出目录前报错。新裁片仍使用生成名称和 PNG，其他几何处理不受此命名规则影响。

主体裁切后的 `original` 指向新底图，`original_size` 与倍率选项同步更新；完整图打标和导出改为读取该底图，保留原相对文件名与扩展名，恢复后重新使用原始输入。`tag_key` 与超分缓存键包含主体底图身份，避免复用未裁切时的结果。刷新/重新打开保留未变化图片的主体底图及备份，历史标签不会自动回填为当前结果。

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

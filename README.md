# LoRA 数据工作台

用于 Stable Diffusion LoRA 训练素材的本地 WebUI。数据集导入、图片处理、裁切审核、标签编辑、分析和导出统一在网页中完成。

## 功能

- **数据集管理**：显式选择任意本地目录或子目录，导入完整打标素材或待处理素材，打开已有工作记录。
- **裁切与打标**：通过 Forge 超分、WD / PixAI 单模型或混合打标；独立打标页提供合并分组、标签增减预览、置信度过滤和折叠式参考热力图。本地人物/头部/姿势检测，手动裁切、主体替换和恢复原图。
- **标签编辑与导出**：筛选、单图和批量编辑、修改预览，导出训练图片及同名 TXT；原始素材保留。
- **标签检查**：一次打标后，通过本地视觉模型检查人数、构图范围，并检查数据集明确禁用的标签。图片与异常建议并列，支持应用、保留原标签和批次撤销；运行检查不修改 TXT。
- **数据集处理工具**：扫描和勾选处理范围，预览短边缩放、水平镜像或去重结果，再另存到新目录。
- **图像降噪**：独立单图页，通过 BOX 预缩放、现有 Forge 超分与可选 L0 梯度平滑削弱二次元鱼鳞噪点，保留原尺寸和透明度，支持分割对比与 PNG 下载。无需导入数据集；输入最多 20 MiB、400 万像素。
- **数据集分析**：统计亮度、色彩、尺寸、重复候选、标签分布和可选人物姿势，下载 JSON / CSV 报告，无需先导入审核数据集或启动 Forge。
- **LoRA 文件工具**：预览并执行 safetensors 重命名，生成和复制对比提示词。

## 环境准备

需要 uv、Node.js 22.12+ 和 npm。Python 3.10 由 uv 自动下载管理，项目依赖安装到独立的 `.venv-preprocess`，无需另装系统 Python 3.10，可与其他项目的 Python 3.13 共存。不要将本项目依赖装进 Forge 环境。

首次使用，双击根目录 [install-deps.bat](install-deps.bat)，或执行：

```powershell
.\install-deps.bat
```

脚本检查 uv、Node.js 22.12+ 和 npm；缺失时提示安装。缺少 uv 时可在 PowerShell 执行 `winget install --id=astral-sh.uv -e`，安装后重新打开终端或安装脚本；其他安装方式见 [uv 官方说明](https://docs.astral.sh/uv/getting-started/installation/)。

随后通过 `uv venv --python 3.10 --managed-python` 创建或复用 `.venv-preprocess`，用 `uv pip install` 从清华 PyPI 镜像按 [Python 依赖清单](requirements-preprocess.txt) 安装依赖，并通过 `npm ci` 按前端锁文件安装依赖。安装需要联网，不需要 Git；任何步骤失败都会停止，可修复后重跑。已有虚拟环境无法运行或版本不符时，提示先重命名旧环境再重试，不自动删除。uv 管理的 Python 使用其常规安装目录，不要将解释器安装到可能被清理的临时目录；日常仍通过 `start-webui.bat` 启动。

脚本不安装 Forge Neo、插件或模型权重。首次人物检测还需要对应的本地模型缓存或下载条件；离线姿势分析要求预先缓存模型。详细要求见 [处理与审核说明](PREPROCESS.md) 和 [数据集分析说明](ANALYSIS.md)。

## 启动和配置

双击根目录 `start-webui.bat`，或从仓库根目录执行：

```powershell
.\start-webui.bat
```

首次在网页“设置”中填写已配置好的 SD WebUI Forge Neo 根目录。使用 [1lch2 WD14 Tagger](https://github.com/1lch2/stable-diffusion-webui-wd14-tagger)，打标页可选择 EVA02-Large v3、PixAI v1.0 或两者混合；标签整理词表已内置于 `data/tags/`，不读取插件缓存中的 CSV。当前插件来源校验要求 Git 可用且插件 origin 指向该仓库。

设置由网页保存到 `.local/webui.json`。顶部“设置”可修改 Forge API 地址、放大模型、混合比例、裁框参数及标签清理默认值；打标模型与置信度范围在打标页调整。无需根目录配置 JSON，也不支持旧配置导入参数。

默认页面为 `http://127.0.0.1:5173`，API 端口为 8765。启动仅打开空白主页，不自动选择数据集，也不启动模型。需要时可调整启动选项：

```powershell
.\start-webui.bat --port 8870 --frontend-port 5178 --no-browser
```

## 使用流程

1. 在主页导入素材，填写实际目录和可选角色名称；或打开已有工作记录。**没有固定输入目录要求，不依赖 `dataset-raw`。** 原来放在该目录中的素材可作为普通目录手动导入。
2. 完整打标素材保留原始尺寸并读取同名 TXT；待处理素材按需执行超分、识别与裁切审核。
3. 在裁切后的“打标”页运行单模型或混合打标，按共同支持、WD 补充、PixAI 补充与已过滤查看结果，调整下限并预览标签增减；热力图在“额外参考”中展开。在“标签”页继续编辑与导出。已有工作标签会在确认后替换，完整数据集可重新导入源 TXT 恢复。Forge 在需要超分或打标时才启动或复用。
4. 缩放、镜像、去重在“数据集处理工具”页选择范围并预览后另存；统计分析在“数据集分析”页运行。

导入会生成独立的 `runs/<数据集标识>/` 工作记录和 `dataset-ready/<数据集标识>/` 导出目录。重启后从主页选择数据集，原始素材不会因删除旧入口而改变。

导入时可勾选“递归遍历子目录”，包含所有子目录中的图片；关闭时仅导入所选目录直接包含的图片。完整打标数据集默认开启，待处理数据集默认关闭，打开和刷新工作记录时沿用已保存的范围。

旧命令行预处理、打标、导出、批量分析，以及独立缩放、翻转、去重、加标签脚本已移除。用户处理入口统一为 WebUI；Python 启动器和分析工作进程是网页运行所需的内部实现。

## 项目结构

```text
install-deps.bat            项目 Python 与前端依赖安装入口
requirements-preprocess.txt Python 运行依赖清单
start-webui.bat             WebUI 启动入口
core/dataset_pipeline/     数据集导入、处理、裁切、打标与导出
webui/                     Python 启动器、HTTP 服务、设置与 Vite 管理
tools/analysis/            独立数据集统计、报告与离线分析工作进程
tools/lora/                LoRA 文件重命名与对比提示词
tools/dataset.py           独立批量图片处理
tools/denoise.py           独立单图降噪
app/src/                   React + TypeScript 前端
data/tags/                 固定版本标签词表及来源说明
.local/webui.json          网页生成的本机设置，不提交 Git
runs/                      数据集工作记录与共享模型缓存
dataset-ready/             导出结果
tests/                     现有 Python 测试
```

前端使用 React、Vite、TanStack Query、Tailwind CSS 与 CSS Modules，仅面向桌面。

Python 从仓库根目录以包方式加载，`start-webui.bat` 使用项目虚拟环境执行 `python -m webui`。WebUI 组合流水线与独立工具，流水线不依赖 WebUI；各模块的资源和工作记录仍位于原数据目录。

## 开发与验证

```powershell
npm run build --prefix app
.\.venv-preprocess\Scripts\python.exe -m unittest discover -s tests
```

单独运行 `npm run dev --prefix app` 时，需先启动 Python API；Vite 默认代理 `127.0.0.1:8765`，可通过 `REVIEW_API_URL` 修改。构建产物位于 `app/dist/`。

构建、合成数据测试与真实模型推理分别验证；现有测试通过不代表真实模型运行通过。实现导航见 [功能索引](docs/feature-map.yaml)。

测试聚焦导入与同步、裁切与打标、标签编辑与导出、分析报告及独立降噪的核心结果，同时保留原文件、人工编辑和任务互斥的关键保护。不单独验证固定参数、内部调用顺序、提示文案和重复的兼容细节。

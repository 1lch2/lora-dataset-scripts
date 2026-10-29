# LoRA 数据工作台

用于 Stable Diffusion LoRA 训练素材的本地 WebUI。数据集导入、图片处理、裁切审核、标签编辑、分析和导出统一在网页中完成。

## 功能

- **数据集管理**：显式选择任意本地目录或子目录，导入完整打标素材或待处理素材，打开已有工作记录。
- **裁切与打标**：通过 Forge 超分、WD / PixAI 单模型或混合打标；独立打标页提供合并分组、标签增减预览、置信度过滤和折叠式参考热力图。本地人物/头部/姿势检测，手动裁切、主体替换和恢复原图。
- **标签编辑与导出**：筛选、单图和批量编辑、修改预览，导出训练图片及同名 TXT；原始素材保留。
- **数据集处理工具**：扫描和勾选处理范围，预览短边缩放、水平镜像或去重结果，再另存到新目录。
- **数据集分析**：统计亮度、色彩、尺寸、重复候选、标签分布和可选人物姿势，下载 JSON / CSV 报告，无需先导入审核数据集或启动 Forge。
- **LoRA 文件工具**：预览并执行 safetensors 重命名，生成和复制对比提示词。

## 环境准备

需要 Python 3.10、Node.js 22.12+、npm，以及本项目独立的 `.venv-preprocess` Python 环境。不要将本项目依赖装进 Forge 环境。

**目前全新安装仍有已知阻塞：** `requirements-preprocess.in` 和 `requirements-preprocess.lock` 尚未包含在仓库中，不能直接按锁文件重建完整环境。已有配置完成的 `.venv-preprocess` 可以继续使用；补齐依赖文件后才能执行以下安装步骤：

```powershell
uv venv --python 3.10 .venv-preprocess
uv pip sync requirements-preprocess.lock --python .venv-preprocess/Scripts/python.exe
npm install --prefix app
```

首次人物检测还需要对应的本地模型缓存或下载条件；离线姿势分析要求预先缓存模型。详细要求见 [处理与审核说明](PREPROCESS.md) 和 [数据集分析说明](ANALYSIS.md)。

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

旧命令行预处理、打标、导出、批量分析，以及独立缩放、翻转、去重、加标签脚本已移除。用户处理入口统一为 WebUI；Python 启动器和分析工作进程是网页运行所需的内部实现。

## 项目结构

```text
start-webui.bat             WebUI 启动入口
core/launch_webui.py        启动 API、Vite，按需协调 Forge
core/dataset_pipeline/     后端处理、审核、设置及分析工作进程
app/src/                   React + TypeScript 前端
data/tags/                 固定版本标签词表及来源说明
.local/webui.json          网页生成的本机设置，不提交 Git
runs/                      数据集工作记录与共享模型缓存
dataset-ready/             导出结果
tests/                     现有 Python 测试
```

前端使用 React、Vite、TanStack Query、Tailwind CSS 与 CSS Modules，仅面向桌面。

## 开发与验证

```powershell
npm run build --prefix app
$env:PYTHONPATH = (Join-Path (Get-Location) 'core')
.\.venv-preprocess\Scripts\python.exe -m unittest discover -s tests
```

单独运行 `npm run dev --prefix app` 时，需先启动 Python API；Vite 默认代理 `127.0.0.1:8765`，可通过 `REVIEW_API_URL` 修改。构建产物位于 `app/dist/`。

构建、合成数据测试与真实模型推理分别验证；现有测试通过不代表真实模型运行通过。实现导航见 [功能索引](docs/feature-map.yaml)。

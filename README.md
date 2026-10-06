# lora-dataset-utils

用于 Stable Diffusion LoRA 训练素材的本地处理工具，包含自动化预处理与人工审核 WebUI，以及独立的图片、标签和 LoRA 文件脚本。

## 主要功能

- **预处理与裁切审核**：生成工作图和候选裁框，人工调整、接受或拒绝裁片，通过 Forge 放大与 WD14 打标，再导出训练图片及同名 TXT 标签。
- **标签编辑**：标签筛选、图片过滤、单图编辑与批量修改，支持 AND / OR 条件、匹配替换、重排和修改预览。
- **数据集分析**：本地统计亮度、色彩、尺寸、重复候选、可选人物姿势与标签分布，导出 JSON / CSV 报告；可独立启动，无需 Forge 或预处理记录。
- **LoRA 文件工具**：在 WebUI 中预览并执行 `.safetensors` 文件重命名，生成 XYZ 对比提示词。
- **独立脚本**：图片缩放、水平翻转、角色标签前缀处理、LoRA 重命名与提示词生成。

前端使用 React + TypeScript + Vite，服务端数据由 TanStack Query 管理，样式使用 Tailwind CSS 与 CSS Modules；Python API 和处理逻辑位于 `core/`。

## 环境准备

以下命令均从仓库根目录执行。

### 审核 WebUI 与预处理

需要 Python 3.10、Node.js 22.12.0+、npm、uv，以及独立的 `.venv-preprocess` 环境。使用预处理与打标时，还需配置 Forge API 和所需模型；具体要求见 [PREPROCESS.md](PREPROCESS.md)。

预处理文档引用的 `requirements-preprocess.in` 和 `requirements-preprocess.lock` 当前未包含在仓库中；首次安装前需先取得依赖文件。已有配置完成的 `.venv-preprocess` 环境可继续使用。取得锁文件后执行：

```powershell
uv venv --python 3.10 .venv-preprocess
uv pip sync requirements-preprocess.lock --python .venv-preprocess/Scripts/python.exe
npm install --prefix app
```

预处理依赖使用独立环境，不与 Forge 环境或下面的基础脚本依赖混装。

### 基础脚本

仅使用独立脚本时，安装 Python 3.10 与基础依赖：

```powershell
python -m pip install -r requirements.txt
```

`requirements.txt` 包含 Pillow、pyperclip 和 OpenCV，不包含完整预处理或分析依赖。

## 启动审核 WebUI

首次配置时，将 [preprocess.example.json](preprocess.example.json) 复制为 `preprocess.local.json`，修改输入目录、运行目录、训练输出目录、Forge 地址与 `tags_csv`。相对路径以配置文件所在目录为基准，输入、工作和输出目录必须互不包含。

配置完成后，双击根目录 `start-webui.bat`，或执行：

```powershell
.\start-webui.bat --config preprocess.local.json --forge-dir 'E:\stable-diffusion-webui-forge-classic'
```

启动器先启动或复用 Forge API，再为新运行准备素材，随后启动 Python API 与 Vite 并打开浏览器。默认 API 端口为 8765，页面地址为 `http://127.0.0.1:5173`；可通过 `--port` 和 `--frontend-port` 修改端口。

处理流程为：**准备素材 → 裁切审核 → 打标 → 标签编辑 → 导出**。启动入口不会自动接受裁框或自动打标。关闭审核入口会停止本次创建的前端与 API，独立 Forge 进程继续运行。

也可手动准备素材并打开已有运行：

```powershell
.\.venv-preprocess\Scripts\python.exe core/preprocess.py prepare --config preprocess.local.json
.\.venv-preprocess\Scripts\python.exe core/preprocess.py review --run runs/default
```

配置、模型、审核交互和导出规则详见 [预处理使用说明](PREPROCESS.md)。

## 独立数据集分析

在已准备好 Python 环境和前端依赖后执行：

```powershell
.\.venv-preprocess\Scripts\python.exe core/preprocess.py analyze
```

默认打开 `http://127.0.0.1:5174`，API 端口为 8766。输入待分析的本地目录后，点击「开始分析」运行统计；无需启动 Forge。

基础分析使用 Pillow 与 NumPy，可选人物/姿势统计需要额外依赖和已有模型缓存。分析不修改源图片与标签，报告不包含图片；完整指标、离线要求和命令行报告导出见 [ANALYSIS.md](ANALYSIS.md)。

## 独立脚本

脚本位于 `core/`，从仓库根目录执行。图片工具默认使用一级角色目录：

```text
dataset-raw/
  character_name/
    image.png
    image.txt
output/
  myLora-0.safetensors
```

按所用脚本创建所需目录，不需要为所有工具预先创建全部目录。

| 命令                               | 当前行为                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `python core/edit_caption.py`      | 递归处理 `dataset-raw/<角色>/` 下的 TXT，将 `<角色> (arknights)` 放到标签开头；作品名通过脚本中的 `COPYRIGHT` 调整 |
| `python core/resize.py`            | 处理各角色目录顶层的图片，将短边大于等于 1280 的图片缩至 1280，保持比例并写回原文件；较小图片尺寸不变              |
| `python core/reverse.py`           | 将各角色目录顶层的图片水平翻转，保存到 `reverse/<角色>/`                                                           |
| `python core/rename.py`            | 按前缀分组，将 `output/` 顶层 `.safetensors` 的数字序号整理为从 0 开始的连续编号，直接执行重命名                   |
| `python core/generate_lora_tag.py` | 为 `output/` 中以数字序号结尾的 LoRA 文件生成权重为 1 的提示词，打印并复制到剪贴板                                 |

`edit_caption.py` 不自动补充 `1girl` 或独立的作品标签。`resize.py` 当前命令入口覆盖源文件，其 `rename` 参数尚不能可靠地另存副本。LoRA 重命名如需先查看方案，使用 WebUI 的「LoRA 文件工具」页。

生成的提示词示例：

```text
<lora:myLora-0:1>
<lora:myLora-1:1>
<lora:myLora-2:1>
```

可用于 Stable Diffusion WebUI 的 XYZ 脚本，比较不同 LoRA 检查点。

## 项目结构

```text
app/
  src/                   React 页面、组件、请求与主题
  package.json           前端依赖与开发命令
core/
  dataset_pipeline/      预处理、审核 API、模型调用与分析
  preprocess.py          预处理与独立分析 CLI
  launch_webui.py         Forge 与前后端启动协调
  *.py                   独立工具脚本
docs/
  feature-map.yaml       功能总索引
  features/              功能实现导航
  frontend-code-standards.md  React + TypeScript 代码规范
tests/                   现有 Python 测试
AGENTS.md                项目基本信息与协作入口
preprocess.example.json  配置示例
start-webui.bat          Windows WebUI 启动入口
```

本机配置、虚拟环境、运行记录和数据目录不提交到仓库。

## 开发与文档

前端常用命令：

```powershell
npm run dev --prefix app
npm run build --prefix app
npm run format --prefix app
```

单独运行 Vite 时需先启动 Python API。Vite 默认将 `/api` 与 `/image` 代理到 `http://127.0.0.1:8765`；使用其他 API 端口时设置 `REVIEW_API_URL`，启动器会自动传入该地址。构建产物输出到 `app/dist/`。

需要运行现有 Python 测试时：

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'core')
.\.venv-preprocess\Scripts\python.exe -m unittest discover -s tests
```

- [项目协作说明](AGENTS.md)：项目入口、功能定位与验证方式。
- [React + TypeScript 代码规范](docs/frontend-code-standards.md)：前端开发约束。
- [功能导航](docs/feature-map.yaml)：从功能查找当前实现。
- [预处理使用说明](PREPROCESS.md)：环境、配置、裁切审核、打标与导出。
- [数据集分析说明](ANALYSIS.md)：统计指标、报告与离线要求。

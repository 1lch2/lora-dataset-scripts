# 项目协作说明

## 项目基本信息

本项目是用于 Stable Diffusion LoRA 训练素材的本地处理工具，包含自动化预处理、人工裁切审核、标签编辑与导出、数据集分析，以及独立图片和 LoRA 文件脚本。

- 前端：React 19、TypeScript、Vite 7、TanStack Query、Tailwind CSS 4 与 CSS Modules，源码位于 `app/src/`。
- 后端：Python 3.10，业务模块位于 `core/dataset_pipeline/`，命令行脚本位于 `core/`。
- 模型调用：人物/头部检测与姿势估计由本地模型完成，放大和 WD14 打标通过 Forge API 完成；独立数据集分析无需 Forge。
- 运行方式：Windows 下使用 `start-webui.bat` 协调 Forge、Python API 与 Vite；脚本和开发命令从仓库根目录执行。

## 目录与入口

| 路径                                      | 用途                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| `app/src/Pages/`                          | 审核、数据集分析与 LoRA 文件工具页面                     |
| `app/src/api/`                            | 前端请求与接口类型                                       |
| `app/src/theme.css`                       | 前端主题 token 与全局样式                                |
| `core/preprocess.py`                      | `prepare`、`review`、`tag`、`export`、`analyze` 命令入口 |
| `core/launch_webui.py`                    | Forge 与前后端启动协调                                   |
| `core/dataset_pipeline/`                  | 预处理、审核 API、模型客户端与分析模块                   |
| `tests/`                                  | 现有 Python unittest 测试                                |
| `preprocess.example.json`                 | 可提交的配置示例                                         |
| `preprocess.local.json`                   | 本机配置，不提交                                         |
| `dataset-raw/`、`runs/`、`dataset-ready/` | 原始素材、运行记录与训练输出                             |
| `output/`                                 | LoRA 文件工具的默认目录                                  |
| `docs/feature-map.yaml`、`docs/features/` | 功能索引与实现导航                                       |

## 功能导航

- 查找、解释或修改项目功能实现前，使用项目级 [feature-map skill](.agents/skills/feature-map/SKILL.md)，先从 [docs/feature-map.yaml](docs/feature-map.yaml) 匹配功能，按需阅读其指向的 `docs/features/` 专题文档，再核对当前源码。
- 新增、变更、删除功能或重构影响导航映射时，在同一次任务中按该 skill 更新受影响条目；纯只读分析不修改文件。导航尚未完整收录，不为补齐导航扩大当前任务范围。

## 代码规范

修改前端代码前，必须读取并遵守 [React + TypeScript 代码规范](docs/frontend-code-standards.md)。该文档保留组件、类型、样式、命名、注释、状态管理与单元测试约束；Python 部分不适用此前端规范。

## 开发与验证

前端依赖与常用命令：

```powershell
npm install --prefix app
npm run dev --prefix app
npm run build --prefix app
npm run format --prefix app
```

Node.js 要求 22.12.0 或更新版本。单独运行 Vite 时，需要已启动 Python API；默认代理 `http://127.0.0.1:8765`，可通过 `REVIEW_API_URL` 调整。构建产物位于 `app/dist/`。

普通审核默认使用 API 8765 / Vite 5173；独立分析默认使用 API 8766 / Vite 5174。启动入口接受 `--port` 与 `--frontend-port`。

Python 预处理使用独立的 `.venv-preprocess` 环境，不与 Forge 环境或基础脚本依赖混装。环境准备详见 [PREPROCESS.md](PREPROCESS.md)；其中引用的 `requirements-preprocess.in` / `requirements-preprocess.lock` 当前未包含在仓库中，首次安装需先取得这些依赖文件。

需要运行现有 Python 测试时，从仓库根目录执行：

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'core')
.\.venv-preprocess\Scripts\python.exe -m unittest discover -s tests
```

纯文档修改检查相对链接与 `git diff --check` 即可。验证结论应区分文档检查、构建、现有测试和真实模型运行。

## 使用文档

- [README.md](README.md)：项目概览、启动与独立脚本。
- [PREPROCESS.md](PREPROCESS.md)：预处理环境、配置、裁切审核、打标与导出。
- [ANALYSIS.md](ANALYSIS.md)：本地数据集分析、报告与离线模型要求。

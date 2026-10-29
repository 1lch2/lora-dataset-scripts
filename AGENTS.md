# 项目协作说明

## 项目基本信息

本项目是用于 Stable Diffusion LoRA 训练素材的本地 WebUI，包含图片处理、人工裁切审核、标签编辑与导出、数据集分析，以及 LoRA 文件工具；不提供旧版数据集处理 CLI。

- 前端：React 19、TypeScript、Vite 7、TanStack Query、Tailwind CSS 4 与 CSS Modules，源码位于 `app/src/`。
- 后端：Python 3.10，业务模块和内部分析工作进程位于 `core/dataset_pipeline/`，WebUI 启动器位于 `core/`。
- 模型调用：人物/头部检测与姿势估计由本地模型完成，放大和 WD14 打标通过 Forge API 完成；独立数据集分析无需 Forge。
- 运行方式：Windows 下使用 `start-webui.bat` 协调 Forge、Python API 与 Vite；脚本和开发命令从仓库根目录执行。

## 功能导航

- 查找、解释或修改项目功能实现前，使用项目级 [feature-map skill](.agents/skills/feature-map/SKILL.md)，先从 [docs/feature-map.yaml](docs/feature-map.yaml) 匹配功能，按需阅读其指向的 `docs/features/` 专题文档，再核对当前源码。
- 新增、变更、删除功能或重构影响导航映射时，在同一次任务中按该 skill 更新受影响条目；纯只读分析不修改文件。导航尚未完整收录，不为补齐导航扩大当前任务范围。

## 代码规范

修改前端代码前，必须读取并遵守 [React + TypeScript 代码规范](docs/frontend-code-standards.md)。该文档保留组件、类型、样式、命名、注释、状态管理与单元测试约束；Python 部分不适用此前端规范。

## 前端设计

- WebUI 仅面向桌面端，统一使用桌面布局，不设计、实现或验证移动端、平板端适配；不新增按窄屏宽度、触控设备或移动端 UA 切换布局或交互的样式与逻辑。桌面窗口尺寸变化通过弹性布局和容器内滚动处理，保留通用可访问性支持。本规定优先于设计 skill 中的移动端适配建议。
- 新建页面、优化视觉或评审界面设计时，按适用条件使用项目级 [frontend-design skill](.agents/skills/frontend-design/SKILL.md)。来源：[1lch2/personal-productivity-skills](https://github.com/1lch2/personal-productivity-skills/tree/master/frontend-design)。
- 设计建议须遵守本项目的 React + TypeScript 代码规范，沿用现有组件结构、CSS Modules 与主题 token；skill 中的单文件 HTML、内联样式和原生事件委托建议不替代现有 React 实现方式。局部调整保持任务范围，严格遵守既有设计系统的任务按该 skill 的不适用条件处理。

## 开发与验证

前端依赖与常用命令：

```powershell
npm install --prefix app
npm run dev --prefix app
npm run build --prefix app
npm run format --prefix app
```

Node.js 要求 22.12.0 或更新版本。单独运行 Vite 时，需要已启动 Python API；默认代理 `http://127.0.0.1:8765`，可通过 `REVIEW_API_URL` 调整。构建产物位于 `app/dist/`。

WebUI 默认使用 API 8765 / Vite 5173，分析从同一页面的 tab 进入。启动入口接受 `--port` 与 `--frontend-port`。

Python 预处理使用独立的 `.venv-preprocess` 环境，不与 Forge 环境或基础脚本依赖混装。环境准备详见 [PREPROCESS.md](PREPROCESS.md)；其中引用的 `requirements-preprocess.in` / `requirements-preprocess.lock` 当前未包含在仓库中，首次安装需先取得这些依赖文件。

需要运行现有 Python 测试时，从仓库根目录执行：

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'core')
.\.venv-preprocess\Scripts\python.exe -m unittest discover -s tests
```

纯文档修改检查相对链接与 `git diff --check` 即可。验证结论应区分文档检查、构建、现有测试和真实模型运行。

## 使用文档

- [README.md](README.md)：项目概览、启动与 WebUI 使用流程。
- [PREPROCESS.md](PREPROCESS.md)：预处理环境、配置、裁切审核、打标与导出。
- [ANALYSIS.md](ANALYSIS.md)：本地数据集分析、报告与离线模型要求。

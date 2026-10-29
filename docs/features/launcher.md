# BAT 与 Forge 启动链

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-29。已核对空白 UI 启动、网页设置、端口复用、按需 Forge 启动及前端进程管理主链路。

1. [start-webui.bat](../../start-webui.bat) 切换到仓库根目录，以原 `.venv-preprocess` 调用 `core/launch_webui.py` 并透传参数。
2. [launch_webui.py](../../core/launch_webui.py) 从内置默认值与 `.local/webui.json` 加载设置，不再要求根目录 JSON 或硬编码 Forge 目录。以 `serve(None, config=...)` 启动空白审核会话，不扫描默认目录或加载默认 manifest；通过 `/api/session` 的 `manualWorkflow`、`settingsEnabled` 与本项目 `settingsPath` 核对服务复用。Forge API 复用、占用端口等待、独立终端与原参数读取保留，但延迟到模型操作需要时执行。
3. [review.py](../../core/dataset_pipeline/review.py) 启动 Python API 线程；`make_server` 以 `config` 区分空白审核与独立分析。`model_setup` 由后台超分/打标任务按需调用，导入与识别不启动 Forge。
4. [frontend.py](../../core/dataset_pipeline/frontend.py) 在 `app/` 执行 `npm run dev`，通过 `REVIEW_API_URL` 配置代理，等待会话匹配后打开浏览器。
5. 退出审核入口时停止本次创建的 Vite 进程树并关闭 API；独立 Forge 和复用的服务不被清理。

审核默认 API 8765 / Vite 5173；使用 `--port` 与 `--frontend-port` 修改。启动配置只包含处理参数，不预设输入、运行或输出目录；端口上已有 Vite 时校验代理会话匹配。升级前不支持 `manualWorkflow` 的审核进程需关闭或使用新端口。浏览器的普通审核入口默认显示主页，再选择已有数据集或导入完整打标/待处理素材；页面选择与后台同步见[审核专题](review-app.md)。

已有验证：[test_launcher.py](../../tests/test_launcher.py)。安装及命令说明：[PREPROCESS.md](../../PREPROCESS.md)。

## 网页配置

- [settings.py](../../core/dataset_pipeline/settings.py)：设置白名单、类型和数值验证、原子保存；检查 Forge 根目录与已启用的 `1lch2/stable-diffusion-webui-wd14-tagger` Git origin，固定 EVA02-Large v3 模型和项目内置 CSV。不会安装插件或移动模型。
- [Settings](../../app/src/Pages/review/ReviewPage/__internal__/Settings/Settings.tsx)：顶部设置弹窗，首次未配置时自动显示；默认只需 Forge 目录，处理参数放在折叠区。使用 TanStack Query 获取和保存设置。
- [review.py](../../core/dataset_pipeline/review.py)：`GET/POST /api/settings`，写入受本地 Host、会话 token 与任务互斥保护；读取运行时覆盖处理参数，保留数据集路径与身份。独立分析和未启用设置的入口不显示设置控件。
- [core.py](../../core/dataset_pipeline/core.py)：`Run.load(config_overrides=...)` 在创建模型客户端前应用当前配置；词表使用内置资源。
- [词表来源](../../data/tags/README.md)：固定 revision、文件用途与 SHA-256。

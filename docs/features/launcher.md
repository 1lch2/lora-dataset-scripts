# BAT 与 Forge 启动链

[返回功能导航](../feature-map.yaml)

核对日期：2026-10-07。已核对空白 UI 启动、端口复用、按需 Forge 启动及前端进程管理主链路。

1. [start-webui.bat](../../start-webui.bat) 切换到仓库根目录，以原 `.venv-preprocess` 调用 `core/launch_webui.py` 并透传参数。
2. [launch_webui.py](../../core/launch_webui.py) 检查配置和审核端口，以 `serve(None, config=...)` 启动空白审核会话，不扫描默认目录或加载默认 manifest；通过 `/api/session` 的 `manualWorkflow` 与 `startupConfig` 核对服务复用。Forge API 复用、占用端口等待、独立可见终端与原参数读取保留，但延迟到模型操作需要时执行。
3. [review.py](../../core/dataset_pipeline/review.py) 启动 Python API 线程；`make_server` 以 `config` 区分空白审核与独立分析。`model_setup` 由后台超分/打标任务按需调用，导入与识别不启动 Forge。
4. [frontend.py](../../core/dataset_pipeline/frontend.py) 在 `app/` 执行 `npm run dev`，通过 `REVIEW_API_URL` 配置代理，等待会话匹配后打开浏览器。
5. 退出审核入口时停止本次创建的 Vite 进程树并关闭 API；独立 Forge 和复用的服务不被清理。

审核默认 API 8765 / Vite 5173；使用 `--port` 与 `--frontend-port` 修改。审核服务复用要求启动配置的运行、输入、输出目录及身份一致，与网页当前加载的目录无关；端口上已有 Vite 时校验代理会话匹配。升级前不支持 `manualWorkflow` 的审核进程需关闭或使用新端口。网页目录接入与后台同步见[审核专题](review-app.md)。

已有验证：[test_launcher.py](../../tests/test_launcher.py)。安装及命令说明：[PREPROCESS.md](../../PREPROCESS.md)。

# BAT 与 Forge 启动链

[返回功能导航](../feature-map.yaml)

核对日期：2026-09-27。已核对启动、端口复用、API 等待及前端进程管理主链路。

1. [start-webui.bat](../../start-webui.bat) 切换到仓库根目录，以原 `.venv-preprocess` 调用 `core/launch_webui.py` 并透传参数。
2. [launch_webui.py](../../core/launch_webui.py) 检查配置和审核端口，保留 Forge API 复用、占用端口等待、独立可见终端启动与原参数读取逻辑。
3. [review.py](../../core/dataset_pipeline/review.py) 启动 Python API 线程。
4. [frontend.py](../../core/dataset_pipeline/frontend.py) 在 `app/` 执行 `npm run dev`，通过 `REVIEW_API_URL` 配置代理，等待会话匹配后打开浏览器。
5. 退出审核入口时停止本次创建的 Vite 进程树并关闭 API；独立 Forge 和复用的服务不被清理。

审核默认 API 8765 / Vite 5173；使用 `--port` 与 `--frontend-port` 修改。端口上已有 Vite 时校验代理会话匹配，错误服务不被当作可复用页面。升级前的旧版审核进程无 `/api/session`，需关闭旧审核入口或使用新端口。

已有验证：[test_launcher.py](../../tests/test_launcher.py)。安装及命令说明：[PREPROCESS.md](../../PREPROCESS.md)。

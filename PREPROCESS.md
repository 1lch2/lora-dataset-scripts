# 自动化数据预处理

原有脚本保持独立可用。新流程适用于一张或多张图片，没有最少图片数量限制。

## 安装独立环境

不要将下面的依赖装进 Forge 环境，也不要与原来的 `requirements.txt` 混装。检测使用独立的 CPU ONNX Runtime，放大与 WD14 通过 Forge 使用 GPU；这样不会争用同一套 NumPy、OpenCV 和 CUDA 依赖。

```powershell
uv venv --python 3.10 .venv-preprocess
uv pip sync requirements-preprocess.lock --python .venv-preprocess/Scripts/python.exe
```

`requirements-preprocess.lock` 锁定完整依赖；waifuc 固定在 `efe5c49171a94a6441a79b7d7b595d4b3a4eb51f`，imgutils 固定为 0.19.0。需要重新解析依赖时：

```powershell
uv pip compile requirements-preprocess.in --python .venv-preprocess/Scripts/python.exe --output-file requirements-preprocess.lock
```

首次准备会从 Hugging Face 下载动漫人物、头部检测和 DWPose 模型，默认缓存在工作目录的父目录下 `.models`，遵循已有 `HF_HOME` 设置。模型缓存可跨运行复用。

## 输入和配置

### 双击启动 WebUI

配置好 `preprocess.local.json` 后，双击根目录的 `start-webui.bat`。入口先检查配置中的 Forge API：已运行则复用，未运行则打开独立可见终端，调用 `E:\stable-diffusion-webui-forge-classic\webui.bat`，等待 API 就绪后启动审核页。同一数据集的审核服务若已运行也会复用。

新 Forge 终端标题为 `Forge - API / model logs`，保留实时日志，关闭该终端可停止本次启动的 Forge；审核服务使用启动入口的终端，关闭它不影响独立的 Forge。复用已有 Forge 时，其原有终端状态保持不变。Forge 退出后终端会等待按 Enter，不会立即消失。

入口读取 `webui-user.bat` 中静态的 `COMMANDLINE_ARGS`，补充 `--api` 和配置地址的端口，不修改 Forge 文件。如果启动参数使用了批处理变量或动态命令，请手动启动带 `--api` 的 Forge 后复用。端口已占用但 API 尚未就绪时只等待，不重复拉起模型进程；默认等待 600 秒。

也可指定其他路径或端口：

```powershell
.\start-webui.bat --config preprocess.local.json --forge-dir "E:\stable-diffusion-webui-forge-classic" --port 8765
```

新运行目录还没有 `manifest.json` 时会先准备素材，进度显示在启动终端；已有运行直接恢复审核。此入口不会自动接受裁框或自动打标。

复制 `preprocess.example.json` 为 `preprocess.local.json`，修改路径。相对路径以配置文件所在目录为基准。输入、工作、训练输出三者必须互不包含。

默认按一级目录识别身份，支持内部递归读取：

```text
dataset-raw/
  entelechia (dazzling blue)/
    image.jpg
    nested/image.jpg
```

同名文件通过来源路径的稳定标识区分。图片支持 PNG、JPEG/JFIF、WebP、BMP、TIFF、GIF；动画只取第一帧。不自动读取下载图片附带的 waifuc 元数据或继承旧 caption。

若整批图片只有一个身份，可直接指定目录和身份，无需重新整理：

```json
{
  "input_dir": "E:/LoraTrainingMaterial/隐德来希",
  "identity": "entelechia (dazzling blue)",
  "run_dir": "runs/entelechia",
  "output_dir": "dataset-ready/entelechia",
  "tags_csv": "E:/模型目录/selected_tags.csv"
}
```

其他项使用示例配置的默认值。`tags_csv` 必须指向正在使用的 EVA02-Large v3 模型配套词表，不能混用其他模型词表。默认标签阈值 0.3，作品名 `arknights`。身份目录名作为完整描述，不拆分角色和服装。

## 运行顺序

先启动带 `--api` 的 Forge，默认地址 `http://127.0.0.1:7860`。必须可通过 API 列出 `4x-UltraSharpV2`、`ScuNET` 和 `wd-eva02-large-tagger-v3`，不存在时会报错，不静默替换模型。

```powershell
.venv-preprocess/Scripts/python.exe preprocess.py prepare --config preprocess.local.json
.venv-preprocess/Scripts/python.exe preprocess.py review --run runs/entelechia
```

准备完成后在浏览器裁切页：

1. 查看原图和放大工作图；必要时修改倍率或选择多人图中的主体。
2. 在“裁切部位”选择候选，拖动内部移动裁框，拖动角点缩放；点击“新建裁框”后在工作图上拖出矩形。尺寸栏实时显示宽高、总像素及是否达到下限。
3. “保存修改”保留当前待审裁框；“接受并继续”或“拒绝并继续”自动切到下一个待审部位，本图完成后进入下一张待审图片。列表显示完成状态，也可批量接受本图全部待审裁框。

完整原图始终保留，不经过 GAN。工作图默认倍率按**总像素**分档：不足 1024² 为 1.5 倍；1024² 至不足 2048² 为 2 倍；达到 2048² 不放大。

五类初始候选为头部、腰上、膝盖以上、眼睛到小腿、下半身。关键点置信度不足或姿态异常时不强行生成。腰线按肩髋距离的 65% 估计，小腿位置使用膝踝中点，特殊花纹和衣物边界仍由人工调整。

下半身候选要求双膝可靠地位于画面内，且人物下缘至少延伸到较低膝盖以下约四分之一大腿长度。半身、膝盖附近截断或膝部定位不足时跳过该候选，不将漏检直接判定为半身图。旧运行再次 `prepare` 时仅移除不满足条件、尚未审核也未编辑或打标的下半身候选，保留其他审核状态及历史记录。

裁切目标为 1,048,576 像素，下限 943,719 像素；先沿垂直方向扩展到邻近身体范围，再向两侧扩展，始终限制在图像内。不要求正方形，不二次放大裁片，不填充背景。扩展到整幅图或与其他候选 IoU ≥ 0.95 时合并；面积仍不足的范围跳过，并说明原因。

裁框全部审核完后，点击网页上方“下一步：开始打标”。后台仅将已接受样本落盘，调用未修改的 `resize.py`（短边 1280），然后分别打标。页面显示已完成样本数，完成后自动进入标签审核；刷新页面仍可查看任务进度。失败后显示具体原因，点击“重试打标”继续，已完成结果会跳过。任务运行期间禁止同时修改数据。

页面固定在当前窗口内，顶部仅保留审核页签与阶段操作。左侧图片列表、右侧裁切设置各自滚动；工作图等比例填满剩余可用区域，底部接受／拒绝按钮始终可见。原图在右侧以缩略图对照显示，点击可查看大图。“专注裁切”可隐藏左侧列表及原图、倍率设置，让工作区获得更多空间。

标签页按左侧筛选、中间选图、右侧批量编辑排列。通过右侧“操作”选择添加、删除或替换标签；标签确认按钮固定在面板底部。样本、长标签和标签频次在各自组件内滚动。筛选后若仍选中了隐藏图片，批量编辑面板会明确显示数量。

在标签审核页：

1. 按身份、文件名、构图、包含或不包含的标签筛选。
2. 选择图片，查看选中图片的标签频次，批量添加、删除或替换。
3. 添加的标签作为人工触发词保留；不进行全局语义精简。
4. 如需撤销人工修改和构图自动删除，可“恢复原始打标”；最终身份清理仍会执行。
5. 完成后“确认选中标签”。任何后续标签修改都需要再次确认。

自动删除 `full body` 仅依据高置信度人物定位及实际被裁框排除的身体关键点；没有检测到某个部位不作为缺失证据。可在卡片中查看原始标签分数和自动删除记录。其余错标由人工筛查。

所有候选必须已接受或拒绝，所有接受样本必须完成标签确认，之后点击网页上方“导出训练集”。导出前按词表清理角色标签和显式配置的变体标签，再调用未修改的 `edit_caption.py` 前置 `目录名 (作品)`；人工补充的触发词受到保留。导出目录仅含身份目录、PNG 和同名 UTF-8 `.txt`，完成后页面显示输出路径。

CLI 入口仍保留，必要时可独立运行：

```powershell
.venv-preprocess/Scripts/python.exe preprocess.py tag --run runs/entelechia
.venv-preprocess/Scripts/python.exe preprocess.py export --run runs/entelechia
```

## 续跑与数据保留

- `prepare` 和 `tag` 可重复运行，完成项会跳过。单张失败会记录错误，继续其他图片，命令最终返回非零退出码。
- 修改倍率、主体或裁框后，相关裁片的标签需重新生成并复核；已有人工作业保留在操作记录中，并在重新打标后重放。完整原图不因倍率变化重新打标。
- 原来的候选、标签和工作图会保留在运行历史中。选主体或重新准备后被替换的手动画框可从历史坐标恢复，新提案不会自动沿用旧的接受状态。
- 源文件内容变化需重新 `prepare`。源图删除后重新扫描会将其标记为不活跃，不再导出。
- 输入和输出目录在已有运行中不可更换；需更换时创建新的 `run_dir`。
- 若最终输出被外部编辑，再次导出会停止以免覆盖。建议在审核页修改标签，或选择新的工作和输出目录保留旧结果。
- 同一运行禁止同时执行 CLI 写入和审核写入。审核服务器只监听本机回环地址，使用会话令牌校验写入操作。
- `review --port 8766 --no-browser` 可更换端口或禁止自动打开浏览器。

运行记录位于 `run_dir/manifest.json`，包含原始文件指纹、实际工作尺寸、工作图坐标、检测证据、处理耗时和标签历史。坐标映射使用真实尺寸，处理 Forge 对 8 像素的取整。

## 验证

```powershell
.venv-preprocess/Scripts/python.exe -m unittest discover -s tests -v
```

自动化测试使用合成图片和模拟 Forge；真实模型的视觉质量需要另外验收。真实样本验收不限制张数，优先覆盖现有图片中的小图、完整图、复杂服装、局部图和异常姿态。最终裁框、特殊花纹保留及触发词分配仍以人工审核为准。

本机真实模型、24 张素材及 15 份样本导出的验证结果见 [VALIDATION.md](VALIDATION.md)。

实现参考：[waifuc 裁切](https://github.com/deepghs/waifuc/blob/efe5c49171a94a6441a79b7d7b595d4b3a4eb51f/waifuc/action/split.py)、[Action 接口](https://github.com/deepghs/waifuc/blob/efe5c49171a94a6441a79b7d7b595d4b3a4eb51f/waifuc/action/base.py)、[DWPose](https://dghs-imgutils.deepghs.org/main/api_doc/pose/dwpose.html)。

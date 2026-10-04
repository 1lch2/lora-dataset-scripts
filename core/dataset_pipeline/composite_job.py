"""独立目录的双模型打标任务；源图片和已有标签只读。"""
import copy
import hashlib
import json
import threading
from pathlib import Path
from urllib.parse import urlparse

from .composite_tags import MODELS, merge_tags
from .forge import ForgeClient


EXTENSIONS = {'.png', '.jpg', '.jpeg', '.jfif', '.webp', '.bmp', '.tif', '.tiff'}


def plan_dataset(data):
    for key in ('directory', 'output_directory', 'forge_url'):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError('请填写输入目录、输出目录和 Forge 地址')
    source = Path(data['directory']).expanduser().resolve()
    output = Path(data['output_directory']).expanduser().resolve()
    if not source.is_dir():
        raise ValueError('输入目录不存在')
    if source.is_relative_to(output) or output.is_relative_to(source):
        raise ValueError('输入目录和输出根目录不能相同或互相包含')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError('输出根目录必须是新目录或空目录，避免覆盖已有结果')
    forge_url = data['forge_url'].strip().rstrip('/')
    parsed = urlparse(forge_url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.query or parsed.fragment or parsed.username:
        raise ValueError('Forge 地址必须是有效的 HTTP(S) 服务地址')
    recursive = data.get('recursive', True)
    if not isinstance(recursive, bool):
        raise ValueError('包含子目录必须为布尔值')
    files, skipped, stems = [], [], set()
    for path in sorted(source.rglob('*') if recursive else source.iterdir()):
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(source):
            raise ValueError(f'不读取指向数据集外部的图片：{path.name}')
        relative = path.relative_to(source)
        if path.with_suffix('.txt').exists():
            skipped.append(relative.as_posix())
            continue
        stem = relative.with_suffix('').as_posix().casefold()
        if stem in stems:
            raise ValueError(f'同一目录有多个同名不同扩展名图片，TXT 会冲突：{relative}')
        stems.add(stem)
        files.append(path)
    if not files:
        raise ValueError('没有未打标图片；已有同名 TXT 的图片会跳过')
    return source, output, forge_url, files, skipped


class CompositeTagJob:
    def __init__(self, config=None):
        config = config or {}
        self.models = (config.get('tagger_model', MODELS[0]), config.get('pixai_tagger_model', MODELS[1]))
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.state = {'status': 'idle', 'done': 0, 'total': 0, 'results': [], 'errors': []}

    def status(self):
        with self.lock:
            return copy.deepcopy(self.state)

    def start(self, data):
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('已有复合打标任务正在运行')
            source, output, forge_url, files, skipped = plan_dataset(data)
            output.mkdir(parents=True, exist_ok=True)
            # 独占创建的任务标记也阻止另一个服务实例复用同一输出根目录。
            with (output / 'job.json').open('x', encoding='utf-8') as stream:
                json.dump({'input': str(source), 'models': self.models, 'forge_url': forge_url}, stream, ensure_ascii=False)
            self.stop.clear()
            self.state = {'status': 'running', 'phase': '连接 Forge', 'done': 0, 'total': len(files),
                          'skipped': len(skipped), 'skipped_files': skipped, 'results': [], 'errors': [],
                          'output_directory': str(output), 'dataset_directory': str(output / 'dataset'),
                          'probability_directory': str(output / 'probabilities')}
            self.thread = threading.Thread(target=self.run, args=(source, output, forge_url, files), daemon=True)
            self.thread.start()
            return self.status()

    def cancel(self):
        with self.lock:
            if self.state['status'] == 'running':
                self.stop.set()
                self.state['status'] = 'cancelling'
            return self.status()

    def run(self, source, output, forge_url, files):
        try:
            client = ForgeClient({'forge_url': forge_url})
            available = client.request('GET', '/tagger/v1/interrogators')['models']
            missing = [model for model in self.models if model not in available]
            if missing:
                raise ValueError(f'Forge 缺少配置的打标模型：{", ".join(missing)}')
            for path in files:
                if self.stop.is_set():
                    break
                relative = path.relative_to(source)
                try:
                    # 读取一次原始字节，确保两个模型和输出图片使用同一输入。
                    if path.with_suffix('.txt').exists():
                        raise ValueError('扫描后出现同名 TXT，本项停止处理以保留已有标注')
                    content = path.read_bytes()
                    scores = {}
                    for model in self.models:
                        if self.stop.is_set():
                            break
                        with self.lock:
                            self.state.update(phase=model, current=relative.as_posix())
                        scores[model] = client.tag_bytes(content, model, 0.0)
                    if self.stop.is_set():
                        break
                    merged = merge_tags(scores, self.models)
                    merged['image_sha256'] = hashlib.sha256(content).hexdigest()
                    merged['image'] = relative.as_posix()
                    self.write_sample(output, relative, content, merged)
                    with self.lock:
                        self.state['results'].append({'file': relative.as_posix(),
                            'tags': len(merged['probabilities']), 'single_person': merged['single_person'],
                            'person_reason': merged['person_reason'], 'removed': merged['removed'],
                            'unresolved': merged['unresolved']})
                except Exception as error:
                    with self.lock:
                        self.state['errors'].append({'file': relative.as_posix(), 'error': str(error)})
                finally:
                    with self.lock:
                        self.state['done'] += 1
            with self.lock:
                self.state['status'] = 'cancelled' if self.stop.is_set() else 'failed' if self.state['errors'] else 'complete'
        except Exception as error:
            with self.lock:
                self.state['status'] = 'cancelled' if self.stop.is_set() else 'failed'
                self.state['errors'].append({'file': '', 'error': str(error)})
        finally:
            try:
                with (output / 'report.json').open('x', encoding='utf-8') as stream:
                    json.dump(self.status(), stream, ensure_ascii=False, indent=2)
            except OSError as error:
                with self.lock:
                    self.state['status'] = 'failed'
                    self.state['errors'].append({'file': 'report.json', 'error': str(error)})

    @staticmethod
    def write_sample(output, relative, content, merged):
        image = output / 'dataset' / relative
        caption = image.with_suffix('.txt')
        probabilities = (output / 'probabilities' / relative).with_suffix('.json')
        evidence = (output / 'evidence' / relative).with_suffix('.json')
        payloads = [(image, content),
                    (probabilities, (json.dumps(merged['probabilities'], ensure_ascii=False, indent=2) + '\n').encode('utf-8')),
                    (evidence, (json.dumps(merged, ensure_ascii=False, indent=2) + '\n').encode('utf-8')),
                    (caption, (', '.join(merged['probabilities']) + '\n').encode('utf-8'))]
        created = []
        try:
            for path, payload in payloads:
                if not path.resolve().is_relative_to(output.resolve()):
                    raise ValueError('输出路径超出任务目录')
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as stream:
                    created.append(path)
                    stream.write(payload)
        except Exception:
            # 只回滚本项独占创建的文件，已完成样本和其他文件不受影响。
            for path in reversed(created):
                path.unlink()
            raise

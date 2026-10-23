"""独立数据集处理：显式选择输入，预览后另存结果。"""
import copy
import os
import secrets
import shutil
import threading
from pathlib import Path

from PIL import Image, ImageOps

from .core import EXTENSIONS, file_digest


def ordinary_path(path):
    for part in (path, *path.parents):
        if part.is_symlink() or (part.exists() and getattr(part.lstat(), 'st_file_attributes', 0) & 0x400):
            raise ValueError(f'不支持符号链接或目录联接：{part}')


def input_directory(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('请选择输入目录')
    path = Path(value).expanduser().absolute()
    ordinary_path(path)
    path = path.resolve()
    if not path.is_dir():
        raise ValueError('输入目录不存在')
    return path


def scan_files(data):
    folder = input_directory(data.get('directory'))
    recursive = data.get('recursive', True)
    if not isinstance(recursive, bool):
        raise ValueError('递归选项必须为布尔值')
    files = []
    def scan_error(error):
        raise error
    for base, directories, names in os.walk(folder, followlinks=False, onerror=scan_error):
        directories[:] = sorted(d for d in directories if not d.startswith('.'))
        for child in directories:
            ordinary_path(Path(base) / child)
        for name in sorted(names):
            path = Path(base) / name
            if path.suffix.lower() not in EXTENSIONS:
                continue
            ordinary_path(path)
            files.append({'path': path.relative_to(folder).as_posix(), 'bytes': path.stat().st_size})
        if not recursive:
            break
    return {'directory': str(folder), 'files': sorted(files, key=lambda f: f['path'])}


def output_directory(value, source):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('请输入新的输出目录')
    path = Path(value).expanduser().absolute()
    ordinary_path(path)
    path = path.resolve()
    if path == source or path.is_relative_to(source) or source.is_relative_to(path):
        raise ValueError('输出目录不能与输入目录重叠')
    if path.exists():
        raise ValueError('输出目录已存在，请指定一个新目录')
    return path


class DatasetToolsJob:
    def __init__(self):
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.state = {'status': 'idle', 'done': 0, 'total': 0, 'errors': [], 'entries': [], 'groups': []}
        self.plan = None

    def status(self):
        with self.lock:
            return copy.deepcopy(self.state)

    def busy(self):
        return self.state['status'] in ('preparing', 'running')

    def update(self, **values):
        with self.lock:
            self.state.update(values)

    def check_cancel(self):
        if self.cancelled.is_set():
            raise InterruptedError('已取消；已另存的文件保留，原图未修改')

    def preview(self, data):
        with self.lock:
            if self.busy():
                raise ValueError('已有数据集工具任务正在运行')
            source = input_directory(data.get('directory'))
            output = output_directory(data.get('output'), source)
            operation = data.get('operation')
            if operation not in ('resize', 'reverse', 'deduplicate'):
                raise ValueError('未知数据集工具')
            paths = data.get('paths')
            if not isinstance(paths, list) or not paths or any(not isinstance(p, str) for p in paths):
                raise ValueError('请至少选择一张图片')
            length, threshold = data.get('length', 1280), data.get('threshold', 10)
            if type(length) is not int or not 1 <= length <= 16384:
                raise ValueError('短边长度须为 1–16384 的整数')
            if type(threshold) is not int or not 0 <= threshold <= 64:
                raise ValueError('哈希距离须为 0–64 的整数')
            mode = data.get('duplicateMode', 'separate')
            if mode not in ('separate', 'omit'):
                raise ValueError('未知重复图处理方式')
            files = []
            for relative in sorted(set(paths)):
                path = source / relative
                ordinary_path(path)
                if Path(relative).is_absolute() or not path.resolve().is_relative_to(source) or not path.is_file() or path.suffix.lower() not in EXTENSIONS:
                    raise ValueError('所选图片不存在或路径越界')
                resolved = path.resolve()
                if resolved not in files:
                    files.append(resolved)
            self.cancelled.clear()
            self.plan = None
            self.state = {'id': secrets.token_hex(12), 'status': 'preparing', 'done': 0,
                          'total': len(files), 'errors': [], 'entries': [], 'groups': [],
                          'directory': str(source), 'output': str(output), 'operation': operation}
            threading.Thread(target=self.prepare, args=(source, output, files, operation, length, threshold, mode), daemon=True).start()
            return self.status()

    def prepare(self, source, output, files, operation, length, threshold, mode):
        try:
            records, hashes = [], []
            for index, path in enumerate(files):
                self.check_cancel()
                fingerprint = file_digest(path)
                with Image.open(path) as image:
                    if getattr(image, 'n_frames', 1) > 1:
                        raise ValueError(f'不支持多帧图片，请取消勾选：{path.name}')
                    size = ImageOps.exif_transpose(image).size
                result_size = size
                if operation == 'resize' and min(size) >= length:
                    ratio = length / min(size)
                    result_size = (int(size[0] * ratio), int(size[1] * ratio))
                if operation == 'deduplicate':
                    # 与旧去重脚本一致：OpenCV 灰度、INTER_AREA 和 8×8 平均哈希。
                    import cv2
                    import numpy as np
                    decoded = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if decoded is None:
                        raise ValueError(f'无法读取图片：{path.name}')
                    small = cv2.resize(cv2.cvtColor(decoded, cv2.COLOR_BGR2GRAY), (8, 8), interpolation=cv2.INTER_AREA)
                    hashes.append(sum(int(bit) << i for i, bit in enumerate((small > small.mean()).flat)))
                captions = [p for p in path.parent.iterdir() if p.is_file() and p.stem.casefold() == path.stem.casefold() and p.suffix.lower() == '.txt']
                if len(captions) > 1:
                    raise ValueError(f'图片存在多个同名标签：{path.name}')
                caption = captions[0] if captions else None
                if caption:
                    ordinary_path(caption)
                records.append({'path': path.relative_to(source).as_posix(), 'size': list(size),
                                'resultSize': list(result_size), 'bytes': path.stat().st_size,
                                'fingerprint': fingerprint, 'caption': caption.relative_to(source).as_posix() if caption else None,
                                'captionFingerprint': file_digest(caption) if caption else None, 'duplicate': False})
                self.update(done=index + 1)
            groups, processed = [], set()
            if operation == 'deduplicate':
                for i, value in enumerate(hashes):
                    self.check_cancel()
                    if i in processed:
                        continue
                    indices = [i]
                    processed.add(i)
                    for j in range(i + 1, len(hashes)):
                        self.check_cancel()
                        if j not in processed and (value ^ hashes[j]).bit_count() <= threshold:
                            indices.append(j)
                            processed.add(j)
                    if len(indices) < 2:
                        continue
                    indices.sort(key=lambda k: -records[k]['bytes'])
                    for j in indices[1:]:
                        records[j]['duplicate'] = True
                    groups.append({'keep': records[indices[0]]['path'], 'duplicates': [records[j]['path'] for j in indices[1:]]})
            for record in records:
                relative = record['path']
                if operation == 'deduplicate' and mode == 'separate':
                    relative = ('duplicates/' if record['duplicate'] else 'kept/') + relative
                record['destination'] = None if record['duplicate'] and mode == 'omit' else relative
            self.plan = (source, output, records, operation, length)
            self.update(status='ready', entries=records, groups=groups)
        except InterruptedError as error:
            self.update(status='cancelled', errors=[str(error)])
        except Exception as error:
            self.update(status='failed', errors=[str(error)])

    def execute(self, data):
        with self.lock:
            if self.state['status'] != 'ready' or data.get('id') != self.state.get('id') or self.plan is None:
                raise ValueError('预览已失效，请重新生成预览')
            output_directory(str(self.plan[1]), self.plan[0])
            self.cancelled.clear()
            self.update(status='running', done=0)
            threading.Thread(target=self.process, daemon=True).start()
            return self.status()

    def process(self):
        source, output, records, operation, length = self.plan
        try:
            # 所有输入（含标签）先校验，再创建输出，避免过期预览触发部分处理。
            for record in records:
                self.check_cancel()
                for key, digest_key in (('path', 'fingerprint'), ('caption', 'captionFingerprint')):
                    if record[key]:
                        path = source / record[key]
                        ordinary_path(path)
                        if file_digest(path) != record[digest_key]:
                            raise ValueError('输入图片或标签已变化，请重新扫描和预览')
            output_directory(str(output), source)
            output.mkdir(parents=True, exist_ok=False)
            copied_captions = set()
            for index, record in enumerate(records):
                self.check_cancel()
                if record['destination'] is not None:
                    path = source / record['path']
                    destination = output / record['destination']
                    ordinary_path(destination)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if operation == 'deduplicate' or (operation == 'resize' and record['size'] == record['resultSize']):
                        with destination.open('xb') as stream, path.open('rb') as original:
                            shutil.copyfileobj(original, stream)
                    else:
                        with Image.open(path) as image:
                            result = ImageOps.exif_transpose(image)
                            if operation == 'reverse':
                                result = ImageOps.mirror(result)
                            else:
                                result = result.resize(tuple(record['resultSize']), Image.Resampling.LANCZOS)
                            with destination.open('xb') as stream:
                                result.save(stream, format=image.format)
                    if record['caption']:
                        caption_output = destination.with_name(Path(record['caption']).name)
                        if caption_output not in copied_captions:
                            ordinary_path(caption_output)
                            with caption_output.open('xb') as stream, (source / record['caption']).open('rb') as original:
                                shutil.copyfileobj(original, stream)
                            copied_captions.add(caption_output)
                self.update(done=index + 1)
            self.update(status='complete')
        except InterruptedError as error:
            self.update(status='cancelled', errors=[str(error)])
        except Exception as error:
            self.update(status='failed', errors=[str(error) + '；已另存的文件保留，原图未修改'])

    def cancel(self):
        with self.lock:
            if self.busy():
                self.cancelled.set()
            return self.status()

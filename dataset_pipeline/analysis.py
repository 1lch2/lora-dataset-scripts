"""Read-only, local dataset measurements. Never exports pixels or image metadata."""
import argparse
import csv
import hashlib
import io
import json
import os
import stat
import sys
from pathlib import Path
from collections import Counter

import numpy as np
from PIL import Image, ImageOps, ImageCms

EXTENSIONS = {'.png', '.jpg', '.jpeg', '.jfif', '.webp', '.bmp', '.tif', '.tiff'}
METRICS = ('brightness', 'linear_luminance', 'contrast', 'highlights', 'shadows',
           'channel_clip', 'saturation', 'red_blue_bias', 'detail', 'megapixels', 'aspect',
           'center_brightness', 'border_brightness', 'person_area', 'person_brightness')


def write_progress(target, data):
    """Best effort telemetry: Windows readers can briefly prevent os.replace.

    Keep the last complete snapshot and retry on the next update. A progress-file
    failure must never discard the actual analysis or suppress report-write errors.
    """
    target = Path(target)
    temporary = target.with_suffix('.tmp')
    try:
        temporary.write_text(json.dumps(data), encoding='utf-8')
        temporary.replace(target)
    except OSError:
        pass


def offline_mode():
    # Called in the dedicated analysis process, before importing model libraries.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import socket
    def blocked(*args, **kwargs):
        raise OSError('Dataset analysis network access is disabled')
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked
    socket.create_connection = blocked


def local_pose(image):
    if os.environ.get('HF_HUB_OFFLINE') != '1':
        raise RuntimeError('Use the offline analysis CLI/process for model inference')
    from imgutils.detect import detect_person
    from imgutils.pose import dwpose_estimate
    people = detect_person(image, level='m', version='v1.1', conf_threshold=.3)
    poses = dwpose_estimate(image, auto_detect=False, out_bboxes=[p[0] for p in people]) if people else []
    return [{'box': p[0], 'points': pose.body.tolist()} for p, pose in zip(people, poses)]


def describe(values, bounds=None):
    a = np.asarray(values, dtype=float)
    a = a[np.isfinite(a)]
    if not len(a):
        return {'count': 0}
    if bounds is None:
        low, high = float(a.min()),float(a.max())
        bounds = (max(0,low*.9),max(high*1.1,low+.001)) if low == high else (low,high)
    hist, edges = np.histogram(a, bins=20, range=bounds)
    return dict(count=len(a), mean=float(a.mean()), std=float(a.std()),
                p05=float(np.quantile(a, .05)), median=float(np.median(a)),
                p95=float(np.quantile(a, .95)), histogram=hist.tolist(), edges=edges.tolist())


def measure(image):
    rgb = np.asarray(image, dtype=np.float32) / 255
    y = rgb @ np.array([.2126, .7152, .0722])
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    maximum, minimum = rgb.max(axis=2), rgb.min(axis=2)
    saturation = np.divide(maximum-minimum, maximum, out=np.zeros_like(maximum), where=maximum > 0)
    h, w = y.shape
    center = y[h//4:max(h//4+1, 3*h//4), w//4:max(w//4+1, 3*w//4)]
    border = np.ones((h, w), dtype=bool)
    border[h//4:max(h//4+1, 3*h//4), w//4:max(w//4+1, 3*w//4)] = False
    dx = np.abs(np.diff(y, axis=1)).mean() if w > 1 else 0
    dy = np.abs(np.diff(y, axis=0)).mean() if h > 1 else 0
    metrics = dict(brightness=float(y.mean()), linear_luminance=float((linear @ [.2126,.7152,.0722]).mean()),
                   contrast=float(y.std()), highlights=float((y >= .98).mean()),
                   shadows=float((y <= .02).mean()), channel_clip=float((maximum >= 250/255).mean()),
                   saturation=float(saturation.mean()), red_blue_bias=float((rgb[:,:,0]-rgb[:,:,2]).mean()),
                   detail=float((dx+dy)/2), center_brightness=float(center.mean()),
                   border_brightness=float(y[border].mean()) if border.any() else float(y.mean()))
    hist = np.histogram(y, bins=32, range=(0,1))[0].astype(float)
    hist /= hist.sum()
    small = np.asarray(image.convert('L').resize((9,8), Image.Resampling.LANCZOS))
    bits = small[:,1:] > small[:,:-1]
    fingerprint = int.from_bytes(np.packbits(bits).tobytes(), 'big')
    return metrics, hist, fingerprint


def pose_vector(points):
    """OP18 torso-normalized joints; require reliable torso and >=8 body joints."""
    a = np.asarray(points, dtype=float)
    if a.shape != (18,3) or not np.isfinite(a).all():
        return None
    valid = a[:,2] >= .3
    if not valid[[2,5,8,11]].all() or valid[:14].sum() < 8:
        return None
    shoulder, hip = a[[2,5],:2].mean(axis=0), a[[8,11],:2].mean(axis=0)
    scale = np.linalg.norm(shoulder-hip)
    if scale < 1:
        return None
    return ((a[:14,:2]-hip)/scale, valid[:14])


def pose_distance(a, b):
    common = a[1] & b[1]
    if common.sum() < 8:
        return None
    return float(np.sqrt(np.mean(np.sum((a[0][common]-b[0][common])**2, axis=1))))


def analyze_directory(directory, *, recursive=True, pose=False, captions=False,
                      pair_limit=1500, pose_threshold=.18, hash_threshold=6,
                      progress=None, detector=None):
    root = Path(directory).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError('输入路径必须是目录')
    if not 2 <= pair_limit <= 5000 or not 0 < pose_threshold <= 1 or not 0 <= hash_threshold <= 16:
        raise ValueError('比较上限或相似阈值超出范围')
    files, scan_warnings = [], []
    def scan_error(error):
        scan_warnings.append('部分目录无法枚举，统计可能不完整：'+type(error).__name__)
    def ordinary_directory(path):
        try:
            # Python 3.10 has no Path.is_junction; inspect the Windows reparse flag.
            return not path.is_symlink() and not (getattr(path.lstat(),'st_file_attributes',0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)
        except OSError as error:
            scan_error(error)
            return False
    # Do not follow directory links or Windows junctions out of the chosen dataset.
    for folder, dirs, names in os.walk(root, followlinks=False, onerror=scan_error):
        dirs[:] = sorted(d for d in dirs if ordinary_directory(Path(folder,d))) if recursive else []
        for name in sorted(names):
            path = Path(folder, name)
            if path.suffix.lower() in EXTENSIONS and not path.is_symlink() and path.resolve().is_relative_to(root):
                files.append(path)
    files.sort(key=lambda p: p.relative_to(root).as_posix())
    # Evenly spaced deterministic coverage; explicitly report pair-analysis sampling.
    selected = set(np.linspace(0, len(files)-1, min(pair_limit, len(files)), dtype=int).tolist()) if files else set()
    records, errors, warnings, hashes, poses = [], [], scan_warnings, [], []
    exact = {}
    pixel_hist = np.zeros(32)
    caption_counts = Counter()
    caption_read = 0
    pose_attempts = pose_detected = pose_usable = 0
    pose_error = None
    detect = detector or local_pose
    for index, path in enumerate(files):
        relative = path.relative_to(root).as_posix()
        if progress:
            progress({'phase':'images', 'done':index, 'total':len(files)})
        try:
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024*1024), b''):
                    digest.update(chunk)
            with Image.open(path) as original:
                image = ImageOps.exif_transpose(original)
                width, height = image.size
                flags = []
                if getattr(original, 'n_frames', 1) > 1:
                    flags.append('仅分析首帧')
                alpha = image.convert('RGBA').getchannel('A') if 'A' in image.getbands() or 'transparency' in image.info else None
                transparency = 1-float(np.asarray(alpha).mean()/255) if alpha is not None else 0
                profile = image.info.get('icc_profile')
                if profile:
                    try:
                        image = ImageCms.profileToProfile(image.convert('RGB'), ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                                                         ImageCms.createProfile('sRGB'), outputMode='RGB')
                    except (ValueError, OSError, ImageCms.PyCMSError):
                        flags.append('ICC 转换失败，按 sRGB 估计')
                        image = image.convert('RGB')
                else:
                    image = image.convert('RGB')
                if alpha is not None:
                    background = Image.new('RGB', image.size, (127,127,127))
                    background.paste(image, mask=alpha)
                    image = background
                image.thumbnail((512,512), Image.Resampling.LANCZOS)
                metrics, histogram, fingerprint = measure(image)
                row = dict(file=relative, width=width, height=height, megapixels=width*height/1e6,
                           aspect=width/height, transparency=transparency, flags=flags, **metrics)
                if pose and pose_error is None:
                    pose_attempts += 1
                    try:
                        people = detect(image)
                        row['people'] = len(people)
                        if people:
                            pose_detected += 1
                            primary = max(people, key=lambda p: (p['box'][2]-p['box'][0])*(p['box'][3]-p['box'][1]))
                            x0,y0,x1,y1 = primary['box']
                            x0,y0 = max(0,int(x0)),max(0,int(y0))
                            x1,y1 = min(image.width,int(x1)),min(image.height,int(y1))
                            if x1>x0 and y1>y0:
                                row['person_area'] = (x1-x0)*(y1-y0)/(image.width*image.height)
                                row['person_brightness'] = measure(image.crop((x0,y0,x1,y1)))[0]['brightness']
                            vector = pose_vector(primary['points'])
                            row['pose_usable'] = vector is not None
                            if vector is not None:
                                pose_usable += 1
                                if index in selected:
                                    poses.append((relative, vector))
                    except Exception as error:
                        pose_error = type(error).__name__
                        warnings.append('姿势检测不可用或中断（'+pose_error+'）；仅使用本地缓存，不会下载模型。已保留其他统计。')
                if captions:
                    caption = path.with_suffix('.txt')
                    if caption.is_file() and not caption.is_symlink() and caption.resolve().is_relative_to(root):
                        try:
                            if caption.stat().st_size > 1024*1024:
                                raise ValueError('caption too large')
                            tags = {t.strip().replace('_',' ') for t in caption.read_text(encoding='utf-8-sig').replace('\n', ',').split(',') if t.strip()}
                            caption_counts.update(tags)
                            row['tag_count'] = len(tags)
                            caption_read += 1
                        except (ValueError, UnicodeError, OSError):
                            flags.append('同名 TXT 无法读取或超过 1 MiB')
                records.append(row)
                pixel_hist += histogram
                exact.setdefault(digest.hexdigest(), []).append(relative)
                if index in selected:
                    hashes.append((relative, fingerprint, row['brightness'], row['contrast']))
        except Exception as error:
            # Paths are relative; exceptions cannot leak EXIF, prompts or decoded pixels.
            errors.append({'file':relative, 'error':type(error).__name__})
    near, pose_pairs = [], []
    near_count = pose_pair_count = comparable = 0
    near_members, pose_members = set(), set()
    total_pairs = len(hashes)*(len(hashes)-1)//2
    done = 0
    for i, (name, value, brightness, contrast) in enumerate(hashes):
        if progress:
            progress({'phase':'similarity', 'done':done, 'total':total_pairs})
        for other, other_hash, other_brightness, other_contrast in hashes[:i]:
            distance = (value ^ other_hash).bit_count()
            # Flat color images have degenerate dHashes, so do not claim near duplicates.
            if min(contrast, other_contrast) >= .02 and abs(brightness-other_brightness) <= .15 and distance <= hash_threshold:
                near_count += 1
                near_members.update((name,other))
                if len(near) < 500:
                    near.append({'a':other,'b':name,'distance':distance})
            done += 1
    for i, (name, vector) in enumerate(poses):
        if progress:
            progress({'phase':'poses', 'done':i, 'total':len(poses)})
        for other, other_vector in poses[:i]:
            distance = pose_distance(vector, other_vector)
            if distance is None:
                continue
            comparable += 1
            if distance <= pose_threshold:
                pose_pair_count += 1
                pose_members.update((name,other))
                if len(pose_pairs) < 500:
                    pose_pairs.append({'a':other,'b':name,'distance':distance})
    summary = {key:describe([r[key] for r in records if key in r], (-1,1) if key=='red_blue_bias' else
                           None if key in ('aspect','megapixels') else (0,1)) for key in METRICS}
    exact_groups = [group for group in exact.values() if len(group)>1]
    if not files:
        warnings.append('目录中没有支持的图片。')
    if summary['highlights'].get('mean',0) > .05:
        warnings.append('高光端像素占比较高：结合人物框亮度与边缘亮度判断白背景、发光特效或高光截断；不能仅凭此认定过曝。')
    if summary['brightness'].get('std',1) < .08 and records:
        warnings.append('图片平均亮度集中；建议与目标风格或对照数据集比较，避免盲目统一压暗。')
    return dict(schema_version=1, total=len(files), successful=len(records), failed=len(errors),
                settings=dict(recursive=recursive,pose=pose,captions=captions,pair_limit=pair_limit,
                              pose_threshold=pose_threshold,hash_threshold=hash_threshold,measurement_side=512),
                summary=summary, pixel_histogram=(pixel_hist/max(1,len(records))).tolist(),
                errors=errors, warnings=warnings, records=records,
                duplicates=dict(exact_groups=exact_groups, exact_extra=sum(len(g)-1 for g in exact_groups),
                                sampled=len(hashes), population=len(records), compared_pairs=total_pairs,
                                near_count=near_count, near_members=len(near_members), near_pairs=near,
                                flat_excluded=sum(h[3]<.02 for h in hashes)),
                pose=dict(enabled=pose, attempted=pose_attempts, detected=pose_detected, usable=pose_usable,
                          error=pose_error, sampled=len(poses), comparable_pairs=comparable,
                          similar_pairs=pose_pair_count, similar_images=len(pose_members), pairs=pose_pairs),
                captions=dict(enabled=captions,read=caption_read, tags=caption_counts.most_common()))


def csv_report(report):
    stream = io.StringIO(newline='')
    fields = ['file','width','height',*METRICS,'transparency','people','pose_usable','tag_count','flags']
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
    writer.writeheader()
    for row in report['records']:
        safe = {k:(' | '.join(v) if isinstance(v,list) else v) for k,v in row.items()}
        for key,value in safe.items():
            if isinstance(value,str) and value.startswith(('=','+','-','@','\t','\r','\n')):
                safe[key] = "'"+value
        writer.writerow(safe)
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description='本地数据集统计：不上传图片、不修改源文件')
    parser.add_argument('directory')
    parser.add_argument('--output', required=True, help='新的报告 JSON 文件，拒绝覆盖已有文件')
    parser.add_argument('--csv', help='新的逐图 CSV 文件')
    parser.add_argument('--pose', action='store_true', help='启用已缓存的本地人物/DWPose 模型')
    parser.add_argument('--captions', action='store_true')
    parser.add_argument('--no-recursive', action='store_true')
    parser.add_argument('--pair-limit', type=int, default=1500)
    parser.add_argument('--pose-threshold', type=float, default=.18)
    parser.add_argument('--hash-threshold', type=int, default=6)
    parser.add_argument('--model-cache', help='已有 Hugging Face 缓存根目录 HF_HOME')
    parser.add_argument('--progress', help=argparse.SUPPRESS)
    parser.add_argument('--error-file', help=argparse.SUPPRESS)
    args = parser.parse_args()
    offline_mode()
    if args.model_cache:
        os.environ['HF_HOME'] = str(Path(args.model_cache).resolve())
    output = Path(args.output)
    if output.exists() or (args.csv and Path(args.csv).exists()):
        parser.error('报告文件已存在，请使用新的文件名')
    if args.csv and Path(args.csv).resolve() == output.resolve():
        parser.error('JSON 和 CSV 必须使用不同文件名')
    def progress(data):
        if args.progress:
            write_progress(args.progress, data)
    stage = 'analysis'
    try:
        report = analyze_directory(args.directory, recursive=not args.no_recursive,pose=args.pose,
                                   captions=args.captions,pair_limit=args.pair_limit,
                                   pose_threshold=args.pose_threshold,hash_threshold=args.hash_threshold,progress=progress)
        stage = 'report'
        with output.open('x',encoding='utf-8') as stream:
            json.dump(report,stream,ensure_ascii=False,allow_nan=False)
        if args.csv:
            stage = 'csv'
            with Path(args.csv).open('x',encoding='utf-8-sig',newline='') as stream:
                stream.write(csv_report(report))
        return 0
    except Exception as error:
        # Diagnostic fields deliberately omit dataset paths, captions and pixels.
        if args.error_file:
            try:
                Path(args.error_file).write_text(json.dumps(dict(type=type(error).__name__,stage=stage,
                    errno=getattr(error,'errno',None),winerror=getattr(error,'winerror',None))),encoding='utf-8')
            except OSError:
                pass
        print(type(error).__name__+': '+str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

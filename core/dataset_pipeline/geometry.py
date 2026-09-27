"""Pure crop geometry; all coordinates refer to the actual working image."""
import math


TARGET_AREA = 1024**2
MIN_AREA = math.ceil(TARGET_AREA * 0.9)


def default_scale(size):
    area = size[0] * size[1]
    return 1.5 if area < 1024**2 else 2.0 if area < 2048**2 else 1.0


def area(box):
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def iou(a, b):
    intersection = area([max(a[0], b[0]), max(a[1], b[1]),
                         min(a[2], b[2]), min(a[3], b[3])])
    union = area(a) + area(b) - intersection
    return intersection / union if union else 0.0


def validate_box(box, size):
    if len(box) != 4 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in box):
        raise ValueError("裁框必须是四个有限坐标")
    box = [round(v) for v in box]
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= size[0] and 0 <= y0 < y1 <= size[1]):
        raise ValueError("裁框为空或超出工作图范围")
    return box


def to_original(box, working_size, original_size):
    return [v * original_size[i % 2] / working_size[i % 2] for i, v in enumerate(box)]


def _interval(center, length, limit):
    length = min(limit, math.ceil(length))
    start = min(max(0, math.floor(center - length / 2)), limit - length)
    return start, start + length


def expand_box(box, size, target=TARGET_AREA):
    """Grow vertically into adjoining body regions, then sideways; never pad."""
    w, h = size
    x0, y0, x1, y1 = box
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        raise ValueError("无效检测框")
    if area([x0, y0, x1, y1]) < target:
        y0, y1 = _interval((y0 + y1) / 2, max(y1 - y0, target / (x1 - x0)), h)
        x0, x1 = _interval((x0 + x1) / 2, max(x1 - x0, target / (y1 - y0)), w)
    return validate_box([x0, y0, x1, y1], size)


def _mean_point(points, indices, confidence=0.3):
    selected = [points[i] for i in indices if i < len(points) and points[i][2] >= confidence]
    # Bilateral anchors require both joints; do not infer absence from a missed joint.
    if len(selected) != len(indices):
        return None
    return [sum(p[j] for p in selected) / len(selected) for j in (0, 1)]


def propose(size, detection, target=TARGET_AREA, minimum=MIN_AREA, duplicate_iou=0.95, person_index=None):
    people = detection.get("persons", [])
    if person_index is None and len(people) != 1:
        return [], ["未检测到人物，请手动画框" if not people else "检测到多人，请选择主体或手动画框"]
    index = 0 if person_index is None else person_index
    if not 0 <= index < len(people):
        raise ValueError("主体编号无效")
    person = people[index]
    px0, py0, px1, py1 = person["box"]
    points = person.get("points", [])
    heads = [head for head in detection.get("heads", [])
             if px0 <= (head["box"][0] + head["box"][2]) / 2 <= px1
             and py0 <= (head["box"][1] + head["box"][3]) / 2 <= py1]
    heads.sort(key=lambda item: item["score"], reverse=True)
    head = heads[0]["box"] if heads else None
    shoulder, hip = _mean_point(points, [2, 5]), _mean_point(points, [8, 11])
    knee, ankle = _mean_point(points, [9, 12]), _mean_point(points, [10, 13])
    eyes = _mean_point(points, [14, 15])
    notes, initial = [], []
    top = head[1] if head else py0
    if head:
        x0, y0, x1, y1 = head
        dx, dy = (x1 - x0) * 0.15, (y1 - y0) * 0.15
        initial.append(("head", [x0 - dx, y0 - dy, x1 + dx, y1 + dy]))
    upright = (shoulder is not None and hip is not None and hip[1] > shoulder[1]
               and hip[1] - shoulder[1] > abs(hip[0] - shoulder[0]))
    if upright:
        waist = shoulder[1] + (hip[1] - shoulder[1]) * 0.65
        initial.append(("upper", [px0, top, px1, waist]))
        # Require visible knees and meaningful space below them, not just hips.
        # A quarter of the hip-to-knee distance avoids a crop ending at the knee.
        visible_knees = knee and all(0 <= points[i][0] < size[0]
                                    and 0 <= points[i][1] < min(py1, size[1]) for i in (9, 12))
        if (visible_knees and knee[1] > hip[1]
                and min(py1, size[1]) - max(points[i][1] for i in (9, 12))
                >= (knee[1] - hip[1]) * 0.25):
            initial.append(("lower", [px0, waist, px1, py1]))
        else:
            notes.append("下半身：未确认足够的膝下范围，跳过自动候选；需要时可手动画框")
        if knee and knee[1] > hip[1]:
            initial.append(("knees", [px0, top, px1, knee[1]]))
            if eyes and ankle and ankle[1] > knee[1] > eyes[1]:
                initial.append(("eyes_calf", [px0, eyes[1], px1, (knee[1] + ankle[1]) / 2]))
    else:
        notes.append("关键点不足或姿态倾斜：需要人工调整身体裁框")
    if len(initial) < 5:
        notes.append("部分范围定位不足，未强制生成五张")
    results = []
    # Stable presentation order, independent of missing anchors.
    initial.sort(key=lambda item: ["head", "upper", "knees", "eyes_calf", "lower"].index(item[0]))
    for kind, box in initial:
        try:
            box = expand_box(box, size, target)
        except ValueError:
            notes.append(f"{kind}: 检测框无效")
            continue
        if area(box) < minimum:
            notes.append(f"{kind}: 扩大后仍不足 {minimum} 像素")
            continue
        if iou(box, [0, 0, *size]) >= duplicate_iou:
            notes.append(f"{kind}: 与完整构图重复，保留未经 GAN 的原图")
            continue
        duplicate = next((r for r in results if iou(r["box"], box) >= duplicate_iou), None)
        if duplicate:
            duplicate["aliases"].append(kind)
        else:
            results.append({"id": kind, "kind": kind, "box": box, "aliases": [], "status": "pending"})
    return results, notes


def full_body_conflict(box, detection, size):
    """Positive evidence only: a reliable observed body landmark lies outside."""
    people = detection.get("persons", [])
    if box is None or len(people) != 1 or people[0]["score"] < 0.8:
        return False
    margin = max(size) * 0.02
    x0, y0, x1, y1 = box
    # DWPose synthesizes neck confidence as a boolean; it is not a measured score.
    for index, point in enumerate(people[0].get("points", [])[:24]):
        if index == 1:
            continue
        x, y, score = point
        if score >= 0.8 and 0 <= x < size[0] and 0 <= y < size[1]:
            if x < x0 - margin or x > x1 + margin or y < y0 - margin or y > y1 + margin:
                return True
    for head in detection.get("heads", []):
        if head["score"] >= 0.8:
            hx0, hy0, hx1, hy1 = head["box"]
            if hx1 < x0 - margin or hx0 > x1 + margin or hy1 < y0 - margin or hy0 > y1 + margin:
                return True
    return False


def tag_suggestions(tags, removed, box, detection):
    if box is None:
        return []
    notes = []
    if "full body" in tags and "full body" not in removed:
        notes.append("请核对 full body：样本经过裁切，但自动删除证据不足")
    if len(detection.get("persons", [])) == 1:
        for head in detection.get("heads", []):
            hx0, hy0, hx1, hy1 = head["box"]
            if head["score"] >= 0.8 and (hx1 <= box[0] or hx0 >= box[2] or hy1 <= box[1] or hy0 >= box[3]):
                for tag in ("upper body", "cowboy shot"):
                    if tag in tags:
                        notes.append(f"请核对 {tag}：裁框未包含检测到的头部")
                break
    return notes

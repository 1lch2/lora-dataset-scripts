"""从 Danbooru CSV 和 PixAI 配置生成类别快照，不依赖用户机器的运行时路径。"""
import argparse
import csv
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('danbooru_csv', type=Path)
    parser.add_argument('pixai_config', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    config = json.loads(args.pixai_config.read_text(encoding='utf-8'))
    categories = {}
    start = 0
    for category, count in config['tags_split']:
        categories[category] = config['tags'][start:start + count]
        start += count
    if start != len(config['tags']):
        raise ValueError('PixAI 类别分段与标签总量不符')
    meta = set(categories.get('meta', []))
    with args.danbooru_csv.open(encoding='utf-8-sig', newline='') as stream:
        for tag, category, count, synonyms in csv.reader(stream):
            if category == '5':
                meta.add(tag)
                meta.update(value for value in synonyms.split(',') if value)
    # 质量词可能不在某版 Danbooru 快照中，仍按用户要求明确排除。
    meta.update({'highres', 'absurdres', 'incredibly_absurdres', 'lowres', 'best_quality',
                 'high_quality', 'normal_quality', 'low_quality', 'worst_quality', 'masterpiece'})
    result = {'pixai_revision': 'b7b4ce5b5d8e3c24a1171ff2b266e3345761eb0e',
              'pixai_categories': categories, 'meta_tags': sorted(meta)}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'PixAI {start} tags; meta exclusions {len(meta)}')


if __name__ == '__main__':
    main()

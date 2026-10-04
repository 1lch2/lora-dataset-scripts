"""CLI for preparing, reviewing, tagging and exporting a local dataset."""
import argparse
import sys

from dataset_pipeline.core import Run, prepare, read_config, run_lock


def main():
    parser = argparse.ArgumentParser(description="LoRA 数据预处理：prepare → review → tag → review → export")
    commands = parser.add_subparsers(dest="command", required=True)
    analysis = commands.add_parser('analyze', help='独立打开数据集分析页，无需准备图片或启动 Forge')
    analysis.add_argument('--port', type=int, default=8766)
    analysis.add_argument('--frontend-port', type=int, default=5174)
    analysis.add_argument('--no-browser', action='store_true')
    analysis.add_argument('--config', help='复合打标使用的 preprocess JSON 配置')
    commands.add_parser("prepare", help="生成工作图和待审核裁框").add_argument("--config", required=True)
    for command in ("review", "tag", "export"):
        sub = commands.add_parser(command)
        sub.add_argument("--run", required=True)
        if command == "review":
            sub.add_argument("--port", type=int, default=8765)
            sub.add_argument('--frontend-port', type=int, default=5173)
            sub.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == 'analyze':
            from dataset_pipeline.review import serve
            config = read_config(args.config) if args.config else None
            serve(None, args.port, not args.no_browser, args.frontend_port, config=config)
            return 0
        if args.command == "review":
            from dataset_pipeline.review import serve
            serve(args.run, args.port, not args.no_browser, args.frontend_port)
            return 0
        if args.command == "prepare":
            config = read_config(args.config)
            with run_lock(config["run_dir"]):
                run, failures = prepare(config)
            print(f"工作目录: {run.directory}")
        else:
            with run_lock(args.run):
                run = Run.load(args.run)
                if args.command == "tag":
                    failures = run.tag_all()
                else:
                    print(f"已导出 {run.export()} 组图片和 caption")
                    failures = []
        for failure in failures:
            print(f"ERROR: {failure}", file=sys.stderr)
        return 1 if failures else 0
    except (ValueError, OSError, KeyError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { Box } from '../../../api/types';
import type { CropCanvasProps, CropDrag } from './types';

const IMAGE_PADDING_RATIO = 0.04;

export function CropCanvas({ image, box, disabled, visible, onChange }: CropCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imagePaddingRef = useRef(0);
  const dragRef = useRef<CropDrag | null>(null);
  const boxRef = useRef(box);
  boxRef.current = box;
  function draw() {
    const canvas = canvasRef.current!,
      ctx = canvas.getContext('2d')!,
      img = imageRef.current;
    if (!img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const padding = imagePaddingRef.current;
    ctx.drawImage(img, padding, padding);
    const current = boxRef.current;
    if (!current) return;
    ctx.save();
    ctx.translate(padding, padding);
    const [x0, y0, x1, y1] = current,
      scale = canvas.width / Math.max(canvas.getBoundingClientRect().width, 1);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.rect(0, 0, img.width, img.height);
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#53c582';
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = '#ffffff';
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].forEach(([x, y]) => ctx.fillRect(x - 4 * scale, y - 4 * scale, 8 * scale, 8 * scale));
    ctx.restore();
  }
  function fitCanvas() {
    if (!imageRef.current) return;
    const canvas = canvasRef.current!,
      stage = stageRef.current!;
    const ratio = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
    canvas.style.width = `${Math.max(1, Math.floor(canvas.width * ratio))}px`;
    canvas.style.height = `${Math.max(1, Math.floor(canvas.height * ratio))}px`;
    draw();
  }
  useEffect(() => {
    const canvas = canvasRef.current!;
    imageRef.current = null;
    imagePaddingRef.current = 0;
    dragRef.current = null;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      imageRef.current = img;
      const padding = Math.ceil(Math.max(img.width, img.height) * IMAGE_PADDING_RATIO);
      imagePaddingRef.current = padding;
      canvas.width = img.width + padding * 2;
      canvas.height = img.height + padding * 2;
      fitCanvas();
    };
    img.src = image;
    return () => {
      active = false;
      img.onload = null;
    };
  }, [image]);
  useEffect(() => {
    const observer = new ResizeObserver(fitCanvas);
    observer.observe(stageRef.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (visible) fitCanvas();
  }, [visible]);
  useEffect(draw, [box]);
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!,
      r = canvas.getBoundingClientRect();
    return [
      ((event.clientX - r.left) * canvas.width) / r.width - imagePaddingRef.current,
      ((event.clientY - r.top) * canvas.height) / r.height - imagePaddingRef.current,
    ];
  }
  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const img = imageRef.current;
    if (disabled || !img || event.button !== 0) return;
    const canvas = canvasRef.current!,
      p = point(event),
      tolerance = (12 * canvas.width) / canvas.getBoundingClientRect().width;
    const corner = box
      ? [
          [box[0], box[1]],
          [box[2], box[1]],
          [box[2], box[3]],
          [box[0], box[3]],
        ].findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < tolerance)
      : -1;
    const moving = box && p[0] > box[0] && p[0] < box[2] && p[1] > box[1] && p[1] < box[3];
    dragRef.current = {
      p: moving ? p : p.map((v, i) => Math.max(0, Math.min(v, i === 0 ? img.width : img.height))),
      before: box && [...box],
      mode: corner >= 0 ? 'corner' : moving ? 'move' : 'new',
      corner,
    };
    canvas.setPointerCapture(event.pointerId);
  }
  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const img = imageRef.current;
    if (!drag || !img) return;
    const p = point(event).map((v, i) => Math.max(0, Math.min(v, i === 0 ? img.width : img.height)));
    let next: Box;
    if (drag.mode === 'new')
      next = [
        Math.min(p[0], drag.p[0]),
        Math.min(p[1], drag.p[1]),
        Math.max(p[0], drag.p[0]),
        Math.max(p[1], drag.p[1]),
      ];
    else if (drag.mode === 'move') {
      const b = drag.before!,
        dx = Math.max(-b[0], Math.min(p[0] - drag.p[0], img.width - b[2])),
        dy = Math.max(-b[1], Math.min(p[1] - drag.p[1], img.height - b[3]));
      next = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
    } else {
      next = [...drag.before!];
      next[[0, 2, 2, 0][drag.corner]] = p[0];
      next[[1, 1, 3, 3][drag.corner]] = p[1];
    }
    boxRef.current = next;
    onChange(next);
  }
  function handlePointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    const b = boxRef.current;
    if (b)
      onChange(
        [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])].map(
          Math.round,
        ) as Box,
      );
  }
  return (
    <div id='canvasStage' ref={stageRef}>
      <canvas
        id='canvas'
        ref={canvasRef}
        aria-label='工作图裁框编辑器'
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}

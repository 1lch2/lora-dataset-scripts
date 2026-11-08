import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { ImageCompareProps } from './types';
import styles from './styles.module.css';

export function ImageCompare({ original, output, width, height }: ImageCompareProps) {
  const [split, setSplit] = useState(50);
  const [mode, setMode] = useState('compare');
  const [zoom, setZoom] = useState('fit');
  const frame = useRef<HTMLDivElement>(null);

  function handleSplit(event: PointerEvent<HTMLDivElement>) {
    if (mode !== 'compare' || event.buttons !== 1 || !frame.current) return;
    const bounds = frame.current.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)));
  }

  return (
    <div className={styles.compare}>
      <div className={styles.toolbar}>
        <div role='group' aria-label='预览模式' className={styles.modes}>
          {[
            ['compare', '对比'],
            ['original', '原图'],
            ['output', '结果'],
          ].map(([value, label]) => (
            <button key={value} type='button' aria-pressed={mode === value} onClick={() => setMode(value)}>
              {label}
            </button>
          ))}
        </div>
        <label>
          显示比例
          <select value={zoom} onChange={(event) => setZoom(event.target.value)}>
            <option value='fit'>适应宽度</option>
            <option value='1'>100%</option>
            <option value='2'>200%</option>
          </select>
        </label>
        <span>
          {width} × {height}
        </span>
      </div>
      <div className={styles.viewport}>
        <div
          ref={frame}
          className={styles.frame}
          style={{ width: zoom === 'fit' ? '100%' : width * Number(zoom) }}
          onPointerDown={(event) => {
            if (mode !== 'compare' || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            handleSplit(event);
          }}
          onPointerMove={handleSplit}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        >
          <img
            src={mode === 'output' ? output : original}
            style={mode === 'compare' ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : undefined}
            alt={mode === 'output' ? '降噪结果' : '原始图片'}
            draggable={false}
          />
          {mode === 'compare' ? (
            <>
              <img
                className={styles.overlay}
                style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                src={output}
                alt='降噪结果，分割线右侧'
                draggable={false}
              />
              <div className={styles.divider} style={{ left: `${split}%` }} aria-hidden='true'>
                <span>↔</span>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {mode === 'compare' ? (
        <label className={styles.slider}>
          原图
          <input
            aria-label='前后对比分割线'
            type='range'
            min='0'
            max='100'
            value={split}
            onChange={(event) => setSplit(Number(event.target.value))}
          />
          降噪结果
        </label>
      ) : null}
    </div>
  );
}

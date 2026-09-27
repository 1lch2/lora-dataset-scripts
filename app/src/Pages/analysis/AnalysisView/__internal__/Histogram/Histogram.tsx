import { fmt, pct } from '../../../utils';
import type { HistogramProps } from './types';

export function Histogram({ values, edges, fraction = false, id }: HistogramProps) {
  const max = Math.max(...values, 0.0001);
  return (
    <div
      id={id}
      className='histogram'
      role='img'
      aria-label={values
        .map((v, i) => `${fmt(edges[i])}至${fmt(edges[i + 1])}：${fraction ? pct(v) : v}`)
        .join('；')}
    >
      {values.map((value, i) => {
        const title = `${fmt(edges[i])}–${fmt(edges[i + 1])}：${fraction ? pct(value) : value + ' 张'}`;
        return (
          <div
            key={i}
            className='histogramBar'
            style={{ height: `${(100 * value) / max}%` }}
            title={title}
            aria-label={title}
          />
        );
      })}
    </div>
  );
}

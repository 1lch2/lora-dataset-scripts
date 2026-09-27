import { METRIC_LABELS, fmt } from '../../../utils';
import { Histogram } from '../Histogram';
import type { MetricsProps } from './types';

export function Metrics({ report, baseline }: MetricsProps) {
  return (
    <div id='analysisMetrics' className='analysisMetrics'>
      {Object.entries(METRIC_LABELS).map(([key, label]) => {
        const metric = report.summary[key],
          other = baseline?.summary[key];
        return (
          <article className='metricCard' key={key}>
            <h3>{label}</h3>
            {metric?.count ? (
              <>
                <strong>{fmt(metric.mean)}</strong>
                <p className='hint'>{`中位 ${fmt(metric.median)} · P05–P95 ${fmt(metric.p05)}–${fmt(metric.p95)} · n=${metric.count}`}</p>
                <Histogram values={metric.histogram} edges={metric.edges} />
              </>
            ) : (
              <p className='hint'>未统计 / 无有效样本</p>
            )}
            {other?.count && metric?.count ? (
              <p>{`对照均值 ${fmt(other.mean)} · 差值 ${fmt(metric.mean - other.mean)}`}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

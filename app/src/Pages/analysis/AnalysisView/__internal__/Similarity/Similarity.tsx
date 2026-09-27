import { fmt, ratio } from '../../../utils';
import type { SimilarityProps } from './types';

interface PairsProps {
  title: string;
  rows: string[];
  count: number;
}
function Pairs({ title, rows, count }: PairsProps) {
  return (
    <details>
      <summary>{`${title} · ${count} ${rows.length < count ? '（仅展示前 ' + rows.length + ' 项）' : ''}`}</summary>
      <ul>
        {rows.map((row, i) => (
          <li key={i}>{row}</li>
        ))}
      </ul>
    </details>
  );
}
export function Similarity({ report }: SimilarityProps) {
  const d = report.duplicates,
    p = report.pose;
  return (
    <section className='analysisSection'>
      <h3>重复与姿势多样性</h3>
      <p id='analysisSimilarity'>
        {`字节完全重复：${d.exact_groups.length} 组，多余副本 ${d.exact_extra} 张。近似比较样本 ${d.sampled}/${d.population} 张，${d.compared_pairs} 对；命中 ${d.near_count} 对、涉及 ${d.near_members} 张。${d.flat_excluded} 张低对比图不作近似判断。\n` +
          (p.enabled
            ? `姿势：尝试 ${p.attempted} 张，检测到人物 ${p.detected} 张，可比较姿势 ${p.usable} 张（占成功图片 ${ratio(p.usable, report.successful)}）；抽样姿势 ${p.sampled} 张，有效比较 ${p.comparable_pairs} 对，重合 ${p.similar_pairs} 对（${ratio(p.similar_pairs, p.comparable_pairs)}），涉及 ${p.similar_images} 张。${p.error ? '检测已中断：' + p.error : ''}`
            : '人物/姿势分析未启用。')}
      </p>
      <p className='hint'>
        近似重复是候选，不等于内容相同；纯色/低对比度图不参与近似判断。姿势只比较每图最大人物的身体关节，消除平移和尺度，保留朝向；遮挡、特写、多人和动漫结构可能导致漏检。人物框含背景，不是分割掩膜。
      </p>
      <div id='analysisPairs'>
        <Pairs
          title='完全重复组'
          rows={d.exact_groups.slice(0, 200).map((r) => r.join(' ↔ '))}
          count={d.exact_groups.length}
        />
        <Pairs
          title='近似图片候选'
          rows={d.near_pairs.map((r) => `${r.a} ↔ ${r.b} · 距离 ${r.distance}`)}
          count={d.near_count}
        />
        <Pairs
          title='相似姿势候选'
          rows={p.pairs.map((r) => `${r.a} ↔ ${r.b} · 距离 ${fmt(r.distance)}`)}
          count={p.similar_pairs}
        />
      </div>
    </section>
  );
}

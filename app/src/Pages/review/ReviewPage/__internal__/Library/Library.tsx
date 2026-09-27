import { useReviewContext } from '../../../context';
import { useEffect, useRef } from 'react';
import { DatasetFilters } from '../DatasetFilters';

export function Library() {
  const v = useReviewContext();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (v.reviewAdvance) ref.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [v.reviewAdvance]);
  return (
    <aside ref={ref} className='libraryPanel' aria-label='图片筛选和列表'>
      {v.stage !== 'tag' ? <DatasetFilters /> : null}

      <section id='cropLibrary' className='sourcePanel' hidden={v.stage === 'tag'}>
        <div className='sourceHeading'>
          <strong>图片列表</strong>
          <span id='sourceProgress'>{`${v.tags.filteredSources.filter((s) => !s.error && !s.candidates.some((c) => c.status === 'pending')).length} / ${v.tags.filteredSources.length} 张已完成`}</span>
        </div>
        <div id='sources' aria-label='源图片'>
          {v.tags.filteredSources.map((s) => {
            const pending = s.candidates.filter((c) => c.status === 'pending').length;
            return (
              <button
                key={s.id}
                className={s.id === v.source?.id ? 'active' : ''}
                disabled={v.busy}
                onClick={() => {
                  v.setSourceId(s.id);
                  v.restoreDraft(s);
                }}
              >
                <span>{s.relative}</span>
                <span className={`sourceMeta${!pending && !s.error ? ' complete' : ''}`}>
                  {s.error
                    ? '处理失败'
                    : `${pending ? `待审 ${pending} 个裁框` : '✓ 裁切已完成'} · ${s.scale}×`}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

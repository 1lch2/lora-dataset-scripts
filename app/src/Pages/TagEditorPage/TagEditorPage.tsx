import { useReviewContext } from '../../review/context';
import { handleTabKeys } from '../../review/utils';
import { DatasetFilters } from '../../components/DatasetFilters';
import { TagFilters } from './__internal__/TagFilters';
import { BatchEditor } from './__internal__/BatchEditor';
import { SingleEditor } from './__internal__/SingleEditor';
import { ImageFilter } from './__internal__/ImageFilter';
import { TagCards } from './__internal__/TagCards';

export function TagEditorPage() {
  const v = useReviewContext();
  return (
    <main id='tagView' role='tabpanel' aria-labelledby='tagTab'>
      <section className='tagGallery' aria-label='标签样本'>
        <div className='galleryHeading'>
          <strong id='visibleCount'>{`${v.tags.visibleTags.length} 份样本`}</strong>
          <div className='toolbar'>
            <button id='selectVisible' disabled={v.busy} onClick={() => v.handleAction('selectVisible')}>
              选择筛选结果
            </button>
            <button id='clearSelection' disabled={v.busy} onClick={() => v.handleAction('clearSelection')}>
              清空选择
            </button>
          </div>
        </div>
        <div id='tagDatasetFilters'>
          <DatasetFilters
            search={v.fields.search}
            onSearchChange={(value) => v.handleField('search', value)}
          />
        </div>
        <TagCards />
      </section>
      <aside className='tagTools' aria-label='批量标签编辑'>
        <div className='tagToolTabs' role='tablist' aria-label='标签工具' onKeyDown={handleTabKeys}>
          <button
            id='filterToolTab'
            role='tab'
            aria-controls='filterToolPanel'
            aria-selected={v.tool === 'filter'}
            className={v.tool === 'filter' ? 'active' : ''}
            disabled={v.busy}
            onClick={() => v.setTool('filter')}
            tabIndex={v.tool === 'filter' ? 0 : -1}
          >
            标签筛选
          </button>
          <button
            id='selectionToolTab'
            role='tab'
            aria-controls='selectionToolPanel'
            aria-selected={v.tool === 'selection'}
            tabIndex={v.tool === 'selection' ? 0 : -1}
            disabled={v.busy}
            onClick={() => v.setTool('selection')}
            className={v.tool === 'selection' ? 'active' : ''}
          >
            {v.tags.imageFilter === null ? '图片过滤' : `图片过滤 (${v.tags.filterCount})`}
          </button>
          <button
            id='batchToolTab'
            role='tab'
            aria-controls='batchToolPanel'
            aria-selected={v.tool === 'batch'}
            tabIndex={v.tool === 'batch' ? 0 : -1}
            disabled={v.busy}
            onClick={() => v.setTool('batch')}
            className={v.tool === 'batch' ? 'active' : ''}
          >
            批量编辑
          </button>
          <button
            id='singleToolTab'
            role='tab'
            aria-controls='singleToolPanel'
            aria-selected={v.tool === 'single'}
            tabIndex={v.tool === 'single' ? 0 : -1}
            disabled={v.busy}
            onClick={() => v.setTool('single')}
            className={v.tool === 'single' ? 'active' : ''}
          >
            单图编辑
          </button>
        </div>
        <div
          id='filterToolPanel'
          role='tabpanel'
          aria-labelledby='filterToolTab'
          className='panelScroll'
          hidden={v.tool !== 'filter'}
        >
          <TagFilters />
        </div>
        <ImageFilter />
        <BatchEditor />
        <SingleEditor />
      </aside>
    </main>
  );
}

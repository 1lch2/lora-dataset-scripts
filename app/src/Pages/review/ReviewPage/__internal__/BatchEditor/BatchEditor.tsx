import { useReviewContext } from '../../../context';
import { handleTabKeys } from '../../../utils';
import { TagChoices } from '../TagChoices';

export function BatchEditor() {
  const v = useReviewContext();
  return (
    <div
      id='batchToolPanel'
      role='tabpanel'
      aria-labelledby='batchToolTab'
      className='panelScroll'
      hidden={v.tool !== 'batch'}
    >
      <div className='batchScope'>
        <label>
          操作范围
          <select
            id='editScope'
            value={v.fields.editScope}
            onChange={(event) => v.handleField('editScope', event.target.value)}
          >
            <option value='filtered'>当前筛选结果</option>
            <option value='selected'>勾选的图片</option>
          </select>
        </label>
        <strong id='selectedCount'>{`目标 ${v.tags.targets.length} 张`}</strong>
      </div>
      <p id='selectionHint' className='hint'>
        {v.tags.targets.length
          ? `将应用到${v.fields.editScope === 'filtered' ? '当前筛选中可编辑的' : '勾选的'} ${v.tags.targets.length} 张图片${v.tags.outside ? `，其中 ${v.tags.outside} 张不在当前筛选中` : ''}。`
          : '没有可编辑目标。请勾选图片或切换操作范围；过期标签须重新打标。'}
      </p>
      <div className='batchDedupe'>
        <button
          id='dedupeTags'
          className='primary'
          disabled={v.processing || !v.tags.targets.length}
          onClick={() => v.handleAction('dedupeTags')}
        >
          移除操作范围内图片的重复标签
        </button>
      </div>
      <div
        id='batchTabs'
        className='compactActions'
        role='tablist'
        aria-label='批量操作'
        onKeyDown={handleTabKeys}
      >
        <button
          role='tab'
          data-operation='add'
          aria-selected={v.mode === 'add'}
          disabled={v.busy}
          onClick={() => v.setField('tagOperation', 'add')}
          tabIndex={v.mode === 'add' ? 0 : -1}
          className={v.mode === 'add' ? 'active' : ''}
        >
          添加
        </button>
        <button
          role='tab'
          data-operation='match'
          aria-selected={v.mode === 'match'}
          tabIndex={v.mode === 'match' ? 0 : -1}
          disabled={v.busy}
          onClick={() => v.setField('tagOperation', 'match')}
          className={v.mode === 'match' ? 'active' : ''}
        >
          搜索替换
        </button>
        <button
          role='tab'
          data-operation='remove'
          aria-selected={v.mode === 'remove'}
          tabIndex={v.mode === 'remove' ? 0 : -1}
          disabled={v.busy}
          onClick={() => v.setField('tagOperation', 'remove')}
          className={v.mode === 'remove' ? 'active' : ''}
        >
          批量删除
        </button>
        <button
          role='tab'
          data-operation='sort'
          aria-selected={v.mode === 'sort'}
          tabIndex={v.mode === 'sort' ? 0 : -1}
          disabled={v.busy}
          onClick={() => v.setField('tagOperation', 'sort')}
          className={v.mode === 'sort' ? 'active' : ''}
        >
          排序
        </button>
      </div>
      <label hidden={true}>
        操作
        <select
          id='tagOperation'
          value={v.fields.tagOperation}
          onChange={(event) => v.handleField('tagOperation', event.target.value)}
        >
          <option value='add'>添加标签／触发词</option>
          <option value='remove'>删除标签</option>
          <option value='replace'>替换标签</option>
          <option value='match'>匹配替换／删除</option>
          <option value='sort'>重排图片内标签</option>
        </select>
      </label>
      <label id='tagInputGroup' hidden={!['add', 'remove'].includes(v.mode)}>
        <span id='tagInputLabel'>{v.mode === 'remove' ? '待删除标签' : '添加标签／触发词'}</span>
        <textarea
          id='editTags'
          name='editTags'
          rows={2}
          placeholder='例如 white shirt, blue skirt…'
          autoComplete='off'
          spellCheck='false'
          value={v.fields.editTags}
          onChange={(event) => v.handleField('editTags', event.target.value)}
        ></textarea>
      </label>
      <div id='replaceInputs' hidden={v.mode !== 'replace'}>
        <label>
          原标签
          <input
            id='oldTag'
            name='oldTag'
            autoComplete='off'
            spellCheck='false'
            value={v.fields.oldTag}
            onChange={(event) => v.handleField('oldTag', event.target.value)}
          />
        </label>
        <label>
          新标签
          <input
            id='newTag'
            name='newTag'
            autoComplete='off'
            spellCheck='false'
            value={v.fields.newTag}
            onChange={(event) => v.handleField('newTag', event.target.value)}
          />
        </label>
      </div>
      <label id='prependGroup' className='checkLabel' hidden={v.mode !== 'add'}>
        <input
          id='prependTags'
          type='checkbox'
          checked={v.checks.prependTags}
          onChange={(event) => {
            const checked = event.target.checked;
            v.setChecks((previous) => ({ ...previous, prependTags: checked }));
          }}
        />
        添加到最前面
      </label>
      <div id='matchInputs' hidden={v.mode !== 'match'}>
        <label>
          原标签／查找文本
          <input
            id='matchSearch'
            autoComplete='off'
            spellCheck='false'
            value={v.fields.matchSearch}
            onChange={(event) => v.handleField('matchSearch', event.target.value)}
          />
        </label>
        <label>
          编辑标签／替换为
          <input
            id='matchReplacement'
            placeholder='留空则删除命中的整个标签'
            autoComplete='off'
            spellCheck='false'
            value={v.fields.matchReplacement}
            onChange={(event) => v.handleField('matchReplacement', event.target.value)}
          />
        </label>
        <div className='fieldRow'>
          <label>
            匹配方式
            <select
              id='matchMode'
              value={v.fields.matchMode}
              onChange={(event) => v.handleField('matchMode', event.target.value)}
            >
              <option value='exact'>完整标签</option>
              <option value='contains'>包含文本</option>
              <option value='prefix'>前缀</option>
              <option value='suffix'>后缀</option>
              <option value='regex'>正则表达式</option>
            </select>
          </label>
          <label id='matchCaseGroup' className='checkLabel'>
            <input
              id='matchCase'
              type='checkbox'
              checked={v.checks.matchCase}
              onChange={(event) => {
                const checked = event.target.checked;
                v.setChecks((previous) => ({ ...previous, matchCase: checked }));
              }}
            />
            区分大小写
          </label>
        </div>
        <p className='hint'>替换匹配文本；留空删除命中的标签。正则支持 \g&lt;1&gt;，逗号生成多个标签。</p>
      </div>
      <div id='sortInputs' className='fieldRow' hidden={v.mode !== 'sort'}>
        <label>
          排序依据
          <select
            id='captionSort'
            value={v.fields.captionSort}
            onChange={(event) => v.handleField('captionSort', event.target.value)}
          >
            <option value='alpha'>字母顺序</option>
            <option value='frequency'>操作范围内的出现频率</option>
          </select>
        </label>
        <label>
          顺序
          <select
            id='captionOrder'
            value={v.fields.captionOrder}
            onChange={(event) => v.handleField('captionOrder', event.target.value)}
          >
            <option value='asc'>升序</option>
            <option value='desc'>降序</option>
          </select>
        </label>
      </div>
      <div className='batchApply'>
        <button
          id='previewTags'
          disabled={v.applyDisabled || v.previewPending}
          onClick={() => v.handleAction('previewTags')}
        >
          预览修改
        </button>
        <button
          id='applyTags'
          data-mode={v.mode}
          className='primary'
          disabled={v.applyDisabled}
          onClick={() => v.handleAction('applyTags')}
        >
          {
            (
              {
                add: '应用添加',
                remove: '删除操作范围内选中的标签',
                replace: '应用替换',
                match: '应用搜索替换',
                sort: '应用标签排序',
              } as Record<string, string>
            )[v.mode]
          }
        </button>
      </div>
      <div id='batchPreview' hidden={!v.preview} aria-live='polite'>
        {v.preview ? (
          <>
            <strong>{`${v.preview.total} 张目标中，${v.preview.changed} 张将改变（尚未保存）`}</strong>
            {v.preview.examples.map((row, i) => (
              <details key={i}>
                <summary>{row.name}</summary>
                <p>修改前：{row.before.join(', ')}</p>
                <p>修改后：{row.after.join(', ')}</p>
              </details>
            ))}
          </>
        ) : null}
      </div>
      <section className='batchTagPicker' aria-label='标签列表与图片筛选'>
        <h3>标签列表与图片筛选</h3>
        <p id='batchTagHint' className='hint'>
          {v.mode === 'remove'
            ? '点击标签筛选左侧图片；点击 − 选择待删除标签。'
            : '点击标签筛选左侧图片；点击 − 排除包含该标签的图片。'}
        </p>
        <p id='commonTags' className='hint'>{`共同标签：${v.tags.commonTags}`}</p>
        <div className='fieldRow'>
          <label>
            搜索标签
            <input
              id='frequencySearch'
              type='search'
              placeholder='筛选可选标签'
              value={v.fields.frequencySearch}
              onChange={(event) => v.handleField('frequencySearch', event.target.value)}
            />
          </label>
          <label>
            匹配
            <select
              id='frequencySearchMode'
              value={v.fields.frequencySearchMode}
              onChange={(event) => v.handleField('frequencySearchMode', event.target.value)}
            >
              <option value='contains'>包含</option>
              <option value='prefix'>前缀</option>
              <option value='suffix'>后缀</option>
              <option value='exact'>完整</option>
              <option value='regex'>正则</option>
            </select>
          </label>
        </div>
        <div className='fieldRow'>
          <label>
            排序
            <select
              id='frequencySort'
              value={v.fields.frequencySort}
              onChange={(event) => v.handleField('frequencySort', event.target.value)}
            >
              <option value='alpha'>字母顺序</option>
              <option value='frequency'>出现频率</option>
              <option value='length'>标签长度</option>
            </select>
          </label>
          <label>
            顺序
            <select
              id='frequencyOrder'
              value={v.fields.frequencyOrder}
              onChange={(event) => v.handleField('frequencyOrder', event.target.value)}
            >
              <option value='asc'>升序</option>
              <option value='desc'>降序</option>
            </select>
          </label>
        </div>
        <p id='frequencySearchError' className='error' role='status'>
          {v.tags.frequencyError}
        </p>
        <div id='removeSelectionActions' className='compactActions' hidden={v.mode !== 'remove'}>
          <button
            id='chooseRemovalTags'
            disabled={v.busy}
            onClick={() => v.handleAction('chooseRemovalTags')}
          >
            选择显示标签
          </button>
          <button id='clearRemovalTags' disabled={v.busy} onClick={() => v.handleAction('clearRemovalTags')}>
            清空待删除标签
          </button>
        </div>
        <div id='frequencies'>
          <TagChoices frequency />
        </div>
      </section>
      <details>
        <summary>恢复与导出清理</summary>
        <p className='hint'>恢复会撤销选中图片的人工标签修改及构图自动删除。</p>
        <button
          data-mode='restore'
          disabled={v.processing || !v.tags.targets.length}
          onClick={() => v.handleAction('restore')}
        >
          恢复原始打标
        </button>
        <label>
          导出时额外删除
          <textarea
            id='dropTags'
            name='dropTags'
            rows={3}
            placeholder='服装变体名称，精确匹配…'
            spellCheck='false'
            value={v.fields.dropTags}
            onChange={(event) => v.handleField('dropTags', event.target.value)}
          ></textarea>
        </label>
        <button id='saveDrop' disabled={v.processing} onClick={() => v.handleAction('saveDrop')}>
          保存清理列表
        </button>
      </details>
    </div>
  );
}

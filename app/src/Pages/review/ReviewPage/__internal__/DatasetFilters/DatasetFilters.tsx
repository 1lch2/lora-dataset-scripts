import { useReviewContext } from '../../../context';

export function DatasetFilters() {
  const v = useReviewContext();
  return (
    <div className='filters'>
      <label>
        身份
        <select
          id='group'
          name='group'
          value={v.fields.group}
          onChange={(event) => v.handleField('group', event.target.value)}
        >
          <option value=''>全部</option>
          {[...new Set(v.sources.map((s) => s.group))].sort().map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label>
        文件名
        <input
          id='search'
          name='search'
          type='search'
          placeholder='搜索图片…'
          autoComplete='off'
          value={v.fields.search}
          onChange={(event) => v.handleField('search', event.target.value)}
        />
      </label>
    </div>
  );
}

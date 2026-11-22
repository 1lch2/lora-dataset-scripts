import type { DatasetFiltersProps } from './types';

export function DatasetFilters({ search, onSearchChange }: DatasetFiltersProps) {
  return (
    <div className='filters'>
      <label>
        文件名
        <input
          id='search'
          name='search'
          type='search'
          placeholder='搜索图片…'
          autoComplete='off'
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
    </div>
  );
}

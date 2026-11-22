import { useState } from 'react';
import { AnalysisPage } from './AnalysisPage';
import { DenoisePage } from './DenoisePage';
import { BatchProcessingPage } from './BatchProcessingPage';
import { useReviewContext } from '../../review/context';
import { handleTabKeys } from '../../review/utils';
import type { DatasetToolSection, DatasetToolsPageProps } from './types';
import styles from './styles.module.css';

const SECTIONS = [
  { section: 'processing', title: '批量处理', tab: 'processingTab', panel: 'processingView' },
  { section: 'analysis', title: '数据集分析', tab: 'analysisTab', panel: 'analysisView' },
  { section: 'denoise', title: '图像降噪', tab: 'denoiseTab', panel: 'denoiseView' },
] as const;

export function DatasetToolsPage({ initialSection }: DatasetToolsPageProps) {
  const v = useReviewContext();
  const [section, setSection] = useState<DatasetToolSection>(initialSection);
  const active = v.stage === 'tools';
  const activeSection = active ? section : undefined;
  const token = v.session.token;

  return (
    <main id='toolsView' className={styles.page} role='tabpanel' aria-labelledby='toolsTab' hidden={!active}>
      <nav
        className={styles.navigation}
        role='tablist'
        aria-label='数据集工具导航'
        aria-orientation='vertical'
        onKeyDown={handleTabKeys}
      >
        {SECTIONS.map(({ section: item, title, tab, panel }) => {
          const selected = item === section;
          return (
            <button
              key={item}
              type='button'
              id={tab}
              role='tab'
              aria-controls={panel}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={item === 'denoise' && v.session.analysisOnly}
              onClick={() => setSection(item)}
            >
              {title}
            </button>
          );
        })}
      </nav>
      <div className={styles.content}>
        <BatchProcessingPage
          token={token}
          active={activeSection === 'processing'}
          currentDirectory={v.state?.datasetLoaded ? v.state.config.input_dir : undefined}
        />
        <AnalysisPage token={token} active={activeSection === 'analysis'} />
        <DenoisePage token={token} active={activeSection === 'denoise'} processing={v.processing} />
      </div>
    </main>
  );
}

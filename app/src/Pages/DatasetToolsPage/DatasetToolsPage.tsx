import { useState } from 'react';
import { SideTabLayout } from '../../components/SideTabLayout';
import { AnalysisPage } from './AnalysisPage';
import { DenoisePage } from './DenoisePage';
import { ScunetPage } from './ScunetPage';
import { BatchProcessingPage } from './BatchProcessingPage';
import { useReviewContext } from '../../review/context';
import type { DatasetToolSection, DatasetToolsPageProps } from './types';

const SECTIONS = [
  { section: 'processing', title: '批量处理', tab: 'processingTab', panel: 'processingView' },
  { section: 'analysis', title: '数据集分析', tab: 'analysisTab', panel: 'analysisView' },
  { section: 'scunet', title: '图像降噪', tab: 'scunetTab', panel: 'scunetView' },
  { section: 'denoise', title: '去除GPT水印（实验性）', tab: 'denoiseTab', panel: 'denoiseView' },
] as const;

export function DatasetToolsPage({ initialSection }: DatasetToolsPageProps) {
  const v = useReviewContext();
  const [section, setSection] = useState<DatasetToolSection>(initialSection);
  const active = v.stage === 'tools';
  const activeSection = active ? section : undefined;
  const token = v.session.token;
  const tabs = SECTIONS.map((tab) => ({
    ...tab,
    disabled: (tab.section === 'scunet' || tab.section === 'denoise') && v.session.analysisOnly,
  }));

  return (
    <SideTabLayout
      id='toolsView'
      labelledBy='toolsTab'
      navigationLabel='数据集工具导航'
      hidden={!active}
      tabs={tabs}
      selected={section}
      onSelect={setSection}
    >
      <BatchProcessingPage
        token={token}
        active={activeSection === 'processing'}
        currentDirectory={v.state?.datasetLoaded ? v.state.config.input_dir : undefined}
      />
      <AnalysisPage token={token} active={activeSection === 'analysis'} />
      <ScunetPage token={token} active={activeSection === 'scunet'} processing={v.processing} />
      <DenoisePage token={token} active={activeSection === 'denoise'} processing={v.processing} />
    </SideTabLayout>
  );
}

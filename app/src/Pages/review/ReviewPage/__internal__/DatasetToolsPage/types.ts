export type DatasetToolSection = 'processing' | 'analysis' | 'denoise';

export interface DatasetToolsPageProps {
  initialSection: DatasetToolSection;
}

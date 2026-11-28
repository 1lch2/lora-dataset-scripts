export type DatasetToolSection = 'processing' | 'analysis' | 'scunet' | 'scunetSettings' | 'denoise';

export interface DatasetToolsPageProps {
  initialSection: DatasetToolSection;
}

export interface SelectedImage {
  file: File;
  url: string;
  width: number;
  height: number;
}

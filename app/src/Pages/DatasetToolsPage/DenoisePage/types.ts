export interface DenoisePageProps {
  active: boolean;
  token: string;
  processing: boolean;
}

export interface DenoiseOptions {
  scale: number;
  strength: number;
  l0: boolean;
  model: string;
}

export interface DenoiseInfo {
  id?: string;
  status: 'idle' | 'running' | 'complete' | 'failed';
  stage: string;
  errors: string[];
  defaultModel: string;
  models: { name: string; scale: number | null }[];
  result: { id: string; width: number; height: number; name: string } | null;
}

export interface SelectedImage {
  file: File;
  url: string;
  width: number;
  height: number;
}

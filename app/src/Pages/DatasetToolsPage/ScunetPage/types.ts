export interface ScunetPageProps {
  active: boolean;
  token: string;
  processing: boolean;
}

export type ScunetRequest =
  { mode: 'single'; file: File } | { mode: 'batch'; inputDir: string; outputDir: string };

export interface ScunetInfo {
  id?: string;
  status: 'idle' | 'running' | 'complete' | 'failed';
  stage: '' | 'scan' | 'connect' | 'process';
  errors: string[];
  result: { id: string; width: number; height: number; name: string } | null;
  output: string | null;
  done: number;
  total: number;
  saved: number;
}

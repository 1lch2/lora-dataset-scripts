export interface DatasetToolsProps {
  active: boolean;
  token: string;
  currentDirectory?: string;
}
export interface ToolsRequest {
  directory: string;
  output: string;
  paths: string[];
  operation: 'resize' | 'reverse' | 'deduplicate';
  length: number;
  threshold: number;
  duplicateMode: 'separate' | 'omit';
}
export interface ToolsScan {
  directory: string;
  files: { path: string; bytes: number }[];
}
export interface ToolsStatus {
  id?: string;
  status: 'idle' | 'preparing' | 'ready' | 'running' | 'complete' | 'failed' | 'cancelled';
  done: number;
  total: number;
  output?: string;
  errors: string[];
  entries: {
    path: string;
    size: number[];
    resultSize: number[];
    destination: string | null;
    duplicate: boolean;
  }[];
  groups: { keep: string; duplicates: string[] }[];
}

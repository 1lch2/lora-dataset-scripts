export interface SettingsValues {
  forge_dir: string;
  forge_url: string;
  upscaler_1: string;
  upscaler_2: string;
  blend: number;
  tag_threshold: number;
  target_area: number;
  min_area: number;
  duplicate_iou: number;
  copyright: string;
  drop_tags: string[];
}

export interface SettingsInfo {
  values: SettingsValues;
  configured: boolean;
  taggerRepository: string;
  taggerModel: string;
  tagsCsv: string;
}

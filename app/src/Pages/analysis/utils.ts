export const METRIC_LABELS: Record<string, string> = {
  brightness: '平均亮度',
  linear_luminance: '线性亮度',
  contrast: '对比度（亮度标准差）',
  highlights: '高光端占比 ≥98%',
  shadows: '暗部占比 ≤2%',
  channel_clip: '任一通道 ≥250/255',
  saturation: '平均饱和度',
  red_blue_bias: '红减蓝（色偏线索）',
  detail: '细节强度（相邻差分）',
  megapixels: '图片面积 / MP',
  aspect: '宽高比',
  center_brightness: '中心区域亮度',
  border_brightness: '外围区域亮度',
  person_area: '最大人物框面积占比',
  person_brightness: '最大人物框内亮度',
};
export const fmt = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
export const pct = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : '—';
export const ratio = (n: number, d: number) => (d ? pct(n / d) : '—');
export function download(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

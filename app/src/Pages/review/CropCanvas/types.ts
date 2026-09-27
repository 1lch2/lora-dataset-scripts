import type { Box } from '../../../api/types';
export interface CropCanvasProps {
  image: string;
  box: Box | null;
  disabled: boolean;
  visible: boolean;
  onChange: (box: Box | null) => void;
}

export interface CropDrag {
  p: number[];
  before: Box | null;
  mode: string;
  corner: number;
}

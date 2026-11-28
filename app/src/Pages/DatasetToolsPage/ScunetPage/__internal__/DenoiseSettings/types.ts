import type { ScunetSettingsValues } from '../../types';

export interface DenoiseSettingsProps {
  active: boolean;
  values: ScunetSettingsValues;
  onChange: (values: ScunetSettingsValues) => void;
}

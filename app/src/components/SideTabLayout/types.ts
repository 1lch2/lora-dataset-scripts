import type { ReactNode } from 'react';

interface SideTab<Section extends string> {
  section: Section;
  title: string;
  tab: string;
  panel: string;
  disabled?: boolean;
}

export interface SideTabLayoutProps<Section extends string> {
  id: string;
  labelledBy: string;
  navigationLabel: string;
  hidden?: boolean;
  tabs: readonly SideTab<Section>[];
  selected: Section;
  onSelect: (section: Section) => void;
  children: ReactNode;
}

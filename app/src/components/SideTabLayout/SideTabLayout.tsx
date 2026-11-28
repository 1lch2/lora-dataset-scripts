import { handleTabKeys } from '../../review/utils';
import type { SideTabLayoutProps } from './types';
import styles from './styles.module.css';

export function SideTabLayout<Section extends string>({
  id,
  labelledBy,
  navigationLabel,
  hidden,
  tabs,
  selected,
  onSelect,
  children,
}: SideTabLayoutProps<Section>) {
  return (
    <main id={id} className={styles.page} role='tabpanel' aria-labelledby={labelledBy} hidden={hidden}>
      <nav
        className={styles.navigation}
        role='tablist'
        aria-label={navigationLabel}
        aria-orientation='vertical'
        onKeyDown={handleTabKeys}
      >
        {tabs.map(({ section, title, tab, panel, disabled }) => (
          <button
            key={section}
            type='button'
            id={tab}
            role='tab'
            aria-controls={panel}
            aria-selected={section === selected}
            tabIndex={section === selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onSelect(section)}
          >
            {title}
          </button>
        ))}
      </nav>
      <div className={styles.content}>{children}</div>
    </main>
  );
}

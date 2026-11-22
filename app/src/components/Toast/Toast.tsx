import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import type { ToastProps, ToastVariant } from './types';
import styles from './styles.module.css';

const TOAST_DURATION_MS = 6000;
const VARIANTS = {
  info: {
    card: 'border-review-toast-info/30 bg-review-toast-info-bg',
    icon: 'text-review-toast-info',
    symbol: 'i',
  },
  error: {
    card: 'border-review-toast-error/30 bg-review-toast-error-bg',
    icon: 'text-review-toast-error',
    symbol: '!',
  },
  success: {
    card: 'border-review-toast-success/30 bg-review-toast-success-bg',
    icon: 'text-review-toast-success',
    symbol: '✓',
  },
} satisfies Record<ToastVariant, Record<'card' | 'icon' | 'symbol', string>>;

interface AnnouncementDocument extends Document {
  ariaNotify?: (message: string, options?: { priority: 'normal' | 'high' }) => void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState<typeof message>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const announcer = typeof document === 'undefined' ? undefined : (document as AnnouncementDocument);
  const nativeAnnouncement = typeof announcer?.ariaNotify === 'function';
  const nativePopover =
    typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

  useEffect(() => {
    if (!message) {
      setVisible(null);
      setFocused(false);
      setHovered(false);
      return;
    }
    function reveal() {
      if (!document.querySelector('dialog[open]')) setVisible(message);
    }
    reveal();
    document.addEventListener('close', reveal, true);
    return () => document.removeEventListener('close', reveal, true);
  }, [message]);

  useEffect(() => {
    const element = panel.current!;
    if (typeof element.showPopover === 'function') {
      if (visible && !element.matches(':popover-open')) element.showPopover();
      if (!visible && element.matches(':popover-open')) element.hidePopover();
    }
    if (visible)
      announcer?.ariaNotify?.(visible.text, { priority: visible.variant === 'error' ? 'high' : 'normal' });
  }, [visible, announcer]);

  useEffect(() => {
    if (!visible || visible.persistent || visible.variant === 'error' || focused || hovered) return;
    const timer = setTimeout(() => onDismiss(visible), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [visible, onDismiss, focused, hovered]);

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    priorFocus.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
    setFocused(true);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }

  function handleDismiss() {
    if (!visible) return;
    if (focused) priorFocus.current?.focus();
    onDismiss(visible);
  }

  const variant = visible && VARIANTS[visible.variant];
  return (
    <>
      <div className='sr-only' role='status'>
        {!nativeAnnouncement && visible?.variant !== 'error' ? visible?.text : null}
      </div>
      <div className='sr-only' role='alert'>
        {!nativeAnnouncement && visible?.variant === 'error' ? visible.text : null}
      </div>
      <div
        id={id}
        ref={panel}
        role='region'
        aria-label='通知'
        popover={nativePopover ? 'manual' : undefined}
        hidden={!visible}
        className={styles.panel}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {visible && variant ? (
          <div
            className={`flex items-center gap-2 rounded-lg border border-solid px-3 py-2 text-review-ink ${variant.card}`}
          >
            <span
              aria-hidden='true'
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border border-solid text-xs font-semibold ${variant.icon}`}
            >
              {variant.symbol}
            </span>
            <p className='max-h-[min(12rem,50vh)] min-w-0 overflow-y-auto [overflow-wrap:anywhere] whitespace-pre-wrap'>
              {visible.text}
            </p>
            <button
              type='button'
              className={styles.dismiss}
              aria-label='关闭通知'
              popoverTarget={id}
              popoverTargetAction='hide'
              onClick={handleDismiss}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

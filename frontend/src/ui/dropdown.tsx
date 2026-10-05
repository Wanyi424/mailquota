import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './controls';

const EDGE = 8;

/**
 * 看起来和下拉框一样的按钮，点开后在下方浮出一块面板。
 * 面板盖在页面上而不是挤进布局里，所以打开、关闭都不会推动别的内容。
 */
export function Dropdown({ label, title, className, children }: { label: ReactNode; title: string; className?: string; children: (close: () => void) => ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // 面板默认与按钮左对齐；靠近视口右边缘时往左挪，保证整块都在屏幕里。
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (!open || !box || !panel.current) return;
    const overflow = box.left + panel.current.offsetWidth - (window.innerWidth - EDGE);
    panel.current.style.left = `${Math.max(EDGE - box.left, Math.min(0, -overflow))}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className={cx('dropdown', className)} ref={root}>
      <button type="button" className="select dropdown__button" aria-haspopup="dialog" aria-expanded={open} title={title} onClick={() => setOpen(value => !value)}>
        {label}
      </button>
      {open ? <div ref={panel} className="dropdown__panel" role="dialog" aria-label={title}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

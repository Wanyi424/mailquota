import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { explainError, initialOf, STATUS } from '../lib/format';
import type { SendStatus } from '../types';
import { Icon, type IconName } from './icon';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type ButtonLook = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  trailingIcon?: IconName;
  block?: boolean;
};

const buttonClass = ({ variant = 'secondary', size = 'md', block }: ButtonLook, extra?: string) =>
  cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', extra);

export function Button({ variant, size, icon, trailingIcon, block, busy = false, className, children, type = 'button', disabled, ...rest }: ButtonLook & { busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={buttonClass({ variant, size, block }, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children ? <span>{children}</span> : null}
      {trailingIcon ? <Icon name={trailingIcon} size={16} /> : null}
    </button>
  );
}

export function ButtonLink({ variant, size, icon, trailingIcon, block, className, children, ...rest }: ButtonLook & LinkProps) {
  return (
    <Link className={buttonClass({ variant, size, block }, className)} viewTransition {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children ? <span>{children as ReactNode}</span> : null}
      {trailingIcon ? <Icon name={trailingIcon} size={16} /> : null}
    </Link>
  );
}

export function IconButton({ icon, label, busy = false, className, type = 'button', disabled, ...rest }: { icon: IconName; label: string; busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cx('btn btn--ghost btn--icon', className)} aria-label={label} title={label} disabled={disabled || busy} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={icon} size={17} />}
    </button>
  );
}

const EDGE = 8;

/**
 * 标签旁的小提示图标：悬停、聚焦或点按时在旁边浮出说明，平时不占版面。
 * 气泡进入浏览器顶层，所以在对话框、抽屉里也不会被裁掉。
 */
export function Tip({ children }: { children: ReactNode }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const hover = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const tip = bubble.current;
    const button = anchor.current;
    if (!open || !tip || !button || typeof tip.showPopover !== 'function') return;
    tip.showPopover();
    const at = button.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const above = at.top - size.height - 8;
    tip.style.left = `${Math.max(EDGE, Math.min(window.innerWidth - size.width - EDGE, at.left + at.width / 2 - size.width / 2))}px`;
    tip.style.top = `${above >= EDGE ? above : at.bottom + 8}px`;

    const close = () => setOpen(false);
    // 触屏上有些浏览器点按钮不给焦点，也就等不到失焦：点到别处时主动收起。
    const outside = (event: PointerEvent) => { if (!button.contains(event.target as Node)) close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', outside);
      if (tip.matches(':popover-open')) tip.hidePopover();
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(hover.current), []);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="tip"
        aria-label="说明"
        aria-describedby={id}
        aria-expanded={open}
        // 鼠标只是路过时不弹，停一下才出现。
        onPointerEnter={event => { if (event.pointerType === 'mouse') hover.current = window.setTimeout(() => setOpen(true), 90); }}
        onPointerLeave={event => { if (event.pointerType === 'mouse') { window.clearTimeout(hover.current); setOpen(false); } }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <Icon name="info" size={14} />
      </button>
      <span ref={bubble} id={id} className="tip__bubble" role="tooltip" popover="manual">{children}</span>
    </>
  );
}

type ControlProps = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

/**
 * 表单字段。说明收在标签旁的提示图标里；校验错误显示在字段下方预留的空隙中，
 * 出现和消失都不会推动后面的内容。输入框外面还包着别的元素时，children 传函数来接收 id。
 */
export function Field({ label, tip, error, row = false, children }: {
  label: string;
  tip?: ReactNode;
  error?: string;
  /** 标签在左、控件在右的一行式布局。 */
  row?: boolean;
  children: ReactElement<Partial<ControlProps>> | ((control: ControlProps) => ReactNode);
}) {
  const id = useId();
  const control: ControlProps = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : undefined };
  return (
    <div className={cx('field', row && 'field--row', Boolean(error) && 'field--invalid')}>
      <div className="field__head">
        <label htmlFor={id}>{label}</label>
        {tip ? <Tip>{tip}</Tip> : null}
      </div>
      <div className="field__body">
        {typeof children === 'function' ? children(control) : cloneElement(children, control)}
        {error ? <p className="field__error" id={`${id}-error`} role="alert" title={error}>{error}</p> : null}
      </div>
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="notice notice--danger" role="alert">
      <Icon name="circle-alert" size={17} />
      <div className="notice__text">{explainError(error)}</div>
    </div>
  );
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // 非 HTTPS 的内网地址没有剪贴板接口，退回到选中文本再复制。
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    (document.querySelector('dialog[open]') ?? document.body).append(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  }
}

export function CopyButton({ value, label, children, variant = 'ghost', size = 'sm', onCopied }: { value: string; label: string; children?: ReactNode; variant?: ButtonLook['variant']; size?: ButtonLook['size']; onCopied?: () => void }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const done = await copyText(value);
    setState(done ? 'done' : 'failed');
    if (done) onCopied?.();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };
  const feedback = state === 'done' ? '已复制' : state === 'failed' ? '复制失败，请手动选中复制' : '';

  return (
    <button type="button" className={cx(buttonClass({ variant, size }), !children && 'btn--icon', state === 'done' && 'is-done')} onClick={() => void copy()} aria-label={children ? undefined : label} title={feedback || label}>
      <Icon name={state === 'done' ? 'check' : state === 'failed' ? 'circle-alert' : 'copy'} size={15} />
      {/* 文字按钮复制后只换图标不换字，按钮宽度保持不变。 */}
      {children ? <span>{children}</span> : null}
      <span className="sr-only" role="status">{feedback}</span>
    </button>
  );
}

export type SegmentOption<T extends string | number> = { value: T; label: ReactNode; icon?: IconName; title?: string };

export function Segmented<T extends string | number>({ value, options, onChange, label, size }: { value: T; options: Array<SegmentOption<T>>; onChange: (value: T) => void; label: string; size?: 'sm' }) {
  return (
    <div className={cx('segmented', size === 'sm' && 'segmented--sm')} role="group" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" className="segmented__item" aria-pressed={option.value === value} title={option.title} onClick={() => onChange(option.value)}>
          {option.icon ? <Icon name={option.icon} size={15} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 开关。label 是给读屏用的完整说法，children 是开关旁边看得见的文字。 */
export function Switch({ checked, onChange, disabled = false, label, children }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label?: string; children: ReactNode }) {
  return (
    <label className={cx('switch', disabled && 'is-disabled')}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={event => onChange(event.target.checked)} />
      <span className="switch__track" aria-hidden="true" />
      <span className="switch__label">{children}</span>
    </label>
  );
}

export function StatusBadge({ status, size }: { status: SendStatus; size?: 'lg' }) {
  const { label, tone } = STATUS[status];
  return <span className={cx('status', `status--${tone}`, size === 'lg' && 'status--lg')}><i className="led" aria-hidden="true" />{label}</span>;
}

export function Avatar({ name, size }: { name: string; size?: 'sm' | 'lg' }) {
  return <span className={cx('avatar', size && `avatar--${size}`)} aria-hidden="true">{initialOf(name)}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Skeleton({ width, height = 16 }: { width?: number | string; height?: number | string }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

/**
 * 面板的标题行：一个标明这块是什么的小图标、标题、可选的提示，右侧放这块内容自己的工具。
 * 所有面板的标题行等高，并排时内容能对齐。
 */
export function PanelHead({ icon, title, tip, children }: { icon?: IconName; title: string; tip?: ReactNode; children?: ReactNode }) {
  return (
    <header className="panel__head">
      {icon ? <Icon name={icon} size={17} /> : null}
      <h2>{title}</h2>
      {tip ? <Tip>{tip}</Tip> : null}
      {children ? <div className="panel__tools">{children}</div> : null}
    </header>
  );
}

export function Notice({ tone = 'info', icon, title, children, action }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; icon?: IconName; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`}>
      {icon ? <Icon name={icon} size={17} /> : null}
      <div className="notice__text">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__icon"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="empty" role="alert">
      <span className="empty__icon empty__icon--danger"><Icon name="triangle-alert" size={22} /></span>
      <h3>没能读取数据</h3>
      <p>{explainError(error)}</p>
      <Button icon="refresh-cw" onClick={onRetry}>重新读取</Button>
    </div>
  );
}

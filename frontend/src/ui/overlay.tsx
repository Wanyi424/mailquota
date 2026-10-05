import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, cx } from './controls';
import { Icon } from './icon';

// 与样式里退场动画的时长保持一致。
const EXIT_MS = 170;
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CloseContext = createContext<() => void>(() => {});

/** 在浮层内部请求关闭：先播放退场动画，再通知外层卸载。 */
export const useClose = () => useContext(CloseContext);

type OverlayProps = {
  kind: 'dialog' | 'drawer' | 'palette';
  label: string;
  onClose: () => void;
  /** 为 false 时不能用 Esc 或点击遮罩关闭，只能由内容里的操作结束。 */
  dismissable?: boolean;
  className?: string;
  children: ReactNode;
};

export function Overlay({ kind, label, onClose, dismissable = true, className, children }: OverlayProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pressedBackdrop = useRef(false);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      if (dialog.open) dialog.close();
    };
  }, []);

  const close = useCallback(() => {
    if (timer.current !== undefined) return;
    setClosing(true);
    timer.current = window.setTimeout(() => latestClose.current(), prefersReducedMotion() ? 0 : EXIT_MS);
  }, []);

  return (
    <dialog
      ref={ref}
      className={cx('overlay', `overlay--${kind}`, className)}
      aria-label={label}
      data-closing={closing || undefined}
      onCancel={event => { event.preventDefault(); if (dismissable) close(); }}
      // 浏览器在连续按 Esc 时会强行关闭对话框，此时直接同步状态。
      // 事件是异步派发的：如果期间对话框又被重新打开（开发模式下副作用会执行两次），就忽略它。
      onClose={() => { if (timer.current === undefined && !ref.current?.open) latestClose.current(); }}
      onMouseDown={event => { pressedBackdrop.current = event.target === ref.current; }}
      onClick={event => { if (dismissable && pressedBackdrop.current && event.target === ref.current) close(); }}
    >
      <CloseContext.Provider value={close}>
        <div className="overlay__panel">{children}</div>
      </CloseContext.Provider>
    </dialog>
  );
}

function CloseButton() {
  const close = useClose();
  return <IconButton icon="x" label="关闭" onClick={close} />;
}

export function Dialog({ title, description, onClose, dismissable = true, size = 'md', children }: { title: string; description?: ReactNode; onClose: () => void; dismissable?: boolean; size?: 'sm' | 'md' | 'lg'; children: ReactNode }) {
  return (
    <Overlay kind="dialog" label={title} onClose={onClose} dismissable={dismissable} className={`overlay--${size}`}>
      <header className="dialog__head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {dismissable ? <CloseButton /> : null}
      </header>
      <div className="dialog__body">{children}</div>
    </Overlay>
  );
}

export function Drawer({ label, onClose, header, children }: { label: string; onClose: () => void; header: ReactNode; children: ReactNode }) {
  return (
    <Overlay kind="drawer" label={label} onClose={onClose}>
      <header className="drawer__head">
        <div className="drawer__title">{header}</div>
        <CloseButton />
      </header>
      <div className="drawer__body">{children}</div>
    </Overlay>
  );
}

/** 浮层底部的「取消」：走带动画的关闭流程。 */
export function CancelButton({ children = '取消' }: { children?: ReactNode }) {
  const close = useClose();
  return <Button onClick={close}>{children}</Button>;
}

type ConfirmOptions = { title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type ConfirmRequest = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmContext);

function ConfirmActions({ request, answer }: { request: ConfirmRequest; answer: { current: boolean } }) {
  const close = useClose();
  return (
    <div className="dialog__actions">
      <Button onClick={close}>{request.cancelLabel ?? '取消'}</Button>
      <Button variant={request.danger ? 'danger' : 'primary'} data-autofocus onClick={() => { answer.current = true; close(); }}>
        {request.confirmLabel ?? '确认'}
      </Button>
    </div>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const answer = useRef(false);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    answer.current = false;
    setRequest({ ...options, resolve });
  }), []);

  const finish = () => {
    request?.resolve(answer.current);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <Dialog title={request.title} size="sm" onClose={finish}>
          {request.body ? <div className="dialog__text">{request.body}</div> : null}
          <ConfirmActions request={request} answer={answer} />
        </Dialog>
      ) : null}
    </ConfirmContext.Provider>
  );
}

type Toast = { id: number; message: string; tone: 'ok' | 'danger' };

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const region = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const raised = useRef(0);

  const show = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = ++nextId.current;
    setToasts(current => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), tone === 'danger' ? 7000 : 4200);
  }, []);

  // 提示区用 popover 进入顶层，模态浮层打开时也不会被遮罩盖住。
  // 顶层按进入顺序堆叠，所以每来一条新提示就重新进入一次。
  useEffect(() => {
    const element = region.current;
    if (!element || typeof element.showPopover !== 'function') return;
    const newest = toasts.at(-1)?.id ?? 0;
    const open = element.matches(':popover-open');
    if (!toasts.length) {
      if (open) element.hidePopover();
    } else if (!open || newest > raised.current) {
      if (open) element.hidePopover();
      element.showPopover();
    }
    raised.current = newest;
  }, [toasts]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div ref={region} className="toasts" popover="manual" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <Icon name={toast.tone === 'ok' ? 'circle-check' : 'circle-alert'} size={17} />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

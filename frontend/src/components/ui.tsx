import { createContext, useCallback, useContext, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { number } from '../helpers';
import { ApiError } from '../api';

const statusLabels: Record<string, string> = { accepted: '已受理', pending: '处理中', unknown: '待确认', failed: '未计费' };

export function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}><span className="status-dot" />{statusLabels[status] || (status === 'enabled' ? '已启用' : '已停用')}</span>;
}

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{help ? <span className="field-help">{help}</span> : null}</label>;
}

export function FormError({ error }: { error?: unknown }) {
  return <div className="form-error" role="alert" hidden={!error}>{error ? explainError(error) : ''}</div>;
}

export function LoadingState() {
  return <div className="loading-state" role="status"><span className="spinner" /><p>正在读取数据…</p></div>;
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return <div className="empty-state"><p>{message}</p>{action}</div>;
}

export function Pagination({ page, total, pageSize = 20, onChange }: { page: number; total: number; pageSize?: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination"><span>共 {number(total)} 条{total ? ` · ${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))}` : ''}</span><div><button className="button small secondary icon-button" aria-label="上一页" title="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}><Icon name="chevron-left" /></button><span>{page} / {pages}</span><button className="button small secondary icon-button" aria-label="下一页" title="下一页" disabled={page >= pages} onClick={() => onChange(page + 1)}><Icon name="chevron-right" /></button></div></div>;
}

export function explainError(error: unknown) {
  const value = error as Partial<ApiError> & { message?: string };
  if (value.code === 'EDIT_CONFLICT') return '配置已在其他页面更新。你的输入仍保留，请重新读取最新配置后确认修改，系统不会自动覆盖。';
  if (value.code === 'STATE_CONFLICT') return '这条记录已经被处理。请关闭窗口并刷新列表查看最新结果。';
  if (value.code === 'CSRF_INVALID') return '登录安全信息已变化，请刷新页面重新验证。未保存的内容请先自行保留。';
  if (value.code === 'ADMIN_AUTH_REQUIRED') return '登录已过期，请重新登录。';
  if (value.retryAfter) return `${value.message} 约 ${Math.max(1, Math.ceil(value.retryAfter / 60))} 分钟后可重试。`;
  return value.message || '操作未完成，请稍后重试。';
}

type Toast = { id: number; message: string; kind: 'success' | 'error' };
type ToastContextValue = { showToast: (message: string, kind?: Toast['kind']) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 5500);
  }, []);
  return <ToastContext.Provider value={{ showToast }}><>{children}</><div className="toasts" role="status" aria-live="polite" aria-atomic="true">{toasts.map(toast => <div className={`toast ${toast.kind}`} key={toast.id}>{toast.message}</div>)}</div></ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value.showToast;
}

type ModalProps = {
  title: string;
  subtitle?: string;
  wide?: boolean;
  secret?: boolean;
  onClose: () => void;
  canClose?: () => boolean | Promise<boolean>;
  children: ReactNode;
};

export function Modal({ title, subtitle, wide = false, secret = false, onClose, canClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`dialog-title-${Math.random().toString(36).slice(2)}`);
  const requestClose = async () => {
    if (secret) return;
    if (canClose && !(await canClose())) return;
    onClose();
  };
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'wide' : ''}`} aria-labelledby={titleId.current} onCancel={event => { event.preventDefault(); void requestClose(); }}><header className="dialog-heading"><div><h2 id={titleId.current}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>{secret ? null : <button type="button" className="button quiet icon-button dialog-x" aria-label="关闭窗口" title="关闭窗口" onClick={() => void requestClose()}><Icon name="x" /></button>}</header><div className="dialog-body">{children}</div></dialog>;
}

type ConfirmRequest = { title: string; description: string; label: string; danger: boolean; resolve: (value: boolean) => void };
const ConfirmContext = createContext<((title: string, description: string, label?: string, danger?: boolean) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback((title: string, description: string, label = '确认', danger = false) => new Promise<boolean>(resolve => setRequest({ title, description, label, danger, resolve })), []);
  const finish = (value: boolean) => { request?.resolve(value); setRequest(null); };
  return <ConfirmContext.Provider value={confirm}>{children}{request ? <Modal title={request.title} subtitle={request.description} secret onClose={() => finish(false)}><div className="dialog-actions"><button className="button secondary" onClick={() => finish(false)}>取消</button><button className={`button ${request.danger ? 'danger' : 'primary'}`} onClick={() => finish(true)}>{request.label}</button></div></Modal> : null}</ConfirmContext.Provider>;
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider');
  return confirm;
}

export function useFormState<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const update = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    setValues(current => ({ ...current, [target.name]: target.value }));
    setError(undefined);
  };
  return { values, setValues, busy, setBusy, error, setError, update };
}

export async function copyText(value: string, showToast: (message: string, kind?: 'success' | 'error') => void, button?: HTMLButtonElement | null) {
  try {
    await navigator.clipboard.writeText(value);
    if (button) {
      const original = button.innerHTML;
      button.innerHTML = '';
      button.append(new Text('已复制'));
      window.setTimeout(() => { button.innerHTML = original; }, 1800);
    }
    showToast('已复制');
  } catch {
    showToast('无法访问剪贴板，请选中文本后手动复制。', 'error');
  }
}

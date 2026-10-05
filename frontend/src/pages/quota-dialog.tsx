import { useState, type FormEvent } from 'react';
import { useAdmin } from '../app/admin';
import { formatNumber, quotaTarget } from '../lib/format';
import { invalidate, setQueryData } from '../lib/query';
import type { Customer } from '../types';
import { Button, Field, FormError, Notice, cx } from '../ui/controls';
import { Icon } from '../ui/icon';
import { CancelButton, Dialog, useClose, useToast } from '../ui/overlay';

const PRESETS = [500, 1000, 5000, 10000];

export function QuotaDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  return (
    <Dialog title="加额度" description={`给「${customer.name}」增加可以发送的封数。`} size="sm" onClose={onClose}>
      <QuotaForm customer={customer} />
    </Dialog>
  );
}

function QuotaForm({ customer: initial }: { customer: Customer }) {
  const { api } = useAdmin();
  const toast = useToast();
  const close = useClose();
  const [customer, setCustomer] = useState(initial);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [refreshed, setRefreshed] = useState(false);

  const increase = Number(amount) || 0;
  let target: number | null = null;
  try {
    target = quotaTarget(customer.quota_total, amount);
  } catch { /* 输入还不完整，保持按钮不可用 */ }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || target === null) return;
    setBusy(true);
    setError(undefined);
    setRefreshed(false);
    try {
      const saved = await api.updateCustomer(customer.customer_id, customer.version, { quota_total: target });
      setQueryData(`customer:${customer.customer_id}`, saved);
      invalidate('customers');
      toast(`已为「${customer.name}」增加 ${formatNumber(increase)} 封额度。`);
      close();
    } catch (failure) {
      if ((failure as { code?: string }).code !== 'EDIT_CONFLICT') {
        setError(failure);
        return;
      }
      // 版本过期时不悄悄重试：读回最新额度，让管理员看着新数字再确认一次。
      try {
        setCustomer(await api.customer(customer.customer_id));
        setRefreshed(true);
      } catch {
        setError(failure);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <FormError error={error} />
      {refreshed ? <Notice tone="warn" icon="info">这位客户的配置刚刚在别处被改过，下面已经换成最新的额度，请再确认一次。</Notice> : null}
      <div className="chips" role="group" aria-label="常用数量">
        {PRESETS.map(preset => (
          <button type="button" key={preset} className={cx('chip', amount === String(preset) && 'is-active')} onClick={() => setAmount(String(preset))}>
            +{formatNumber(preset)}
          </button>
        ))}
      </div>
      <Field label="增加数量（封）" tip="额度永久有效，只增不减。">
        <input className="input input--readout" data-autofocus inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ''))} placeholder="例如 1000" maxLength={16} autoComplete="off" />
      </Field>
      <dl className="diff">
        <div>
          <dt>总额度</dt>
          <dd>{formatNumber(customer.quota_total)}<Icon name="arrow-right" size={14} /><b>{target === null ? '—' : formatNumber(target)}</b></dd>
        </div>
        <div>
          <dt>可用</dt>
          <dd>{formatNumber(customer.available_count)}<Icon name="arrow-right" size={14} /><b>{target === null ? '—' : formatNumber(customer.available_count + increase)}</b></dd>
        </div>
      </dl>
      <div className="dialog__actions">
        <CancelButton />
        {/* 按钮上的字不跟着输入变：结果已经写在上面两行里，按钮宽度保持不动。 */}
        <Button type="submit" variant="primary" busy={busy} disabled={target === null}>确认增加</Button>
      </div>
    </form>
  );
}

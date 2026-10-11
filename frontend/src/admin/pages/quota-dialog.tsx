import { useRef, useState, type FormEvent } from 'react';
import { formatNumber, planQuota } from '../../lib/format';
import { isUnconfirmed } from '../../lib/http';
import { invalidate } from '../../lib/query';
import { uuid } from '../../lib/random';
import type { TenantSummary } from '../../types';
import { Button, Field, FormError, Notice, Segmented, cx } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { CancelButton, Dialog, useClose, useToast } from '../../ui/overlay';
import { useAdmin } from '../context';

const PRESETS = [500, 1000, 5000, 10000];

export function QuotaDialog({ tenant, onClose }: { tenant: TenantSummary; onClose: () => void }) {
  return (
    <Dialog title="调整额度" description={`「${tenant.name}」可以发送的封数。额度永久有效。`} size="sm" onClose={onClose}>
      <QuotaForm tenant={tenant} />
    </Dialog>
  );
}

function QuotaForm({ tenant: initial }: { tenant: TenantSummary }) {
  const { api } = useAdmin();
  const toast = useToast();
  const close = useClose();
  const [tenant, setTenant] = useState(initial);
  const [mode, setMode] = useState<'add' | 'reduce'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [unsure, setUnsure] = useState(false);
  // 幂等编号跟着「这一次想调多少」走：原样重试用同一个编号，不会重复调整；改了数量就算另一次调整。
  const attempt = useRef({ delta: 0, id: '' });

  const id = tenant.customer_id;
  const outcome = planQuota(tenant, amount, mode === 'reduce');
  const plan = outcome !== null && typeof outcome !== 'string' ? outcome : null;
  const problem = typeof outcome === 'string' ? outcome : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !plan) return;
    if (attempt.current.delta !== plan.delta) attempt.current = { delta: plan.delta, id: uuid() };
    setBusy(true);
    setError(undefined);
    setUnsure(false);
    try {
      await api.adjustQuota(id, { request_id: attempt.current.id, delta: plan.delta, reason: reason.trim() || undefined });
      invalidate('tenants', `tenant:${id}`, `adjustments:${id}`);
      toast(`已为「${tenant.name}」${plan.delta > 0 ? '增加' : '减少'} ${formatNumber(Math.abs(plan.delta))} 封额度。`);
      close();
    } catch (failure) {
      setError(failure);
      // 额度可能在别处变过，也可能这次调整其实已经生效：读回最新的数字，让管理员看着它再决定。
      try {
        setTenant(await api.tenant(id));
        invalidate('tenants', `tenant:${id}`, `adjustments:${id}`);
        if (isUnconfirmed(failure)) {
          setError(undefined);
          setUnsure(true);
        }
      } catch { /* 读不回来时保留上面的错误提示 */ }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <FormError error={error} />
      {unsure ? (
        <Notice tone="warn" icon="info">
          连接中断，这次调整有没有生效还不确定。下面是刚读回的额度：已经变了就说明调整成功，直接关闭即可；没变的话再点一次确认，不会重复调整。
        </Notice>
      ) : null}
      <div>
        <Segmented label="调整方向" value={mode} onChange={setMode} options={[{ value: 'add', label: '增加' }, { value: 'reduce', label: '减少' }]} />
      </div>
      <div className="chips" role="group" aria-label="常用数量">
        {PRESETS.map(preset => (
          <button type="button" key={preset} className={cx('chip', amount === String(preset) && 'is-active')} onClick={() => setAmount(String(preset))}>
            {mode === 'add' ? '+' : '−'}{formatNumber(preset)}
          </button>
        ))}
      </div>
      <Field label={mode === 'add' ? '增加数量（封）' : '减少数量（封）'} error={problem}>
        <input className="input input--readout" data-autofocus inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ''))} placeholder="例如 1000" maxLength={15} autoComplete="off" />
      </Field>
      <Field label="原因" tip="选填。会记在这个租户的调额记录里，方便以后对账。">
        <input className="input" value={reason} onChange={event => setReason(event.target.value)} maxLength={200} placeholder="选填，例如：10 月续费" autoComplete="off" />
      </Field>
      <dl className="diff">
        <div>
          <dt>总额度</dt>
          <dd>{formatNumber(tenant.quota_total)}<Icon name="arrow-right" size={14} /><b>{plan ? formatNumber(plan.total) : '—'}</b></dd>
        </div>
        <div>
          <dt>可用</dt>
          <dd>{formatNumber(tenant.available_count)}<Icon name="arrow-right" size={14} /><b>{plan ? formatNumber(plan.available) : '—'}</b></dd>
        </div>
      </dl>
      <div className="dialog__actions">
        <CancelButton />
        {/* 按钮上的字不跟着输入变：结果已经写在上面两行里，按钮宽度保持不动。 */}
        <Button type="submit" variant="primary" busy={busy} disabled={!plan}>确认调整</Button>
      </div>
    </form>
  );
}

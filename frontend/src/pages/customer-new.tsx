import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerPath, useAdmin } from '../app/admin';
import { formatNumber } from '../lib/format';
import { invalidate } from '../lib/query';
import { defaultTemplate, defaultText } from '../lib/template';
import { Button, Field, FormError, Switch, Tip, cx } from '../ui/controls';
import { CancelButton, Dialog, useClose, useToast } from '../ui/overlay';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const QUOTA_PRESETS = [500, 1000, 5000, 10000];

/**
 * 新建客户只问创建时必须定下来的四件事。发件昵称和邮件内容先用默认值，之后在客户页的「邮件」里改。
 * 建好后直接进入这位客户的「接入」页，完整密钥就显示在那里。
 */
export function NewCustomerDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="新建客户" onClose={onClose}>
      <NewCustomerForm />
    </Dialog>
  );
}

function NewCustomerForm() {
  const { api, setSecret } = useAdmin();
  const navigate = useNavigate();
  const toast = useToast();
  const close = useClose();
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [quota, setQuota] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const taken = (error as { code?: string } | undefined)?.code === 'CUSTOMER_EXISTS';
  const idProblem = id && !ID_PATTERN.test(id) ? '只能用字母、数字、下划线和短横线。' : taken ? '这个 ID 已经被使用，请换一个。' : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || idProblem) return;
    setBusy(true);
    setError(undefined);
    try {
      const title = name.trim();
      const created = await api.createCustomer({
        customer_id: id,
        name: title,
        // 发件昵称先跟客户名称走，它的长度上限更短。
        from_name: title.slice(0, 100),
        subject: '邮箱验证码',
        reply_to: '',
        text_template: defaultText,
        html: defaultTemplate,
        quota_total: Number(quota) || 0,
        enabled,
      });
      invalidate('customers');
      setSecret(created);
      toast(`「${created.name}」已创建。`);
      void navigate(customerPath(created.customer_id, 'access'));
      close();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      {taken ? null : <FormError error={error} />}
      <Field label="客户名称" tip="只在管理端里用来认人，之后可以改。">
        <input className="input" data-autofocus value={name} onChange={event => setName(event.target.value)} required maxLength={200} placeholder="例如：星河工作室" autoComplete="off" />
      </Field>
      <Field label="客户 ID" error={idProblem} tip="客户后端调用接口时用它表明身份。只能用字母、数字、下划线和短横线，创建之后不能修改。">
        <input className="input mono" value={id} onChange={event => { setId(event.target.value.trim()); setError(undefined); }} required maxLength={64} placeholder="例如：xinghe" autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="初始额度" tip="可以先留空，之后随时再加。额度永久有效，只增不减。">
        {control => (
          <div className="amount">
            <span className="input-wrap">
              <input className="input" {...control} inputMode="numeric" value={quota} onChange={event => setQuota(event.target.value.replace(/\D/g, ''))} placeholder="0" maxLength={16} autoComplete="off" />
              <span className="input-wrap__unit" aria-hidden="true">封</span>
            </span>
            <div className="chips" role="group" aria-label="常用额度">
              {QUOTA_PRESETS.map(preset => (
                <button type="button" key={preset} className={cx('chip', quota === String(preset) && 'is-active')} onClick={() => setQuota(String(preset))}>
                  {formatNumber(preset)}
                </button>
              ))}
            </div>
          </div>
        )}
      </Field>
      <div className="switch-row">
        <Switch checked={enabled} onChange={setEnabled}>创建后立即启用</Switch>
        <Tip>启用后，客户后端拿到密钥就能调用。关掉则先建好放着，之后在客户页打开运行开关。</Tip>
      </div>
      <div className="dialog__actions">
        <CancelButton />
        <Button type="submit" variant="primary" busy={busy}>创建并生成密钥</Button>
      </div>
    </form>
  );
}

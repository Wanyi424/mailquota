import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatNumber } from '../../lib/format';
import { invalidate } from '../../lib/query';
import { generatePassword } from '../../lib/random';
import { byteLength, defaultTemplate, defaultText } from '../../lib/template';
import { Button, Field, FormError, Switch, Tip, cx } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { CancelButton, Dialog, useClose, useToast } from '../../ui/overlay';
import { tenantPath, useAdmin } from '../context';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const QUOTA_PRESETS = [500, 1000, 5000, 10000];

/**
 * 新建租户只问创建时必须定下来的事：叫什么、接口用哪个 ID、门户用哪个账号登录、给多少额度。
 * 发件昵称和邮件内容先用默认值，之后在租户页的「邮件」里改，或者让租户自己改。
 * 建好后直接进入这个租户的「接入」页，完整的密钥和密码就显示在那里。
 */
export function NewTenantDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="新建租户" onClose={onClose}>
      <NewTenantForm />
    </Dialog>
  );
}

function NewTenantForm() {
  const { api, setSecret } = useAdmin();
  const navigate = useNavigate();
  const toast = useToast();
  const close = useClose();
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  // 登录账号默认跟着客户 ID 走，手动改过之后就不再跟。
  const [customLogin, setCustomLogin] = useState<string | null>(null);
  const [password, setPassword] = useState(generatePassword);
  const [quota, setQuota] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const login = customLogin ?? id;
  const code = (error as { code?: string } | undefined)?.code;
  const idProblem = id && !ID_PATTERN.test(id) ? '只能用字母、数字、下划线和短横线。' : code === 'TENANT_EXISTS' ? '这个 ID 已经被使用，请换一个。' : undefined;
  const loginProblem = code === 'LOGIN_NAME_EXISTS' ? '这个账号已经被使用，请换一个。' : undefined;
  const passwordProblem = password.length < 8 ? '至少 8 个字符。' : byteLength(password) > 72 ? '太长了，最多 72 个字节。' : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || idProblem || loginProblem || passwordProblem) return;
    setBusy(true);
    setError(undefined);
    try {
      const title = name.trim();
      const created = await api.createTenant({
        customer_id: id,
        name: title,
        login_name: login.trim(),
        password,
        // 发件昵称先跟租户名称走，它的长度上限更短。
        from_name: title.slice(0, 100),
        subject: '邮箱验证码',
        reply_to: '',
        text_template: defaultText,
        html_template: defaultTemplate,
        quota_total: Number(quota) || 0,
        enabled,
      });
      invalidate('tenants');
      setSecret({ customer_id: created.customer_id, api_key: created.api_key, password });
      toast(`「${created.name}」已创建。`);
      void navigate(tenantPath(created.customer_id, 'access'));
      close();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      {idProblem || loginProblem ? null : <FormError error={error} />}
      <Field label="租户名称" tip="在管理端和租户门户里用来认人，之后可以改。">
        <input className="input" data-autofocus value={name} onChange={event => setName(event.target.value)} required maxLength={200} placeholder="例如：星河工作室" autoComplete="off" />
      </Field>
      <div className="form__pair">
        <Field label="客户 ID" error={idProblem} tip="租户的业务后端调用接口时用它表明身份。只能用字母、数字、下划线和短横线，创建之后不能修改。">
          <input className="input mono" value={id} onChange={event => { setId(event.target.value.trim()); setError(undefined); }} required maxLength={64} placeholder="例如：xinghe" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field label="登录账号" error={loginProblem} tip="租户登录门户时用的账号，默认和客户 ID 相同。创建之后不能修改。">
          <input className="input mono" value={login} onChange={event => { setCustomLogin(event.target.value); setError(undefined); }} required maxLength={200} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Field>
      </div>
      <Field label="登录密码" error={passwordProblem} tip="租户登录门户用的初始密码，已经随机生成好，也可以改成你想要的。创建后只显示一次。">
        {control => (
          <span className="input-wrap">
            <input className="input mono" {...control} value={password} onChange={event => setPassword(event.target.value)} required maxLength={72} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            <button type="button" className="input-wrap__action" onClick={() => setPassword(generatePassword())} aria-label="重新生成密码" title="重新生成密码">
              <Icon name="refresh-cw" size={16} />
            </button>
          </span>
        )}
      </Field>
      <Field label="初始额度" tip="可以先留空，之后随时再调整。额度永久有效。">
        {control => (
          <div className="amount">
            <span className="input-wrap">
              <input className="input" {...control} inputMode="numeric" value={quota} onChange={event => setQuota(event.target.value.replace(/\D/g, ''))} placeholder="0" maxLength={15} autoComplete="off" />
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
        <Tip>启用后，租户的业务后端拿到密钥就能调用，门户账号也能登录。关掉则先建好放着，之后在租户页打开运行开关。</Tip>
      </div>
      <div className="dialog__actions">
        <CancelButton />
        <Button type="submit" variant="primary" busy={busy}>创建租户</Button>
      </div>
    </form>
  );
}

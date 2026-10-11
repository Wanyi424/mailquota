import { useState, type FormEvent, type ReactNode } from 'react';
import { setTheme, useTheme } from '../lib/theme';
import { Button, Field, FormError, IconButton } from '../ui/controls';
import { BrandMark, Icon } from '../ui/icon';
import { QuotaMeter } from '../ui/meter';
import { useTitle } from './title';

/** 两个门户的登录页结构相同，只有这几处文字不一样。 */
export type LoginCopy = {
  /** 登录卡片的标题。 */
  title: string;
  /** 账号输入框的标签。 */
  account: string;
  /** 海报下方的三句话。 */
  facts: string[];
  /** 卡片底部说明忘记密码怎么办。 */
  help: ReactNode;
};

type Submit = (account: string, password: string) => Promise<void>;

export function LoginForm({ label, account: initialAccount = '', onSubmit }: { label: string; account?: string; onSubmit: Submit }) {
  const [account, setAccount] = useState(initialAccount);
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(account, password);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <FormError error={error} />
      <Field label={label}>
        <input className="input" value={account} onChange={event => setAccount(event.target.value)} required maxLength={200} autoComplete="username" autoCapitalize="none" spellCheck={false} data-autofocus={initialAccount ? undefined : ''} autoFocus={!initialAccount} />
      </Field>
      <Field label="登录密码">
        {control => (
          <span className="input-wrap">
            <input className="input" {...control} type={revealed ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required maxLength={200} autoComplete="current-password" data-autofocus={initialAccount ? '' : undefined} />
            <button type="button" className="input-wrap__action" onClick={() => setRevealed(value => !value)} aria-label={revealed ? '隐藏密码' : '显示密码'} aria-pressed={revealed} title={revealed ? '隐藏密码' : '显示密码'}>
              <Icon name={revealed ? 'eye-off' : 'eye'} size={17} />
            </button>
          </span>
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" block busy={busy}>{busy ? '正在登录' : '登录'}</Button>
    </form>
  );
}

export function LoginPage({ copy, onSubmit }: { copy: LoginCopy; onSubmit: Submit }) {
  const { resolved } = useTheme();
  useTitle('登录');
  return (
    <div className="login">
      <header className="login__bar">
        <span className="brand"><BrandMark size={28} /><span className="brand__word">MailQuota</span></span>
        <IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label={resolved === 'dark' ? '切换到浅色' : '切换到深色'} onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} />
      </header>

      <main className="login__stage">
        <section className="login__poster" aria-hidden="true">
          <p className="eyebrow eyebrow--caps">Verification mail, metered</p>
          <h1 className="login__headline">每一封邮件，<br />都心中<mark>有数</mark>。</h1>
          {/* 和额度面板里的是同一个组件，登录页只是摆一根示意。 */}
          <QuotaMeter quota={{ quota_total: 100, available_count: 68 }} health="ok" large />
          <ul className="login__facts">
            {copy.facts.map(fact => <li key={fact}>{fact}</li>)}
          </ul>
        </section>

        <section className="login__card">
          <h2>{copy.title}</h2>
          <LoginForm label={copy.account} onSubmit={onSubmit} />
          <p className="login__help">{copy.help}</p>
        </section>
      </main>
    </div>
  );
}

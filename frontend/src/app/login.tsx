import { useState, type FormEvent } from 'react';
import { useTitle } from './admin';
import { setTheme, useTheme } from '../lib/theme';
import { Button, Field, FormError, IconButton } from '../ui/controls';
import { BrandMark, Icon } from '../ui/icon';
import { QuotaMeter } from '../ui/meter';

export function LoginForm({ username: initialUsername = '', onSubmit }: { username?: string; onSubmit: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState(initialUsername);
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
      await onSubmit(username, password);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <FormError error={error} />
      <Field label="管理员账号">
        <input className="input" value={username} onChange={event => setUsername(event.target.value)} required maxLength={200} autoComplete="username" autoCapitalize="none" spellCheck={false} data-autofocus={initialUsername ? undefined : ''} autoFocus={!initialUsername} />
      </Field>
      <Field label="登录密码">
        {control => (
          <span className="input-wrap">
            <input className="input" {...control} type={revealed ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required maxLength={200} autoComplete="current-password" data-autofocus={initialUsername ? '' : undefined} />
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

export function LoginPage({ onSubmit }: { onSubmit: (username: string, password: string) => Promise<void> }) {
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
          {/* 和客户页里的额度条是同一个组件，登录页只是摆一根示意。 */}
          <QuotaMeter quota={{ quota_total: 100, available_count: 68 }} health="ok" large />
          <ul className="login__facts">
            <li>按封计量</li>
            <li>永久额度</li>
            <li>一个客户一把密钥</li>
          </ul>
        </section>

        <section className="login__card">
          <h2>管理员登录</h2>
          <LoginForm onSubmit={onSubmit} />
          <p className="login__help">忘记密码时，在服务器上运行 <code>npm run password</code> 重新设置。</p>
        </section>
      </main>
    </div>
  );
}

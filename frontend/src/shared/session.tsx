import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollRestoration } from 'react-router-dom';
import { explainError } from '../lib/format';
import { clearQueries, invalidate } from '../lib/query';
import type { SessionApi } from '../types';
import { Button } from '../ui/controls';
import { BrandMark } from '../ui/icon';
import { ConfirmProvider, Dialog, ToastProvider, useConfirm, useToast } from '../ui/overlay';
import { hasUnsavedChanges } from './guard';
import { LoginForm, LoginPage, type LoginCopy } from './login';

type AnySession = { csrf_token: string };

/** 一个门户（管理端或租户门户）接入会话关卡时要说明的事。必须是模块级常量，不随渲染变化。 */
export type Portal<A extends SessionApi<S>, S extends AnySession> = {
  /** 创建这个门户的接口对象；会话失效时它会调用 onExpired。 */
  createApi: (onExpired: () => void) => A;
  /** 表示「还没登录」的错误码。 */
  authRequired: string;
  /** 会话里的登录账号，过期后重新登录时预先填好。 */
  accountOf: (session: S) => string;
  login: LoginCopy;
  /** 启动时显示的一句话。 */
  connecting: string;
};

/** 登录之后交给门户的东西。 */
export type Signed<A, S> = {
  api: A;
  session: S;
  logout: () => Promise<void>;
};

type Render<A, S> = (signed: Signed<A, S>) => ReactNode;

/** 门户的最外层：提示条、确认框和会话关卡。children 只在登录后渲染。 */
export function PortalRoot<A extends SessionApi<S>, S extends AnySession>({ portal, children }: { portal: Portal<A, S>; children: Render<A, S> }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Gate portal={portal}>{children}</Gate>
        <ScrollRestoration />
      </ConfirmProvider>
    </ToastProvider>
  );
}

type Boot = { state: 'loading' } | { state: 'ready' } | { state: 'failed'; error: unknown };

/** 会话关卡：未登录时任何地址都显示登录页，登录后原地进入刚才想去的页面。 */
function Gate<A extends SessionApi<S>, S extends AnySession>({ portal, children }: { portal: Portal<A, S>; children: Render<A, S> }) {
  const [expired, setExpired] = useState(false);
  const [api] = useState(() => portal.createApi(() => setExpired(true)));
  const [session, setSession] = useState<S | null>(null);
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });

  const load = useCallback(async () => {
    setBoot({ state: 'loading' });
    try {
      const current = await api.session();
      setSession(() => current);
      setBoot({ state: 'ready' });
    } catch (error) {
      if ((error as { code?: string }).code !== portal.authRequired) {
        setBoot({ state: 'failed', error });
        return;
      }
      setSession(null);
      setExpired(false);
      setBoot({ state: 'ready' });
    }
  }, [api, portal]);

  useEffect(() => { void load(); }, [load]);

  const login = useCallback(async (account: string, password: string) => {
    const next = await api.login(account, password);
    clearQueries();
    setExpired(false);
    setSession(() => next);
  }, [api]);

  const relogin = useCallback(async (account: string, password: string) => {
    const next = await api.login(account, password);
    setSession(() => next);
    setExpired(false);
    invalidate();
  }, [api]);

  const signedOut = useCallback(() => {
    clearQueries();
    setExpired(false);
    setSession(null);
  }, []);

  if (boot.state === 'loading') return <Splash text={portal.connecting} />;
  if (boot.state === 'failed') return <Splash text={portal.connecting} error={boot.error} onRetry={() => void load()} />;
  if (session === null) return <LoginPage copy={portal.login} onSubmit={login} />;
  return (
    <SignedIn portal={portal} api={api} session={session} expired={expired} onDismissExpired={() => setExpired(false)} onRelogin={relogin} onSignedOut={signedOut}>
      {children}
    </SignedIn>
  );
}

type SignedInProps<A extends SessionApi<S>, S extends AnySession> = {
  portal: Portal<A, S>;
  api: A;
  session: S;
  expired: boolean;
  onDismissExpired: () => void;
  onRelogin: (account: string, password: string) => Promise<void>;
  onSignedOut: () => void;
  children: Render<A, S>;
};

function SignedIn<A extends SessionApi<S>, S extends AnySession>({ portal, api, session, expired, onDismissExpired, onRelogin, onSignedOut, children }: SignedInProps<A, S>) {
  const confirm = useConfirm();
  const toast = useToast();

  const logout = useCallback(async () => {
    if (hasUnsavedChanges() && !await confirm({ title: '还有未保存的修改', body: '现在退出登录，这些修改不会保留。', confirmLabel: '放弃修改并退出', danger: true })) return;
    try {
      await api.logout();
    } catch (error) {
      toast(explainError(error), 'danger');
      return;
    }
    onSignedOut();
  }, [api, confirm, onSignedOut, toast]);

  const signed = useMemo<Signed<A, S>>(() => ({ api, session, logout }), [api, session, logout]);

  return (
    <>
      {children(signed)}
      {expired ? (
        <Dialog title="登录已过期" description="重新登录后可以接着操作，页面上还没保存的输入都还在。" size="sm" dismissable={false} onClose={onDismissExpired}>
          <LoginForm label={portal.login.account} account={portal.accountOf(session)} onSubmit={onRelogin} />
        </Dialog>
      ) : null}
    </>
  );
}

function Splash({ text, error, onRetry }: { text: string; error?: unknown; onRetry?: () => void }) {
  return (
    <main className="splash" aria-live="polite">
      <BrandMark size={44} />
      {onRetry ? (
        <>
          <p>{explainError(error)}</p>
          <Button icon="refresh-cw" onClick={onRetry}>重新连接</Button>
        </>
      ) : <p>{text}</p>}
    </main>
  );
}

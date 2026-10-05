import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { createApi } from '../api';
import { explainError } from '../lib/format';
import { clearQueries, invalidate } from '../lib/query';
import { NewCustomerDialog } from '../pages/customer-new';
import { QuotaDialog } from '../pages/quota-dialog';
import type { AdminApi, Customer, CustomerSecret, Session } from '../types';
import { Button } from '../ui/controls';
import { BrandMark } from '../ui/icon';
import { ConfirmProvider, Dialog, ToastProvider, useConfirm, useToast } from '../ui/overlay';
import { AdminContext, customerPath, type AdminContextValue } from './admin';
import { hasUnsavedChanges } from './guard';
import { LoginForm, LoginPage } from './login';
import { Shell } from './shell';

export function Root() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Gate />
        <ScrollRestoration />
      </ConfirmProvider>
    </ToastProvider>
  );
}

type Boot = { state: 'loading' } | { state: 'ready' } | { state: 'failed'; error: unknown };

/** 会话关卡：未登录时任何地址都显示登录页，登录后原地进入刚才想去的页面。 */
function Gate() {
  const [expired, setExpired] = useState(false);
  const [api] = useState(() => createApi({ onExpired: () => setExpired(true) }));
  const [session, setSession] = useState<Session | null>(null);
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });

  const load = useCallback(async () => {
    setBoot({ state: 'loading' });
    try {
      setSession(await api.session());
      setBoot({ state: 'ready' });
    } catch (error) {
      if ((error as { code?: string }).code !== 'ADMIN_AUTH_REQUIRED') {
        setBoot({ state: 'failed', error });
        return;
      }
      setSession(null);
      setExpired(false);
      setBoot({ state: 'ready' });
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  if (boot.state === 'loading') return <Splash />;
  if (boot.state === 'failed') return <Splash error={boot.error} onRetry={() => void load()} />;
  if (!session) {
    return (
      <LoginPage onSubmit={async (username, password) => {
        const next = await api.login(username, password);
        clearQueries();
        setExpired(false);
        setSession(next);
      }} />
    );
  }
  return (
    <Signed
      api={api}
      session={session}
      expired={expired}
      onDismissExpired={() => setExpired(false)}
      onRelogin={async (username, password) => {
        setSession(await api.login(username, password));
        setExpired(false);
        invalidate();
      }}
      onSignedOut={() => {
        clearQueries();
        setExpired(false);
        setSession(null);
      }}
    />
  );
}

type SignedProps = {
  api: AdminApi;
  session: Session;
  expired: boolean;
  onDismissExpired: () => void;
  onRelogin: (username: string, password: string) => Promise<void>;
  onSignedOut: () => void;
};

function Signed({ api, session, expired, onDismissExpired, onRelogin, onSignedOut }: SignedProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const { pathname } = useLocation();
  const [quotaFor, setQuotaFor] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<CustomerSecret | null>(null);

  // 完整密钥只存在于它所属客户的「接入」页，换到任何别的页面就从内存里清掉。
  useEffect(() => {
    setSecret(current => (current && pathname !== customerPath(current.customer_id, 'access') ? null : current));
  }, [pathname]);

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

  const newCustomer = useCallback(() => setCreating(true), []);
  const value = useMemo<AdminContextValue>(() => ({ api, session, logout, topUp: setQuotaFor, newCustomer, secret, setSecret }), [api, session, logout, newCustomer, secret]);

  return (
    <AdminContext.Provider value={value}>
      <Shell><Outlet /></Shell>
      {quotaFor ? <QuotaDialog customer={quotaFor} onClose={() => setQuotaFor(null)} /> : null}
      {creating ? <NewCustomerDialog onClose={() => setCreating(false)} /> : null}
      {expired ? (
        <Dialog title="登录已过期" description="重新登录后可以接着操作，页面上还没保存的输入都还在。" size="sm" dismissable={false} onClose={onDismissExpired}>
          <LoginForm username={session.username} onSubmit={onRelogin} />
        </Dialog>
      ) : null}
    </AdminContext.Provider>
  );
}

function Splash({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  return (
    <main className="splash" aria-live="polite">
      <BrandMark size={44} />
      {onRetry ? (
        <>
          <p>{explainError(error)}</p>
          <Button icon="refresh-cw" onClick={onRetry}>重新连接</Button>
        </>
      ) : <p>正在连接管理服务</p>}
    </main>
  );
}

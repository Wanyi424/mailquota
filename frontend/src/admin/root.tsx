import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PortalRoot, type Portal, type Signed } from '../shared/session';
import type { TenantSummary } from '../types';
import { createAdminApi } from './api';
import { AdminContext, tenantPath, type AdminContextValue, type Secret } from './context';
import { QuotaDialog } from './pages/quota-dialog';
import { NewTenantDialog } from './pages/tenant-new';
import { Shell } from './shell';
import type { AdminApi, Session } from './types';

const portal: Portal<AdminApi, Session> = {
  createApi: onExpired => createAdminApi({ onExpired }),
  authRequired: 'ADMIN_AUTH_REQUIRED',
  accountOf: session => session.username,
  connecting: '正在连接管理服务',
  login: {
    title: '管理员登录',
    account: '管理员账号',
    facts: ['按封计量', '永久额度', '一个租户一把密钥'],
    help: <>忘记密码时，在服务器上运行 <code>pnpm run password</code> 重新设置。</>,
  },
};

export function AdminRoot() {
  return <PortalRoot portal={portal}>{signed => <AdminApp {...signed} />}</PortalRoot>;
}

/** 登录后的管理端：外壳、当前页面，以及两个从任何页面都能打开的对话框。 */
function AdminApp({ api, session, logout }: Signed<AdminApi, Session>) {
  const { pathname } = useLocation();
  const [quotaFor, setQuotaFor] = useState<TenantSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);

  // 完整密钥和密码只存在于它所属租户的「接入」页，换到任何别的页面就从内存里清掉。
  useEffect(() => {
    setSecret(current => (current && pathname !== tenantPath(current.customer_id, 'access') ? null : current));
  }, [pathname]);

  const newTenant = useCallback(() => setCreating(true), []);
  const value = useMemo<AdminContextValue>(() => ({ api, session, logout, adjustQuota: setQuotaFor, newTenant, secret, setSecret }), [api, session, logout, newTenant, secret]);

  return (
    <AdminContext.Provider value={value}>
      <Shell><Outlet /></Shell>
      {quotaFor ? <QuotaDialog tenant={quotaFor} onClose={() => setQuotaFor(null)} /> : null}
      {creating ? <NewTenantDialog onClose={() => setCreating(false)} /> : null}
    </AdminContext.Provider>
  );
}


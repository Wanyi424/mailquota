import { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { PortalRoot, type Portal, type Signed } from '../shared/session';
import { createTenantApi } from './api';
import { TenantContext, type TenantContextValue } from './context';
import { Shell } from './shell';
import type { Session, TenantApi } from './types';

const portal: Portal<TenantApi, Session> = {
  createApi: onExpired => createTenantApi({ onExpired }),
  authRequired: 'TENANT_AUTH_REQUIRED',
  accountOf: session => session.login_name,
  connecting: '正在连接',
  login: {
    title: '登录',
    account: '登录账号',
    facts: ['额度随时可查', '邮件内容自己定', '每一封都有记录'],
    help: '忘记账号或密码时，请联系为你开通服务的管理员重置。',
  },
};

export function TenantRoot() {
  return <PortalRoot portal={portal}>{signed => <TenantApp {...signed} />}</PortalRoot>;
}

function TenantApp({ api, session, logout }: Signed<TenantApi, Session>) {
  const value = useMemo<TenantContextValue>(() => ({ api, session, logout }), [api, session, logout]);
  return (
    <TenantContext.Provider value={value}>
      <Shell><Outlet /></Shell>
    </TenantContext.Provider>
  );
}

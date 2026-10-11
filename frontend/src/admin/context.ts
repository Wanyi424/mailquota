import { createContext, useContext } from 'react';
import type { TenantSummary } from '../types';
import type { AdminApi, Session } from './types';

/** 刚创建或刚重置得到的凭据：调用密钥、门户登录密码，或两者都有。 */
export type Secret = { customer_id: string; api_key?: string; password?: string };

export type AdminContextValue = {
  api: AdminApi;
  session: Session;
  logout: () => Promise<void>;
  /** 打开「调整额度」对话框。 */
  adjustQuota: (tenant: TenantSummary) => void;
  /** 打开「新建租户」对话框。 */
  newTenant: () => void;
  /** 刚得到的凭据只留在内存里，在该租户的「接入」页显示，离开那一页就清掉。 */
  secret: Secret | null;
  setSecret: (secret: Secret | null) => void;
};

export const AdminContext = createContext<AdminContextValue | null>(null);

export type TenantTab = 'mail' | 'access' | 'records';
export const tenantPath = (id: string, tab?: TenantTab) => `/tenants/${encodeURIComponent(id)}${tab ? `/${tab}` : ''}`;

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin 只能在登录后的页面里使用');
  return value;
}

import { createContext, useContext } from 'react';
import { useQuery } from '../lib/query';
import type { Session, TenantApi } from './types';

export type TenantContextValue = {
  api: TenantApi;
  session: Session;
  logout: () => Promise<void>;
};

export const TenantContext = createContext<TenantContextValue | null>(null);

export function usePortal() {
  const value = useContext(TenantContext);
  if (!value) throw new Error('usePortal 只能在登录后的页面里使用');
  return value;
}

/** 自己的资料、额度和邮件配置。各个页面共用同一份，切换页面不重新读取。 */
export function useMe() {
  const { api } = usePortal();
  return useQuery('me', api.me);
}

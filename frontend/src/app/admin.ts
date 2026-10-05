import { createContext, useContext, useEffect } from 'react';
import type { AdminApi, Customer, CustomerSecret, Session } from '../types';

export type AdminContextValue = {
  api: AdminApi;
  session: Session;
  logout: () => Promise<void>;
  /** 打开「加额度」对话框。 */
  topUp: (customer: Customer) => void;
  /** 打开「新建客户」对话框。 */
  newCustomer: () => void;
  /** 刚创建或刚重置得到的完整密钥。只留在内存里，在该客户的「接入」页显示，离开那一页就清掉。 */
  secret: CustomerSecret | null;
  setSecret: (secret: CustomerSecret | null) => void;
};

export const AdminContext = createContext<AdminContextValue | null>(null);

/** 浏览器标签页标题：多开几个标签时能分清哪个是哪个。 */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · MailQuota`;
  }, [title]);
}

export type CustomerTab = 'email' | 'access' | 'records';
export const customerPath = (id: string, tab?: CustomerTab) => `/customers/${encodeURIComponent(id)}${tab ? `/${tab}` : ''}`;

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin 只能在登录后的页面里使用');
  return value;
}

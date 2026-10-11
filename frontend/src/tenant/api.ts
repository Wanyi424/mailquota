import { createHttp, toQuery, type HttpOptions } from '../lib/http';
import type { Page, Tenant } from '../types';
import type { RequestRow, Session, Stats, TenantApi } from './types';

export function createTenantApi(options: HttpOptions = {}): TenantApi {
  const { request, remember, forget } = createHttp('/tenant/api', 'TENANT_AUTH_REQUIRED', options);

  return {
    session: async () => remember(await request<Session>('/session')),
    login: async (login_name, password) => remember(await request<Session>('/login', { method: 'POST', body: { login_name, password } })),
    async logout() {
      await request('/logout', { method: 'POST', body: {} });
      forget();
    },
    me: () => request<Tenant>('/me'),
    saveMail: (version, changes) => request<Tenant>('/config', { method: 'PATCH', body: { version, ...changes } }),
    requests: filters => request<Page<RequestRow>>(`/requests${toQuery(filters)}`),
    stats: days => request<Stats>(`/stats${toQuery({ days })}`),
  };
}

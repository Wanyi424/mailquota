import { createHttp, toQuery, type HttpOptions } from '../lib/http';
import type { Page, Tenant, TenantSummary } from '../types';
import type { AdminApi, QuotaAdjustment, RequestDetail, RequestRow, Session, Stats, TenantSecret } from './types';

/** 调额历史每页的条数。 */
export const ADJUSTMENT_PAGE_SIZE = 8;

export function createAdminApi(options: HttpOptions = {}): AdminApi {
  const { request, remember, forget } = createHttp('/admin/api', 'ADMIN_AUTH_REQUIRED', options);
  const tenantPath = (id: string) => `/tenants/${encodeURIComponent(id)}`;
  const requestPath = (id: string) => `/requests/${encodeURIComponent(id)}`;

  return {
    session: async () => remember(await request<Session>('/session')),
    login: async (username, password) => remember(await request<Session>('/login', { method: 'POST', body: { username, password } })),
    async logout() {
      await request('/logout', { method: 'POST', body: {} });
      forget();
    },
    tenants: async () => (await request<{ items: TenantSummary[] }>('/tenants')).items,
    tenant: id => request<Tenant>(tenantPath(id)),
    createTenant: input => request<TenantSecret>('/tenants', { method: 'POST', body: input }),
    updateTenant: (id, version, changes) => request<Tenant>(tenantPath(id), { method: 'PATCH', body: { version, ...changes } }),
    resetKey: id => request<TenantSecret>(`${tenantPath(id)}/api-key`, { method: 'POST', body: {} }),
    resetPassword: (id, password) => request<void>(`${tenantPath(id)}/password`, { method: 'POST', body: { password } }),
    adjustQuota: (id, change) => request<QuotaAdjustment>(`${tenantPath(id)}/quota`, { method: 'POST', body: change }),
    adjustments: (id, page) => request<Page<QuotaAdjustment>>(`${tenantPath(id)}/quota-adjustments${toQuery({ page, page_size: ADJUSTMENT_PAGE_SIZE })}`),
    stats: (days, customerId) => request<Stats>(`/stats${toQuery({ days, customer_id: customerId })}`),
    requests: filters => request<Page<RequestRow>>(`/requests${toQuery(filters)}`),
    request: id => request<RequestDetail>(requestPath(id)),
    resolve: (id, status, note = '') => request<RequestDetail>(`${requestPath(id)}/resolve`, { method: 'POST', body: { status, note } }),
  };
}

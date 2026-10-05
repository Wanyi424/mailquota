import type { AdminApi, Customer, CustomerDetail, CustomerSecret, RequestFilters, RequestPage, RequestRow, Session, Stats } from './types';

export class ApiError extends Error {
  code: string;
  status: number;
  data: unknown;
  retryAfter: number;

  constructor(message: string, options: { code?: string; status?: number; data?: unknown; retryAfter?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code || 'NETWORK_ERROR';
    this.status = options.status || 0;
    this.data = options.data;
    this.retryAfter = options.retryAfter || 0;
  }
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ApiOptions = {
  fetchImpl?: FetchImpl;
  onExpired?: () => void;
  timeout?: number;
};

type ApiResponse<T> = {
  success: boolean;
  code: string;
  message?: string;
  data: T;
  retry_after_seconds?: number;
};

export function createApi({ fetchImpl = (...args) => fetch(...args), onExpired = () => {}, timeout = 20000 }: ApiOptions = {}): AdminApi {
  let csrf = '';

  async function request<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;

    try {
      const response = await fetchImpl(`/admin/api${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      let result: ApiResponse<T>;
      try {
        result = await response.json() as ApiResponse<T>;
      } catch {
        throw new ApiError(
          method === 'GET'
            ? '服务返回了无法识别的响应，请检查连接后刷新。'
            : '服务返回了无法识别的响应，操作结果尚未确认。请重新读取数据确认结果后再操作。',
          { status: response.status, code: 'INVALID_RESPONSE' },
        );
      }
      if (!response.ok || result.success !== true) {
        if (result.code === 'ADMIN_AUTH_REQUIRED') {
          csrf = '';
          onExpired();
        }
        throw new ApiError(result.message || '操作未完成，请稍后重试。', {
          status: response.status,
          code: result.code,
          data: result.data,
          retryAfter: Number(result.retry_after_seconds || (result.data as { retry_after_seconds?: number } | undefined)?.retry_after_seconds || response.headers.get('Retry-After') || 0),
        });
      }
      return result.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // 写操作绝不自动重试：请求可能已经生效，只是响应没有回来。
      throw new ApiError(
        method === 'GET'
          ? '连接超时或网络中断，暂时无法读取数据。请检查连接后重试。'
          : '连接中断，操作结果尚未确认。请重新读取数据确认结果后再操作；如密钥已重置但未收到，请确认后重新生成。',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const customerPath = (id: string) => `/customers/${encodeURIComponent(id)}`;
  const remember = (session: Session) => {
    csrf = session.csrf_token;
    return session;
  };

  return {
    session: async () => remember(await request<Session>('/session')),
    login: async (username, password) => remember(await request<Session>('/login', { method: 'POST', body: { username, password } })),
    async logout() {
      await request('/logout', { method: 'POST', body: {} });
      csrf = '';
    },
    customers: async () => (await request<{ items: Customer[] }>('/customers')).items,
    customer: id => request<CustomerDetail>(customerPath(id)),
    createCustomer: input => request<CustomerSecret>('/customers', { method: 'POST', body: input }),
    updateCustomer: (id, version, changes) => request<CustomerDetail>(customerPath(id), { method: 'PATCH', body: { version, ...changes } }),
    resetKey: (id, version) => request<CustomerSecret>(`${customerPath(id)}/key`, { method: 'POST', body: { version } }),
    stats: (days = 14) => request<Stats>(`/stats?days=${days}`),
    requests: (filters: RequestFilters) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined && value !== null) query.set(key, String(value));
      return request<RequestPage>(`/requests?${query}`);
    },
    request: id => request<RequestRow>(`/requests/${encodeURIComponent(id)}`),
    resolve: (id, status, note = '') => request<RequestRow>(`/requests/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { status, note } }),
  };
}

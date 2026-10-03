import type { AdminApi, Customer, CustomerPage, RequestFilters, RequestPage, RequestRow, Session, Template } from './types';

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

  async function request<T>(path: string, { method = 'GET', body, html = false }: { method?: string; body?: unknown; html?: boolean } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers: Record<string, string> = { Accept: html ? 'text/html, application/json' : 'application/json' };
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
      if (html && response.ok && response.headers.get('content-type')?.includes('text/html')) return await response.text() as T;

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

  return {
    async session(): Promise<Session> {
      const data = await request<Session>('/session');
      csrf = data.csrf_token;
      return data;
    },
    async login(username: string, password: string): Promise<Session> {
      const data = await request<Session>('/login', { method: 'POST', body: { username, password } });
      csrf = data.csrf_token;
      return data;
    },
    async logout() {
      await request('/logout', { method: 'POST', body: {} });
      csrf = '';
    },
    customers: (page = 1, pageSize = 100) => request<CustomerPage>(`/customers?page=${page}&page_size=${pageSize}`),
    customer: (id: string) => request<Customer>(customerPath(id)),
    createCustomer: (body: Record<string, unknown>) => request<Customer>('/customers', { method: 'POST', body }),
    rename: (id: string, version: number, name: string) => request<Customer>(customerPath(id), { method: 'PATCH', body: { version, name } }),
    setEnabled: (id: string, version: number, enabled: boolean) => request<Customer>(`${customerPath(id)}/enabled`, { method: 'PUT', body: { version, enabled, confirmed: true } }),
    resetKey: (id: string, version: number) => request<Customer>(`${customerPath(id)}/key/reset`, { method: 'POST', body: { version, confirmed: true } }),
    setQuota: (id: string, version: number, quotaTotal: number) => request<Customer>(`${customerPath(id)}/quota`, { method: 'PUT', body: { version, quota_total: quotaTotal } }),
    saveMail: (id: string, version: number, body: { from_name: string; subject: string; reply_to: string; text_template: string }) => request<Customer>(`${customerPath(id)}/mail`, { method: 'PUT', body: { version, from_name: body.from_name, subject: body.subject, reply_to: body.reply_to, text_template: body.text_template } }),
    template: (id: string) => request<Template>(`${customerPath(id)}/template`),
    saveTemplate: (id: string, version: number, html: string) => request<{ version: number }>(`${customerPath(id)}/template`, { method: 'PUT', body: { version, html } }),
    preview: (html: string) => request<string>('/template/preview', { method: 'POST', body: { html }, html: true }),
    requests: (filters: RequestFilters) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined && value !== null) query.set(key, String(value));
      return request<RequestPage>(`/requests?${query}`);
    },
    resolve: (id: number, status: 'accepted' | 'failed', note: string) => request<RequestRow>(`/requests/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { status, note, confirmed: true } }),
  };
}

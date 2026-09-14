export class ApiError extends Error {
  constructor(message, { code = 'NETWORK_ERROR', status = 0, data, retryAfter = 0 } = {}) {
    super(message); Object.assign(this, { code, status, data, retryAfter });
  }
}

// All writes are explicit, once-only requests. In particular, never retry key rotation or settlement.
export function createApi({ fetchImpl = (...args) => fetch(...args), onExpired = () => {}, timeout = 20000 } = {}) {
  let csrf = '';
  async function request(path, { method = 'GET', body, html = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers = { Accept: html ? 'text/html, application/json' : 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
    try {
      const response = await fetchImpl(`/admin/api${path}`, {
        method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (html && response.ok && response.headers.get('content-type')?.includes('text/html')) return await response.text();
      let result;
      try { result = await response.json(); }
      catch { throw new ApiError(method === 'GET' ? '服务返回了无法识别的响应，请检查连接后刷新。' : '服务返回了无法识别的响应，操作结果尚未确认。请重新读取数据确认结果后再操作。', { status: response.status, code: 'INVALID_RESPONSE' }); }
      if (!response.ok || result.success !== true) {
        if (result.code === 'ADMIN_AUTH_REQUIRED') { csrf = ''; onExpired(); }
        throw new ApiError(result.message || '操作未完成，请稍后重试。', {
          status: response.status, code: result.code, data: result.data,
          retryAfter: Number(result.retry_after_seconds || result.data?.retry_after_seconds || response.headers.get('Retry-After') || 0),
        });
      }
      return result.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(method === 'GET'
        ? '连接超时或网络中断，暂时无法读取数据。请检查连接后重试。'
        : '连接中断，操作结果尚未确认。请重新读取数据确认结果后再操作；如密钥已重置但未收到，请确认后重新生成。');
    } finally { clearTimeout(timer); }
  }
  const customerPath = id => `/customers/${encodeURIComponent(id)}`;
  return {
    async session() { const data = await request('/session'); csrf = data.csrf_token; return data; },
    async login(username, password) { const data = await request('/login', { method: 'POST', body: { username, password } }); csrf = data.csrf_token; return data; },
    async logout() { await request('/logout', { method: 'POST', body: {} }); csrf = ''; },
    customers: (page = 1, pageSize = 100) => request(`/customers?page=${page}&page_size=${pageSize}`),
    customer: id => request(customerPath(id)),
    createCustomer: body => request('/customers', { method: 'POST', body }),
    rename: (id, version, name) => request(customerPath(id), { method: 'PATCH', body: { version, name } }),
    setEnabled: (id, version, enabled) => request(`${customerPath(id)}/enabled`, { method: 'PUT', body: { version, enabled, confirmed: true } }),
    resetKey: (id, version) => request(`${customerPath(id)}/key/reset`, { method: 'POST', body: { version, confirmed: true } }),
    setQuota: (id, version, quota_total) => request(`${customerPath(id)}/quota`, { method: 'PUT', body: { version, quota_total } }),
    saveMail: (id, version, { from_name, subject, reply_to, text_template }) => request(`${customerPath(id)}/mail`, { method: 'PUT', body: { version, from_name, subject, reply_to, text_template } }),
    template: id => request(`${customerPath(id)}/template`),
    saveTemplate: (id, version, html) => request(`${customerPath(id)}/template`, { method: 'PUT', body: { version, html } }),
    preview: html => request('/template/preview', { method: 'POST', body: { html }, html: true }),
    requests: filters => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined && value !== null) query.set(key, String(value));
      return request(`/requests?${query}`);
    },
    resolve: (id, status, note) => request(`/requests/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { status, note, confirmed: true } }),
  };
}

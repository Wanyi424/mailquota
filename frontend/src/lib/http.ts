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

/** 请求没有得到可信的答复：可能没发出去，也可能已经生效只是响应没回来。 */
export const isUnconfirmed = (error: unknown) => ['NETWORK_ERROR', 'INVALID_RESPONSE'].includes((error as { code?: string } | null)?.code ?? '');

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type HttpOptions = {
  fetchImpl?: FetchImpl;
  /** 接口答复「需要登录」时调用，通常意味着会话过期了。 */
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

/**
 * 两个门户共用的请求层：同源 Cookie 会话，写请求带 CSRF Token。
 * base 是接口前缀，authRequired 是表示「还没登录或登录已过期」的错误码。
 */
export function createHttp(base: string, authRequired: string, { fetchImpl = (...args) => fetch(...args), onExpired = () => {}, timeout = 20000 }: HttpOptions = {}) {
  let csrf = '';

  async function request<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;

    try {
      const response = await fetchImpl(`${base}${path}`, {
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
        if (result.code === authRequired) {
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
          : '连接中断，操作结果尚未确认。请重新读取数据确认结果后再操作。',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request,
    /** 登录或读到会话后记下 CSRF Token，再把会话原样交回去。 */
    remember<S extends { csrf_token: string }>(session: S) {
      csrf = session.csrf_token;
      return session;
    },
    forget() {
      csrf = '';
    },
  };
}

/** 把筛选条件拼成查询串，空值不带。 */
export function toQuery(params: object) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== '' && value !== undefined && value !== null) query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : '';
}

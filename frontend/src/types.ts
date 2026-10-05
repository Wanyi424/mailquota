export type Session = {
  username: string;
  csrf_token: string;
  /** 实际发信地址，仅用于让邮件预览更接近真实收件效果。 */
  sender: string;
};

export type Customer = {
  customer_id: string;
  name: string;
  from_name: string;
  subject: string;
  reply_to: string;
  text_template: string;
  html_template: string;
  enabled: boolean;
  quota_total: number;
  used_count: number;
  reserved_count: number;
  available_count: number;
  version: number;
  api_key_mask: string;
};

export type CustomerDetail = Customer & { html: string };

/** 完整密钥只在创建和重置的响应里出现一次。 */
export type CustomerSecret = Customer & { api_key: string };

export type NewCustomer = Pick<CustomerDetail, 'customer_id' | 'name' | 'from_name' | 'subject' | 'reply_to' | 'text_template' | 'html' | 'quota_total' | 'enabled'>;

export type CustomerChanges = Partial<Pick<CustomerDetail, 'name' | 'enabled' | 'quota_total' | 'from_name' | 'subject' | 'reply_to' | 'text_template' | 'html'>>;

export type SendStatus = 'accepted' | 'failed' | 'pending' | 'unknown';

export type RequestRow = {
  id: number;
  customer_id: string;
  request_id: string;
  email: string;
  client_ip: string;
  status: SendStatus;
  created_at: number;
  updated_at: number;
  provider_message_id: string | null;
  error_code: string | null;
  error_detail: string | null;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

export type RequestPage = {
  total: number;
  page: number;
  page_size: number;
  items: RequestRow[];
};

export type RequestFilters = {
  page?: number;
  page_size?: number;
  customer_id?: string;
  status?: SendStatus | '';
  /** 邮箱的一部分，或完整的请求编号。 */
  q?: string;
  from?: number;
  to?: number;
};

/** 每个状态一个数组，下标与 Stats.days 对齐。 */
export type Series = Record<SendStatus, number[]>;

export type Stats = {
  /** 北京时间的日期，从早到晚，最后一项是今天。 */
  days: string[];
  /** 时间窗内没有任何发送的客户不会出现。 */
  customers: Record<string, Series>;
  /** 所有结果不明的记录数，不受时间窗限制。 */
  unresolved: number;
};

export type AdminApi = {
  session: () => Promise<Session>;
  login: (username: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  customers: () => Promise<Customer[]>;
  customer: (id: string) => Promise<CustomerDetail>;
  createCustomer: (input: NewCustomer) => Promise<CustomerSecret>;
  updateCustomer: (id: string, version: number, changes: CustomerChanges) => Promise<CustomerDetail>;
  resetKey: (id: string, version: number) => Promise<CustomerSecret>;
  stats: (days?: number) => Promise<Stats>;
  requests: (filters: RequestFilters) => Promise<RequestPage>;
  request: (id: number) => Promise<RequestRow>;
  resolve: (id: number, status: 'accepted' | 'failed', note?: string) => Promise<RequestRow>;
};

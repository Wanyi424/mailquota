import type { DailyStats, MailChanges, Page, RecordFilters, SendStatus, SessionApi, Tenant, TenantSummary } from '../types';

export type Session = {
  username: string;
  csrf_token: string;
  /** 实际发信地址，仅用于让邮件预览更接近真实收件效果。 */
  sender: string;
};

/** 完整密钥只在创建和重置的响应里出现一次。 */
export type TenantSecret = Tenant & { api_key: string };

export type NewTenant = {
  customer_id: string;
  name: string;
  login_name: string;
  password: string;
  from_name: string;
  subject: string;
  reply_to: string;
  html_template: string;
  text_template: string;
  quota_total: number;
  enabled: boolean;
};

export type TenantChanges = MailChanges & { name?: string; enabled?: boolean };

export type QuotaChange = {
  /** 幂等编号：带着同一个编号重试，不会重复调整。 */
  request_id: string;
  /** 正数增加，负数减少。 */
  delta: number;
  reason?: string;
};

export type QuotaAdjustment = {
  id: number;
  before_total: number;
  after_total: number;
  delta: number;
  reason: string | null;
  /** 操作的管理员账号。 */
  actor_id: string;
  request_id: string;
  created_at: string;
};

export type RequestRow = {
  /** 内部记录编号。数据库里是 64 位整数，所以按字符串传递。 */
  id: string;
  customer_id: string;
  tenant_name: string;
  request_id: string;
  email: string;
  /** 租户上报的用户 IP，可能没有。 */
  reported_client_ip: string | null;
  status: SendStatus;
  smtp_message_id: string | null;
  /** 邮件服务商接收时的原始答复。 */
  smtp_response: string | null;
  smtp_error_code: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
  resolved_at: string | null;
  resolved_by_id: string | null;
  resolution_note: string | null;
};

/** 当时实际发出的邮件。列表里没有这部分，读单条详情时才带上。 */
export type MailSnapshot = {
  from_email: string;
  from_name: string;
  reply_to: string | null;
  subject: string;
  html_body: string;
  text_body: string;
  /** 发送时使用的邮件配置版本。 */
  config_version: string;
};

export type RequestDetail = RequestRow & Partial<MailSnapshot>;

export type RequestFilters = RecordFilters & { customer_id?: string };

export type Stats = DailyStats & {
  /** 各租户近 7 天占用过的封数，以客户 ID 为键；这段时间没有发送的租户不会出现。 */
  week: Record<string, number>;
  /** 所有结果不明的记录数，不受时间窗和租户限制。 */
  unresolved: number;
};

export type AdminApi = SessionApi<Session> & {
  tenants: () => Promise<TenantSummary[]>;
  tenant: (id: string) => Promise<Tenant>;
  createTenant: (input: NewTenant) => Promise<TenantSecret>;
  updateTenant: (id: string, version: number, changes: TenantChanges) => Promise<Tenant>;
  resetKey: (id: string) => Promise<TenantSecret>;
  resetPassword: (id: string, password: string) => Promise<void>;
  adjustQuota: (id: string, change: QuotaChange) => Promise<QuotaAdjustment>;
  /** 某个租户的调额历史，新的在前。 */
  adjustments: (id: string, page: number) => Promise<Page<QuotaAdjustment>>;
  /** 按天的发送量。传 customerId 时只统计这个租户。 */
  stats: (days: number, customerId?: string) => Promise<Stats>;
  requests: (filters: RequestFilters) => Promise<Page<RequestRow>>;
  request: (id: string) => Promise<RequestDetail>;
  resolve: (id: string, status: 'accepted' | 'failed', note?: string) => Promise<RequestDetail>;
};

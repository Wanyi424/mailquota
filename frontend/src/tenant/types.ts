import type { DailyStats, MailChanges, Page, RecordFilters, SendStatus, SessionApi, Tenant } from '../types';

export type Session = {
  customer_id: string;
  /** 租户名称。 */
  name: string;
  login_name: string;
  csrf_token: string;
  /** 实际发信地址，仅用于让邮件预览更接近真实收件效果。 */
  sender: string;
};

/** 租户能看到的发送记录：没有正文、验证码和人工处理信息。 */
export type RequestRow = {
  /** 业务后端发起这次发送时带的编号，在一个租户内唯一。 */
  request_id: string;
  email: string;
  status: SendStatus;
  created_at: string;
  updated_at: string;
  /** 这封邮件里的验证码到什么时候为止有效。 */
  code_expires_at: string;
  /** 同一个邮箱最早什么时候可以再发。 */
  resend_available_at: string;
  smtp_message_id: string | null;
  smtp_error_code: string | null;
  smtp_error_detail: string | null;
};

export type Stats = DailyStats & {
  /** 近 7 天占用过的封数，用来估算额度还能用多久。 */
  week: number;
};

export type TenantApi = SessionApi<Session> & {
  /** 自己的资料、额度和邮件配置。 */
  me: () => Promise<Tenant>;
  saveMail: (version: number, changes: MailChanges) => Promise<Tenant>;
  requests: (filters: RecordFilters) => Promise<Page<RequestRow>>;
  stats: (days: number) => Promise<Stats>;
};

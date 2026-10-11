// 管理端和租户门户都会用到的数据形态。各自独有的类型放在 admin/types.ts 和 tenant/types.ts。

export type SendStatus = 'accepted' | 'failed' | 'pending' | 'unknown';

/** 每个状态一个数组，下标与 DailyStats.days 对齐。 */
export type Series = Record<SendStatus, number[]>;

/** 两个门户的统计接口共有的部分。 */
export type DailyStats = {
  /** 北京时间的日期，从早到晚，最后一项是今天。 */
  days: string[];
  series: Series;
};

export type Quota = {
  quota_total: number;
  used_count: number;
  /** 发送中或结果不明的邮件暂时占着的额度。 */
  reserved_count: number;
  available_count: number;
};

export type MailConfig = {
  from_name: string;
  subject: string;
  /** 没有设置时是 null 或空字符串。 */
  reply_to: string | null;
  html_template: string;
  text_template: string;
  /** 邮件配置的版本号，保存时带回去用于发现并发修改。 */
  version: number;
};

export type MailChanges = Partial<{ from_name: string; subject: string; reply_to: string; html_template: string; text_template: string }>;

export type TenantSummary = Quota & {
  tenant_id: string;
  /** 业务后端调用接口时使用的标识，创建后不可修改。 */
  customer_id: string;
  name: string;
  enabled: boolean;
  /** 租户门户的登录账号。 */
  login_name: string;
  created_at: string;
};

export type Tenant = TenantSummary & MailConfig & {
  last_login_at: string | null;
  /** 当前这把调用密钥的生成时间。完整密钥只在创建和重置时出现一次。 */
  api_key_created_at: string | null;
};

export type Page<T> = {
  total: number;
  page: number;
  page_size: number;
  items: T[];
};

export type RecordFilters = {
  page?: number;
  page_size?: number;
  status?: SendStatus | '';
  /** 邮箱的一部分，或完整的请求编号。 */
  q?: string;
  /** ISO 时间。 */
  from?: string;
  to?: string;
};

/** 读会话、登录、退出：两个门户的会话关卡只依赖这三个动作。 */
export type SessionApi<S> = {
  session: () => Promise<S>;
  login: (account: string, password: string) => Promise<S>;
  logout: () => Promise<void>;
};

import type { Customer, RequestRow, SendStatus, Series } from '../types';

// 管理端所有时间都按北京时间显示和分日，与后端统计口径一致。
const DAY = 86400000;
const UTC8 = 8 * 3600000;
const ZONE = 'Asia/Shanghai';

const numberFormat = new Intl.NumberFormat('zh-CN');
const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const clockFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const monthDayFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, month: 'long', day: 'numeric' });
const longDateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, year: 'numeric', month: 'long', day: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, weekday: 'short' });
const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', hourCycle: 'h23' });

export const formatNumber = (value: number | null | undefined) => numberFormat.format(value ?? 0);
export const formatDateTime = (value: number | null | undefined) => (value == null ? '—' : dateTimeFormat.format(new Date(value)));
export const formatLongDate = (now = Date.now()) => `${longDateFormat.format(new Date(now))} ${weekdayFormat.format(new Date(now))}`;

export const beijingDay = (value: number) => Math.floor((value + UTC8) / DAY);

export function formatRelative(value: number | null | undefined, now = Date.now()) {
  if (value == null) return '—';
  const elapsed = now - value;
  if (elapsed >= 0 && elapsed < 60000) return '刚刚';
  if (elapsed >= 0 && elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`;
  const days = beijingDay(now) - beijingDay(value);
  const clock = clockFormat.format(new Date(value));
  if (days === 0) return `今天 ${clock}`;
  if (days === 1) return `昨天 ${clock}`;
  if (days > 1 && days < 300) return `${monthDayFormat.format(new Date(value))} ${clock}`;
  return dateTimeFormat.format(new Date(value)).slice(0, 10);
}

/** 把接口返回的 2026-10-04 显示成「10月4日」。 */
export function formatDay(day: string) {
  const [, month, date] = day.split('-');
  return `${Number(month)}月${Number(date)}日`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 接口返回的日期是星期几。 */
export function weekdayOf(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
}

export function greeting(now = Date.now()) {
  const hour = Number(hourFormat.format(new Date(now)));
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 日期输入框的值（YYYY-MM-DD）转成北京时间当天的起点或终点。 */
export function dateBoundary(value: string | undefined, end = false) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期。');
  const result = Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+08:00`);
  if (!Number.isFinite(result) || result < 0) throw new Error('日期格式不正确。');
  return result;
}

export type RangePreset = 'today' | '7d' | '30d';
const RANGE_DAYS: Record<RangePreset, number> = { today: 1, '7d': 7, '30d': 30 };
/** 快捷时间范围的起点：含今天在内往前数 N 个北京日。 */
export const rangeStart = (preset: RangePreset, now = Date.now()) => (beijingDay(now) - RANGE_DAYS[preset] + 1) * DAY - UTC8;

/** 接口提交的是目标总额度，这里把「增加多少」换算过去并挡住非法输入。 */
export function quotaTarget(current: number, increase: string | number) {
  if (!/^\d+$/.test(String(increase))) throw new Error('请输入大于 0 的整数。');
  const amount = Number(increase);
  const target = current + amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(target)) throw new Error('增加量必须大于 0，且总额度不能超出可表示的整数范围。');
  return target;
}

export const STATUSES: SendStatus[] = ['accepted', 'failed', 'pending', 'unknown'];

export type Tone = 'ok' | 'danger' | 'info' | 'warn';
export const STATUS: Record<SendStatus, { label: string; tone: Tone }> = {
  accepted: { label: '已发出', tone: 'ok' },
  failed: { label: '未发出', tone: 'danger' },
  pending: { label: '发送中', tone: 'info' },
  unknown: { label: '结果不明', tone: 'warn' },
};

// 每个错误代码两种说法：列表里用的短语，和详情里用的完整一句。
const REASONS: Record<string, [brief: string, full: string]> = {
  SMTP_DEADLINE: ['服务商超时未答复', '15 秒内没有等到邮件服务商的答复'],
  SMTP_UNCERTAIN: ['传输途中连接断开', '邮件内容传输途中连接断开，服务商没有给出明确答复'],
  TRANSPORT_EXCEPTION: ['发送过程异常', '发送过程出现异常，无法判断服务商是否已经收下'],
  PROCESS_INTERRUPTED: ['被服务重启打断', '发送途中服务进程重启，结果没有来得及记录'],
  SETTLEMENT_UNAVAILABLE: ['结果没能入账', '发送结果没能写入账本'],
  SMTP_REJECTED: ['服务商拒收', '邮件服务商明确拒收了这封邮件'],
  SMTP_NOT_SUBMITTED: ['没能连上服务商', '还没开始传输邮件内容就失败了，多半是连接或登录服务商时出错'],
};

export const explainReason = (code: string | null) => (code ? REASONS[code]?.[1] ?? `错误代码 ${code}` : null);
export const briefReason = (code: string | null) => (code ? REASONS[code]?.[0] ?? code : '');

/** 用一句白话说明这条记录发生了什么、额度怎么算。 */
export function explainRecord(row: Pick<RequestRow, 'status' | 'error_code' | 'resolved_by'>) {
  const reason = explainReason(row.error_code);
  if (row.status === 'accepted') {
    return row.resolved_by
      ? `经 ${row.resolved_by} 人工核查，按已发出结算，计入已用 1 封。`
      : '邮件服务商已经收下这封邮件，计入已用 1 封。';
  }
  if (row.status === 'failed') {
    return row.resolved_by
      ? `经 ${row.resolved_by} 人工核查，按未发出结算，占用的 1 封额度已退回。`
      : `这封邮件没有发出${reason ? `：${reason}` : ''}。占用的 1 封额度已退回。`;
  }
  if (row.status === 'pending') return '正在发送，通常十几秒内会有结果。';
  return `${reason ?? '没有拿到邮件服务商的明确答复'}，无法确定这封邮件是否发出。验证码仍然有效，额度先占着 1 封，等你核查后结算。`;
}

/** 「已发出」最常被追问的是「那用户为什么没收到」，这句话提前回答。 */
export const recordCaveat = (row: Pick<RequestRow, 'status' | 'resolved_by'>) =>
  (row.status === 'accepted' && !row.resolved_by ? '收下不代表一定进入收件箱，也可能被归到垃圾邮件里。' : null);

/** 从提交到有结果用了多久。 */
export function formatElapsed(milliseconds: number) {
  if (milliseconds < 1000) return '不到 1 秒';
  if (milliseconds < 60000) return `${Math.round(milliseconds / 1000)} 秒`;
  return `${Math.round(milliseconds / 60000)} 分钟`;
}

export type QuotaHealth = 'unset' | 'empty' | 'low' | 'ok';
const LOW_RATIO = 0.1;
const LOW_DAYS = 7;

export function quotaHealth(customer: Pick<Customer, 'quota_total' | 'available_count'>, remainingDays: number | null = null): QuotaHealth {
  if (customer.quota_total === 0) return 'unset';
  if (customer.available_count <= 0) return 'empty';
  if (customer.available_count / customer.quota_total <= LOW_RATIO || (remainingDays !== null && remainingDays <= LOW_DAYS)) return 'low';
  return 'ok';
}

export const sumLast = (values: number[], days: number) => values.slice(-days).reduce((sum, n) => sum + n, 0);

export function mergeSeries(all: Series[], length: number): Series {
  const merged = Object.fromEntries(STATUSES.map(status => [status, Array<number>(length).fill(0)])) as Series;
  for (const series of all) for (const status of STATUSES) series[status].forEach((n, i) => { merged[status][i] += n; });
  return merged;
}

export type Forecast = {
  /** 近 7 天（含今天）消耗的封数。已发出和结果不明都占着额度。 */
  week: number;
  /** 按这个速度还能用几天；近 7 天没有消耗或已无可用额度时为 null。 */
  remainingDays: number | null;
};

export function forecast(series: Series | undefined, available: number): Forecast {
  const week = series ? sumLast(series.accepted, 7) + sumLast(series.unknown, 7) : 0;
  return { week, remainingDays: week > 0 && available > 0 ? available / (week / 7) : null };
}

export function formatDaysLeft(days: number) {
  if (days < 1) return '不到 1 天';
  if (days < 60) return `约 ${Math.round(days)} 天`;
  if (days < 365) return `约 ${Math.round(days / 30)} 个月`;
  return '一年以上';
}

const paceOf = (week: number) =>
  (week === 0 ? '近 7 天没有发送' : week >= 7 ? `近 7 天日均 ${formatNumber(Math.round(week / 7))} 封` : `近 7 天共 ${formatNumber(week)} 封`);

/** 「近 7 天日均 138 封，按这个速度约 9 天用完」这样的一句话。 */
export function describeForecast({ week, remainingDays }: Forecast) {
  const pace = paceOf(week);
  if (week === 0 || remainingDays === null) return pace;
  return remainingDays >= 365 ? `${pace}，按这个速度够用一年以上` : `${pace}，按这个速度${formatDaysLeft(remainingDays)}用完`;
}

/** 同一个预估拆成两段：还能用多久（主），依据是什么（次）。列表里分两行放，比一整句好扫读。 */
export function runway({ week, remainingDays }: Forecast, health: QuotaHealth) {
  if (health === 'unset') return { left: '—', basis: '还没有设置额度' };
  if (health === 'empty') return { left: '已用完', basis: paceOf(week) };
  return { left: remainingDays === null ? '—' : formatDaysLeft(remainingDays), basis: paceOf(week) };
}

export const HEALTH_LABEL: Record<QuotaHealth, string | null> = { unset: '未设置', empty: '已用完', low: '告急', ok: null };

export const initialOf = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?';

type ErrorLike = { code?: string; message?: string; retryAfter?: number };

export function explainError(error: unknown) {
  const value = (error ?? {}) as ErrorLike;
  if (value.code === 'EDIT_CONFLICT') return '这份配置刚刚在别处被改过。为了不覆盖那次修改，请重新读取后再保存。';
  if (value.code === 'STATE_CONFLICT') return '这条记录已经被处理过了，下面是最新结果。';
  if (value.code === 'CSRF_INVALID') return '登录安全信息已变化，请刷新页面后重试。未保存的内容请先自行复制保留。';
  if (value.code === 'ADMIN_AUTH_REQUIRED') return '登录已过期，请重新登录。';
  if (value.code === 'ADMIN_AUTH_INVALID') return '账号或密码不正确。';
  if (value.code === 'CUSTOMER_EXISTS') return '这个客户 ID 已经被使用，请换一个。';
  if (value.code === 'CUSTOMER_NOT_FOUND') return '客户不存在。';
  if (value.retryAfter) return `${value.message}，约 ${Math.max(1, Math.ceil(value.retryAfter / 60))} 分钟后可重试。`;
  return value.message || '操作未完成，请稍后重试。';
}

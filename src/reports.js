import { z } from 'zod';
import { customerId, pageFields, timeFields, orderedTimes } from './validation.js';

// 管理端和租户门户共用的只读查询：筛选条件相同，区别只在能看到哪些租户、哪些列。
const DAY = 86400000, UTC8 = 8 * 3600000;
const STATUSES = ['accepted', 'failed', 'unknown', 'pending'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const filters = { ...pageFields, status: z.enum(STATUSES).optional(), q: z.string().trim().toLowerCase().min(1).max(254).optional(), ...timeFields };
export const tenantRequestQuery = z.object(filters).strict().refine(orderedTimes);
export const adminRequestQuery = z.object({ ...filters, customer_id: customerId.optional() }).strict().refine(orderedTimes);

/** 发送记录的筛选与分页。传 tenantId 时只在这个租户内查找。 */
export async function listRequests(db, q, { tenantId, columns }) {
  const where = [], args = [];
  const param = value => `$${args.push(value)}`;
  if (tenantId) where.push(`r.tenant_id=${param(tenantId)}`);
  if (q.customer_id) where.push(`t.customer_id=${param(q.customer_id)}`);
  if (q.status) where.push(`r.status=${param(q.status)}`);
  if (q.q) {
    // 邮箱按包含匹配；整段是一个请求编号时同样命中，方便直接粘贴业务日志里的 UUID。
    const email = `r.email LIKE ${param(`%${q.q.replace(/[\\%_]/g, '\\$&')}%`)} ESCAPE '\\'`;
    where.push(UUID.test(q.q) ? `(${email} OR r.request_id=${param(q.q)})` : email);
  }
  if (q.from) where.push(`r.created_at>=${param(q.from)}`);
  if (q.to) where.push(`r.created_at<=${param(q.to)}`);
  const from = `FROM send_requests r JOIN tenants t ON t.id=r.tenant_id${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  const total = (await db.query(`SELECT count(*)::int AS n ${from}`, args)).rows[0].n;
  const { rows } = await db.query(`SELECT ${columns} ${from} ORDER BY r.created_at DESC, r.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, q.page_size, (q.page - 1) * q.page_size]);
  return { total, page: q.page, page_size: q.page_size, items: rows };
}

/**
 * 按北京时间分日的发送量。不传 tenantId 时是所有租户的合计。
 * week 是各租户近 7 天（含今天）占用过的额度，用来估算还能用多久，所以查询范围至少覆盖这 7 天。
 */
export async function dailyStats(db, now, days, tenantId) {
  const today = Math.floor((now + UTC8) / DAY), first = today - days + 1;
  const series = Object.fromEntries(STATUSES.map(status => [status, Array(days).fill(0)])), week = {};
  // status 条件让不限租户的查询走 (status, created_at) 索引，不随长期保留的历史一起变慢。
  const { rows } = await db.query(
    `SELECT t.customer_id, floor((extract(epoch FROM r.created_at) + ${UTC8 / 1000}) / ${DAY / 1000})::int AS day, r.status, count(*)::int AS n
     FROM send_requests r JOIN tenants t ON t.id=r.tenant_id
     WHERE r.status = ANY($1) AND r.created_at >= $2${tenantId ? ' AND r.tenant_id=$3' : ''}
     GROUP BY 1, 2, 3`,
    [STATUSES, new Date(Math.min(first, today - 6) * DAY - UTC8), ...(tenantId ? [tenantId] : [])]);
  for (const r of rows) {
    if (r.day > today) continue;
    if (r.day >= first) series[r.status][r.day - first] += r.n;
    // 已发出和结果不明都占着额度。
    if (r.day > today - 7 && (r.status === 'accepted' || r.status === 'unknown')) week[r.customer_id] = (week[r.customer_id] || 0) + r.n;
  }
  return { days: Array.from({ length: days }, (_, i) => new Date((first + i) * DAY).toISOString().slice(0, 10)), series, week };
}

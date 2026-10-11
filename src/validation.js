import { z } from 'zod';
import ipaddr from 'ipaddr.js';
export const email = z.string().trim().toLowerCase().max(254).email().refine(v => !/[\r\n,;]/.test(v));
export const customerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const requestId = z.uuid().transform(v => v.toLowerCase());
export const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const password = z.string().min(8).refine(v => Buffer.byteLength(v) <= 72);
export const loginName = z.string().trim().min(1).max(200);
const header = max => z.string().trim().min(1).max(max).refine(v => !/[\x00-\x1f\x7f]/.test(v));
export const template = max => z.string().min(1).refine(v => Buffer.byteLength(v) <= max && v.includes('{{code}}') && !/{{|}}/.test(v.replace(/{{(code|expires_minutes)}}/g, '')));
export const htmlSchema = template(256 * 1024);
export const mailFields = {
  from_name: header(100), subject: header(200), html_template: htmlSchema,
  text_template: template(16 * 1024), reply_to: z.union([z.literal(''), email, z.null()]),
};
export const version = integer.positive();
export const mailUpdate = z.object({version, ...z.object(mailFields).partial().shape}).strict().refine(v => Object.keys(v).length > 1);
export const createSchema = z.object({
  customer_id: customerId, name: header(200), login_name: loginName, password,
  ...mailFields, quota_total: integer.default(0), enabled: z.boolean().default(false),
}).strict();
export const updateSchema = z.object({
  version, name: header(200).optional(), enabled: z.boolean().optional(), ...z.object(mailFields).partial().shape,
}).strict().refine(v => Object.keys(v).length > 1);
export const quotaSchema = z.object({
  request_id: requestId, delta: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).refine(v => v !== 0),
  reason: z.string().trim().max(2000).nullable().optional(),
}).strict();
export const sendSchema = z.object({
  request_id: requestId, email,
  reported_client_ip: z.string().max(64).refine(v => !v.includes('%') && (ipaddr.IPv4.isValidFourPartDecimal(v) || (v.includes(':') && ipaddr.IPv6.isValid(v)))).transform(v => ipaddr.process(v).toString()).optional(),
}).strict();
export const verifySchema = z.object({email, code: z.string().regex(/^\d{6}$/)}).strict();
export const render = (value, code = '083721') => value.replace(/{{code}}/g, code).replace(/{{expires_minutes}}/g, '5');
export const positive = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// 格式不对时后面的检查照样会执行，所以上限按字符串比较，不用会对非数字抛错的 BigInt。
export const rowId = z.string().regex(/^[1-9]\d{0,18}$/).refine(v => v.length < 19 || v <= '9223372036854775807');
export const pageFields = {page: positive.default(1), page_size: positive.max(100).default(20)};
export const timeFields = {from: z.iso.datetime({offset:true}).optional(), to: z.iso.datetime({offset:true}).optional()};
export const orderedTimes = v => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to);

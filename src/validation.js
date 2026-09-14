import { z } from 'zod';
import ipaddr from 'ipaddr.js';
export const email = z.string().trim().toLowerCase().max(254).email().refine(v => !/[\r\n,;]/.test(v));
export const customerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const requestId = z.uuid().transform(v => v.toLowerCase());
const header = max => z.string().trim().min(1).max(max).refine(v => !/[\x00-\x1f\x7f]/.test(v));
export const template = max => z.string().min(1).refine(v => Buffer.byteLength(v) <= max && v.includes('{{code}}') && !v.replace(/{{(code|expires_minutes)}}/g, '').match(/{{|}}/));
export const htmlSchema = template(256 * 1024);
export const fields = {
  name: z.string().trim().min(1).max(200), from_name: header(100), subject: header(200),
  text_template: template(16 * 1024), reply_to: z.union([z.literal(''), email]),
};
export const createSchema = z.object({ customer_id: customerId, ...fields, quota_total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), enabled: z.boolean().default(false), html: htmlSchema }).strict();
export const customerSchema = z.object({ customer_id: customerId, ...fields, api_key: z.string().regex(/^[A-Za-z0-9_-]{43,}$/), enabled: z.boolean(), quota_total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), html_template: z.string().regex(/^[A-Za-z0-9_-]+\.html$/), version: z.number().int().positive().default(1) }).strict();
export const version = z.number().int().positive();
export const sendSchema = z.object({ request_id: requestId, email, client_ip: z.string().max(64).refine(v => !v.includes('%') && (ipaddr.IPv4.isValidFourPartDecimal(v) || (v.includes(':') && ipaddr.IPv6.isValid(v)))).transform(v => ipaddr.process(v).toString()) }).strict();
export const verifySchema = z.object({ email, code: z.string().regex(/^\d{6}$/) }).strict();
export const render = (value, code = '083721') => value.replace(/{{code}}/g, code).replace(/{{expires_minutes}}/g, '5');

import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, fail, parse } from './errors.js';
import { fields, version, sendSchema, verifySchema, requestId, email, htmlSchema, render } from './validation.js';
import { requestData, sendResponse } from './service.js';

export function createApp({ service, config, admin, secure = new URL(admin.origin).protocol === 'https:', trustProxy = 'loopback', logger = () => {} }) {
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', trustProxy);
  app.use(helmet({ strictTransportSecurity: secure ? undefined : false, contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'https:', 'data:'], frameSrc: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: secure ? [] : null } } })); app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health/live', (req, res) => res.json({ status: 'live' }));
  app.get('/health/ready', (req, res, next) => { try { if (service.stopping) throw new Error('停止中'); config.check(); res.json({ status: 'ready' }); } catch (e) { next(e); } });
  app.use(['/api', '/admin'], (req, res, next) => { if (secure && !req.secure) return next(new AppError(400, 'HTTPS_REQUIRED', '请通过 HTTPS 访问')); next(); });
  app.use(express.json({ limit: '2mb', strict: true }));
  app.use('/api/v1', (req, res, next) => { try { req.customer = service.auth(req.get('X-Customer-Id'), req.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1]); parse(z.object({}).strict(), req.query); next(); } catch (e) { next(e); } });
  app.post('/api/v1/verification-codes/send', async (req, res) => sendResponse(res, await service.send(req.customer, parse(sendSchema, req.body))));
  app.get('/api/v1/verification-codes/requests/:requestId', (req, res) => {
    parse(z.object({}).strict(), req.query);
    const row = service.request(req.customer.customer_id, parse(requestId, req.params.requestId));
    if (!row) fail(404, 'REQUEST_NOT_FOUND', '发送记录不存在');
    ok(res, 'REQUEST_FOUND', requestData(row));
  });
  app.post('/api/v1/verification-codes/verify', (req, res) => { service.verify(req.customer, parse(verifySchema, req.body)); ok(res, 'VERIFIED', undefined, '验证成功'); });

  const sessions = new session.MemoryStore();
  app.use('/admin', session({ name: 'mailquota.sid', secret: admin.sessionSecret, store: sessions, resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure, sameSite: 'strict', maxAge: 8 * 3600000 } }));
  const loginFailures = new Map();
  const sameOrigin = (req) => req.get('Origin') === admin.origin;
  app.post('/admin/api/login', async (req, res) => {
    if (!sameOrigin(req)) fail(403, 'CSRF_INVALID', '请求来源无效');
    const body = parse(z.object({ username: z.string().max(200), password: z.string().max(200) }).strict(), req.body);
    const t = service.now();
    let window = loginFailures.get(req.ip);
    if (!window || window.expires <= t) { window = { count: 0, expires: t + 900000 }; loginFailures.set(req.ip, window); }
    if (window.count >= 10) fail(429, 'LOGIN_RATE_LIMIT', '登录尝试过多，请稍后重试', { retry_after_seconds: Math.ceil((window.expires - t) / 1000) });
    // Reserve an attempt before the asynchronous password check to prevent concurrent bypass.
    window.count++;
    const matches = await bcrypt.compare(body.password, admin.passwordHash);
    if (!matches || body.username !== admin.username) fail(401, 'ADMIN_AUTH_INVALID', '账号或密码错误');
    window.count--;
    await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.admin = admin.username; req.session.csrf = randomBytes(32).toString('base64url');
    req.session.expiresAt = t + 8 * 3600000;
    ok(res, 'LOGGED_IN', { username: admin.username, csrf_token: req.session.csrf });
  });
  app.use('/admin/api', (req, res, next) => {
    if (!req.session.admin || req.session.expiresAt <= service.now()) return next(new AppError(401, 'ADMIN_AUTH_REQUIRED', '请先登录管理员账号'));
    if (!['GET', 'HEAD'].includes(req.method)) {
      const a = Buffer.from(req.get('X-CSRF-Token') || ''), b = Buffer.from(req.session.csrf);
      if (!sameOrigin(req) || a.length !== b.length || !timingSafeEqual(a, b)) return next(new AppError(403, 'CSRF_INVALID', '安全校验失败，请刷新重试'));
    }
    next();
  });
  app.get('/admin/api/session', (req, res) => ok(res, 'SESSION_FOUND', { username: req.session.admin, csrf_token: req.session.csrf }));
  app.post('/admin/api/logout', (req, res, next) => req.session.destroy(e => { if (e) return next(e); res.clearCookie('mailquota.sid', { httpOnly: true, secure, sameSite: 'strict' }); ok(res, 'LOGGED_OUT'); }));
  app.get('/admin/api/customers', (req, res) => {
    const q = parse(z.object({ page: positive.default(1), page_size: positive.max(100).default(20) }).strict(), req.query);
    const all = [...config.customers.values()]; ok(res, 'CUSTOMERS_FOUND', { total: all.length, ...q, items: all.slice((q.page - 1) * q.page_size, q.page * q.page_size).map(c => config.public(c)) });
  });
  app.post('/admin/api/customers', (req, res) => { const c = config.create(req.body); audit('customer_created', c.customer_id); ok(res.status(201), 'CUSTOMER_CREATED', { ...config.public(c), api_key: c.api_key }); });
  app.get('/admin/api/customers/:id', (req, res) => ok(res, 'CUSTOMER_FOUND', config.public(config.require(req.params.id))));
  app.patch('/admin/api/customers/:id', (req, res) => {
    const { version: v, ...changes } = parse(z.object({ version, name: fields.name }).strict(), req.body);
    const c = config.update(req.params.id, v, changes); audit('customer_updated', c.customer_id); ok(res, 'CUSTOMER_UPDATED', config.public(c));
  });
  app.put('/admin/api/customers/:id/enabled', (req, res) => {
    const b = parse(z.object({ version, enabled: z.boolean(), confirmed: z.literal(true) }).strict(), req.body);
    const c = config.update(req.params.id, b.version, { enabled: b.enabled }); audit('customer_enabled_changed', c.customer_id); ok(res, 'CUSTOMER_UPDATED', config.public(c));
  });
  app.post('/admin/api/customers/:id/key/reset', (req, res) => {
    const b = parse(z.object({ version, confirmed: z.literal(true) }).strict(), req.body);
    const c = config.update(req.params.id, b.version, { api_key: randomBytes(32).toString('base64url') }); audit('customer_key_reset', c.customer_id); ok(res, 'KEY_RESET', { ...config.public(c), api_key: c.api_key });
  });
  app.put('/admin/api/customers/:id/quota', (req, res) => {
    const b = parse(z.object({ version, quota_total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(), req.body);
    const c = config.update(req.params.id, b.version, { quota_total: b.quota_total }); audit('quota_updated', c.customer_id); ok(res, 'QUOTA_UPDATED', config.public(c));
  });
  app.put('/admin/api/customers/:id/mail', (req, res) => {
    const { version: v, ...b } = parse(z.object({ version, from_name: fields.from_name, subject: fields.subject, reply_to: fields.reply_to, text_template: fields.text_template }).strict(), req.body);
    const c = config.update(req.params.id, v, b); audit('mail_updated', c.customer_id); ok(res, 'MAIL_UPDATED', config.public(c));
  });
  app.get('/admin/api/customers/:id/template', (req, res) => { const c = config.require(req.params.id); ok(res, 'TEMPLATE_FOUND', { html: c.html, version: c.version }); });
  app.put('/admin/api/customers/:id/template', (req, res) => {
    const b = parse(z.object({ version, html: htmlSchema }).strict(), req.body);
    const c = config.update(req.params.id, b.version, {}, b.html); audit('template_updated', c.customer_id); ok(res, 'TEMPLATE_UPDATED', { version: c.version });
  });
  app.post('/admin/api/template/preview', (req, res) => {
    const b = parse(z.object({ html: htmlSchema }).strict(), req.body);
    res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
    res.type('html').send(render(b.html));
  });
  app.get('/admin/api/requests', (req, res) => {
    const q = parse(z.object({ page: positive.default(1), page_size: positive.max(100).default(20), customer_id: z.string().max(64).optional(), status: z.enum(['pending', 'accepted', 'failed', 'unknown']).optional(), email: email.optional(), from: z.coerce.number().int().nonnegative().optional(), to: z.coerce.number().int().nonnegative().optional() }).strict().refine(v => v.from === undefined || v.to === undefined || v.from <= v.to), req.query);
    const clauses = [], args = [];
    for (const key of ['customer_id', 'status', 'email']) if (q[key] !== undefined) { clauses.push(`${key}=?`); args.push(q[key]); }
    if (q.from !== undefined) { clauses.push('created_at>=?'); args.push(q.from); }
    if (q.to !== undefined) { clauses.push('created_at<=?'); args.push(q.to); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = service.db.prepare(`SELECT count(*) AS n FROM send_requests ${where}`).get(...args).n;
    const items = service.db.prepare(`SELECT * FROM send_requests ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size);
    ok(res, 'REQUESTS_FOUND', { total, page: q.page, page_size: q.page_size, items });
  });
  app.post('/admin/api/requests/:id/resolve', (req, res) => {
    const id = parse(positive, req.params.id);
    const b = parse(z.object({ status: z.enum(['accepted', 'failed']), note: z.string().trim().min(1).max(2000), confirmed: z.literal(true) }).strict(), req.body);
    ok(res, 'REQUEST_RESOLVED', service.settle(id, 'unknown', { status: b.status }, { name: req.session.admin, note: b.note }));
  });
  function audit(event, customer_id) { logger({ event, customer_id }); }
  // Only the packaged admin UI is public. Storage, configuration and templates are never static roots.
  const adminPublic = fileURLToPath(new URL('../public/admin/', import.meta.url));
  app.get('/', (req, res) => res.redirect('/admin/'));
  app.get('/admin', (req, res, next) => req.path.endsWith('/') ? next() : res.redirect('/admin/'));
  app.get('/admin/', (req, res) => res.sendFile(join(adminPublic, 'index.html')));
  app.use('/admin/assets', express.static(adminPublic, { index: false, dotfiles: 'deny', redirect: false }));
  // BrowserRouter routes are served by the same packaged entrypoint. API and asset paths stay JSON/static boundaries.
  app.get(/^\/admin\/(?!api(?:\/|$)|assets(?:\/|$)).+$/, (req, res) => res.sendFile(join(adminPublic, 'index.html')));
  app.use((req, res) => res.status(404).json({ success: false, code: 'NOT_FOUND', message: '接口不存在' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let e = error;
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') e = new AppError(400, 'INVALID_ARGUMENT', 'JSON 格式错误或请求体过大');
    if (!(e instanceof AppError)) { logger({ event: 'service_error', code: 'SERVICE_UNAVAILABLE' }); e = new AppError(503, 'SERVICE_UNAVAILABLE', '服务暂不可用，请稍后重试'); }
    if (e.status === 429) res.set('Retry-After', String(e.data.retry_after_seconds));
    res.status(e.status).json({ success: false, code: e.code, message: e.message, ...(e.data ? { data: e.data, ...(e.status === 429 ? { retry_after_seconds: e.data.retry_after_seconds } : {}) } : {}) });
  });
  const clean = setInterval(() => {
    const now = service.now(); for (const [key, w] of loginFailures) if (w.expires <= now) loginFailures.delete(key);
    sessions.all((error, all) => { if (!error) for (const [id, s] of Object.entries(all)) if (s.expiresAt <= now) sessions.destroy(id); });
  }, 60000); clean.unref();
  app.locals.dispose = () => { clearInterval(clean); sessions.clear(); };
  return app;
}
const positive = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ok = (res, code, data, message = '操作成功') => res.json({ success: true, code, message, ...(data === undefined ? {} : { data }) });

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fixture, origin, password } from './helpers.js';
import { createApi, ApiError } from '../frontend/src/api.ts';
import { quotaTarget, dateBoundary, previewDocument, validateTemplate } from '../frontend/src/helpers.ts';
import { defaultTemplate, defaultText } from '../frontend/src/default-template.ts';

// Exercise the actual browser API module against Express + sessions + SQLite, not duplicated URLs.
function frontend(f) {
  const agent = request.agent(f.app), calls = [];
  let expired = 0;
  const api = createApi({ onExpired: () => { expired++; }, fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers });
    let req = agent[options.method.toLowerCase()](url);
    for (const [key, value] of Object.entries(options.headers)) req = req.set(key, value);
    // A browser adds Origin to same-origin POST/PATCH/PUT and owns Cookie handling.
    if (options.method !== 'GET') req = req.set('Origin', origin);
    if (options.body) req = req.send(options.body);
    const result = await req;
    return new Response(result.text, { status: result.status, headers: result.headers });
  } });
  return { api, calls, expired: () => expired };
}

test('管理页面与全部模块同源提供，HTTPS和敏感目录边界保持有效', async t => {
  const f = fixture(t), secure = fixture(t, { secure: true });
  assert.equal((await request(f.app).get('/')).headers.location, '/admin/');
  assert.equal((await request(f.app).get('/admin')).headers.location, '/admin/');
  const index = await request(f.app).get('/admin/');
  assert.equal(index.status, 200); assert.match(index.headers['content-type'], /text\/html/);
  assert.match(index.text, /type="module"[^>]+src="\/admin\/assets\/assets\/index-[^"]+\.js"/);
  assert.match(index.headers['cache-control'], /no-store/);
  assert.match(index.headers['content-security-policy'], /script-src 'self'/);
  assert.match(index.headers['content-security-policy'], /frame-src 'self'/);
  const script = index.text.match(/src="([^"]+\.js)"/)?.[1];
  const stylesheet = index.text.match(/href="([^"]+\.css)"/)?.[1];
  assert(script); assert(stylesheet);
  assert.equal((await request(f.app).get(script)).status, 200);
  assert.equal((await request(f.app).get(stylesheet)).status, 200);
  assert.equal((await request(f.app).get('/admin/customers')).status, 200);
  assert.equal((await request(f.app).get('/admin/records?status=unknown')).status, 200);
  assert.equal((await request(f.app).get('/admin/api/unknown')).status, 401);
  const icons = await request(f.app).get('/admin/assets/icons/lucide.svg');
  assert.equal(icons.status, 200); assert.match(icons.headers['content-type'], /image\/svg\+xml/);
  const sprite = Buffer.isBuffer(icons.body) ? icons.body.toString('utf8') : icons.text;
  assert.match(sprite, /<symbol id="eye"/); assert.match(sprite, /<symbol id="eye-off"/);
  for (const path of ['/config/customers.json', '/storage/data/mailquota.sqlite', '/admin/assets/.env', '/admin/assets/config/customers.json', '/templates/default.html']) assert.equal((await request(f.app).get(path)).status, 404, path);
  assert.equal((await request(f.app).get('/admin/api/customers')).status, 401);
  assert.equal((await request(secure.app).get('/admin/')).body.code, 'HTTPS_REQUIRED');
  assert.equal((await request(secure.app).get('/admin/').set('X-Forwarded-Proto', 'https')).status, 200);
  assert.match(readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8'), /frontend-build/);
});

test('前端API完整管理工作流：会话、创建、版本、增额、启停、邮件、模板、密钥、退出', async t => {
  const f = fixture(t), front = frontend(f), { api, calls } = front;
  await assert.rejects(api.session(), { code: 'ADMIN_AUTH_REQUIRED' }); assert.equal(front.expired(), 1);
  await assert.rejects(api.login('admin', 'incorrect'), { code: 'ADMIN_AUTH_INVALID' }); assert.equal(front.expired(), 1);
  const logged = await api.login('admin', password); assert.equal(logged.username, 'admin'); assert(logged.csrf_token);
  assert.equal((await api.session()).csrf_token, logged.csrf_token);
  let c = await api.createCustomer({ customer_id: 'front_a', name: '前端联调客户', from_name: '星河', subject: '邮箱验证码', quota_total: 0, enabled: false, reply_to: '', text_template: defaultText, html: defaultTemplate });
  const firstKey = c.api_key; assert(firstKey); assert.equal(c.available_count, 0); assert.equal(c.enabled, false);
  const list = await api.customers(1, 20); assert.equal(list.items[0].api_key, undefined); assert.equal(list.total, 1); assert.equal(list.page_size, 20);
  c = await api.customer(c.customer_id); assert.equal(c.api_key, undefined);
  c = await api.rename(c.customer_id, c.version, '客户新名称'); assert.equal(c.version, 2);
  c = await api.setQuota(c.customer_id, c.version, quotaTarget(c.quota_total, '1000')); assert.equal(c.quota_total, 1000);
  const count = calls.length;
  await assert.rejects(api.setQuota(c.customer_id, c.version - 1, 2000), { code: 'EDIT_CONFLICT' });
  assert.equal(calls.length, count + 1, 'Writes must not auto retry'); assert.equal((await api.customer(c.customer_id)).quota_total, 1000);
  c = await api.setEnabled(c.customer_id, c.version, true); assert(c.enabled);
  c = await api.saveMail(c.customer_id, c.version, { from_name: '客户发件昵称', subject: '客户标题', reply_to: 'reply@example.com', text_template: '验证码 {{code}}，{{expires_minutes}} 分钟有效。', unused: 'not forwarded' });
  assert.equal(c.from_name, '客户发件昵称');
  const template = await api.template(c.customer_id); assert.equal(template.version, c.version); assert.equal(template.html, defaultTemplate);
  const newHtml = '<h1>客户独立样式</h1><p>{{code}} · {{expires_minutes}}</p>';
  const saved = await api.saveTemplate(c.customer_id, c.version, newHtml); assert.equal(saved.version, c.version + 1);
  const preview = await api.preview(newHtml); assert.match(preview, /083721 · 5/); assert.equal(f.mails.length, 0);
  c = await api.customer(c.customer_id); assert.equal(c.version, saved.version);
  c = await api.resetKey(c.customer_id, c.version); assert.notEqual(c.api_key, firstKey); assert.equal(c.quota_total, 1000);
  assert.throws(() => f.service.auth(c.customer_id, firstKey), { code: 'AUTH_INVALID' });
  await api.logout(); await assert.rejects(api.session(), { code: 'ADMIN_AUTH_REQUIRED' });
  const writes = calls.filter(call => call.method !== 'GET' && !call.url.endsWith('/login'));
  assert(writes.every(call => call.headers['X-CSRF-Token'] === logged.csrf_token));
  assert(calls.every(call => !JSON.stringify(call.body || {}).includes('purpose')));
});

test('前端记录筛选、分页和人工结算对接真实占用与冲突响应', async t => {
  const f = fixture(t, { send: () => ({ status: 'unknown', errorCode: 'SMTP_UNKNOWN' }) }), customer = f.customer('resolve_a');
  await f.service.send(customer, f.input('first@example.com'));
  f.advance(10); await f.service.send(customer, f.input('second@example.com'));
  const { api, calls } = frontend(f); await api.login('admin', password);
  const result = await api.requests({ page: 1, page_size: 1, status: 'unknown', customer_id: 'resolve_a', email: '', from: f.now() - 100, to: f.now() });
  assert.equal(result.total, 2); assert.equal(result.items.length, 1);
  const second = await api.requests({ page: 2, page_size: 1, status: 'unknown', customer_id: 'resolve_a' });
  assert.notEqual(second.items[0].id, result.items[0].id);
  const match = await api.requests({ page: 1, page_size: 20, email: 'first@example.com', from: undefined, to: '' });
  assert.equal(match.total, 1); assert.equal(match.items[0].code, undefined);
  const row = match.items[0];
  const resolved = await api.resolve(row.id, 'accepted', '控制台已核查受理'); assert.equal(resolved.status, 'accepted'); assert.equal(resolved.resolution_note, '控制台已核查受理');
  assert.equal(f.usage(customer).used_count, 1); assert.equal(f.usage(customer).reserved_count, 1);
  const before = calls.length; await assert.rejects(api.resolve(row.id, 'failed', '重复处理'), { code: 'STATE_CONFLICT' }); assert.equal(calls.length, before + 1);
  const remaining = await api.requests({ status: 'unknown', page: 1, page_size: 20 }); assert.equal(remaining.total, 1);
  await api.resolve(remaining.items[0].id, 'failed', '核查后释放占用'); assert.equal(f.usage(customer).reserved_count, 0); assert.equal(f.usage(customer).used_count, 1);
  assert.equal(f.mails.length, 2, 'Admin operations never send email');
});

test('前端网络异常不重发写操作，限流保留等待时间，预览JSON错误不当作HTML', async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async () => { calls++; throw new Error('connection lost'); } });
  await assert.rejects(api.resetKey('a', 1), error => error instanceof ApiError && /结果尚未确认/.test(error.message)); assert.equal(calls, 1);
  const limited = createApi({ fetchImpl: async () => new Response(JSON.stringify({ success: false, code: 'LOGIN_RATE_LIMIT', message: '登录尝试过多', data: { retry_after_seconds: 73 } }), { status: 429, headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(limited.login('admin', 'password'), error => error.code === 'LOGIN_RATE_LIMIT' && error.retryAfter === 73);
  const invalidPreview = createApi({ fetchImpl: async () => new Response(JSON.stringify({ success: false, code: 'INVALID_ARGUMENT', message: '模板错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(invalidPreview.preview('bad'), { code: 'INVALID_ARGUMENT' });
});

test('前端额度边界、北京时间筛选、模板约束与srcdoc隔离契约', () => {
  assert.equal(quotaTarget(1000, '200'), 1200);
  for (const amount of ['', '0', '-1', '1.5', '1e3', '9999999999999999']) assert.throws(() => quotaTarget(1, amount));
  assert.throws(() => quotaTarget(Number.MAX_SAFE_INTEGER, '1'));
  assert.equal(dateBoundary('2026-09-14'), Date.parse('2026-09-13T16:00:00Z'));
  assert.equal(dateBoundary('2026-09-14', true) - dateBoundary('2026-09-14'), 86400000 - 1);
  assert.equal(dateBoundary(''), undefined);
  assert.equal(validateTemplate(defaultTemplate), defaultTemplate);
  for (const html of ['missing', '{{code}} {{other}}', '{{code}} {{']) assert.throws(() => validateTemplate(html));
  assert.throws(() => validateTemplate('{{code}}' + '中'.repeat(100), 100));
  const unsafe = '<script>parent.document.cookie</script><h1>083721</h1>';
  const document = previewDocument(unsafe);
  assert(document.indexOf('Content-Security-Policy') < document.indexOf('<script>'));
  assert.match(document, /script-src 'none'/); assert.match(document, /base-uri 'none'/);
  const source = readFileSync(new URL('../frontend/src/pages/templates.tsx', import.meta.url), 'utf8');
  assert.match(source, /sandbox="" referrerPolicy="no-referrer"/); assert.doesNotMatch(source, /allow-scripts|allow-same-origin/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { fixture, origin, password } from './helpers.js';

async function createTenant(f, agent, csrf, id = 'tenant_a') {
  const r = await agent.post('/admin/api/tenants').set('Origin', origin).set('X-CSRF-Token', csrf).send({
    customer_id: id, name: id, login_name: id, password,
    from_name: 'Sender', subject: 'Code', html_template: '<p>{{code}}</p>',
    text_template: 'Code {{code}}', reply_to: '', quota_total: 10, enabled: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}

test('管理员和租户会话、CSRF、数据权限相互隔离', async t => {
  const f = await fixture(t), { agent, csrf } = await f.login();
  const tenant = await createTenant(f, agent, csrf);
  const tenantAgent = request.agent(f.app);
  const login = await tenantAgent.post('/tenant/api/login').set('Origin', origin).send({ login_name: tenant.login_name, password });
  assert.equal(login.status, 200);
  const tenantCsrf = login.body.data.csrf_token;
  assert.equal((await tenantAgent.get('/tenant/api/quota')).status, 200);
  assert.equal((await tenantAgent.get('/admin/api/tenants')).status, 401);
  assert.equal((await tenantAgent.patch('/tenant/api/config').set('Origin', origin).send({ version: 1, subject: 'blocked' })).status, 403);
  const updated = await tenantAgent.patch('/tenant/api/config').set('Origin', origin).set('X-CSRF-Token', tenantCsrf).send({ version: 1, subject: 'Updated' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.subject, 'Updated');
  assert.equal((await agent.get('/admin/api/tenants/tenant_a')).body.data.subject, 'Updated');
});

test('管理员和租户登录失败达到十次后暂时锁定', async t => {
  const f = await fixture(t), setup = await f.login();
  await createTenant(f, setup.agent, setup.csrf);
  const agent = request.agent(f.app);
  for (let i = 0; i < 10; i++) {
    const result = await agent.post('/admin/api/login').set('Origin', origin).send({ username: 'admin', password: 'wrong-password' });
    assert.equal(result.status, 401);
  }
  const blockedAdmin = await agent.post('/admin/api/login').set('Origin', origin).send({ username: 'admin', password });
  assert.equal(blockedAdmin.status, 429);
  const tenant = request.agent(f.app);
  for (let i = 0; i < 10; i++) {
    const result = await tenant.post('/tenant/api/login').set('Origin', origin).send({ login_name: 'tenant_a', password: 'wrong-password' });
    assert.equal(result.status, 401);
  }
  assert.equal((await tenant.post('/tenant/api/login').set('Origin', origin).send({ login_name: 'tenant_a', password })).status, 429);
});

test('管理员创建租户、重置 API Key 和额度增减', async t => {
  const f = await fixture(t), { agent, csrf } = await f.login();
  const tenant = await createTenant(f, agent, csrf);
  assert.equal(typeof tenant.api_key, 'string');
  const key = await agent.post('/admin/api/tenants/tenant_a/api-key').set('Origin', origin).set('X-CSRF-Token', csrf).send({});
  assert.equal(key.status, 200);
  assert.notEqual(key.body.data.api_key, tenant.api_key);
  const add = await agent.post('/admin/api/tenants/tenant_a/quota').set('Origin', origin).set('X-CSRF-Token', csrf).send({ request_id: randomUUID(), delta: 5 });
  assert.equal(add.status, 200);
  const decrease = await agent.post('/admin/api/tenants/tenant_a/quota').set('Origin', origin).set('X-CSRF-Token', csrf).send({ request_id: randomUUID(), delta: -3, reason: '测试扣减' });
  assert.equal(decrease.status, 200);
  const details = await agent.get('/admin/api/quota-details');
  assert.equal(details.status, 200);
   assert.equal(details.body.data.items.length, 2);
   const history = await agent.get('/admin/api/tenants/tenant_a/quota-adjustments?page=1&page_size=10');
   assert.equal(history.status, 200);
   assert.equal(history.body.data.total, 2);
 });

test('管理员发送记录、详情、unknown 处理和统计接口', async t => {
  const f = await fixture(t, { send: () => ({ status: 'unknown', error_code: 'SMTP_UNCERTAIN' }) });
  const { agent, csrf } = await f.login();
  await createTenant(f, agent, csrf);
  const tenant = await f.config.requireCustomer('tenant_a');
  const first = await f.service.send(tenant, f.input('first@example.com'));
  await f.service.send(tenant, f.input('second@example.com'));
  const filtered = await agent.get('/admin/api/requests?customer_id=tenant_a&status=unknown&q=first&page=1&page_size=1');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.data.total, 1);
  assert.equal(filtered.body.data.items.length, 1);
  const detail = await agent.get(`/admin/api/requests/${first.id}`);
  assert.equal(detail.status, 200);
  assert.equal(typeof detail.body.data.html_body, 'string');
  const stats = await agent.get('/admin/api/stats?days=7&customer_id=tenant_a');
  assert.equal(stats.status, 200);
  const resolved = await agent.post(`/admin/api/requests/${first.id}/resolve`).set('Origin', origin).set('X-CSRF-Token', csrf).send({ status: 'failed' });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.status, 'failed');
});

test('创建租户时 customer_id 和 login_name 重复返回 409', async t => {
  const f = await fixture(t), { agent, csrf } = await f.login();
  await createTenant(f, agent, csrf);
  const body = { customer_id:'tenant_a', name:'另一个租户', login_name:'another', password, from_name:'网站', subject:'验证码', html_template:'<p>{{code}}</p>', text_template:'{{code}}', reply_to:'', quota_total:1, enabled:true };
  const duplicateCustomer = await agent.post('/admin/api/tenants').set('Origin', origin).set('X-CSRF-Token', csrf).send(body);
  assert.equal(duplicateCustomer.status, 409);
  assert.equal(duplicateCustomer.body.code, 'TENANT_EXISTS');
  const duplicateLogin = await agent.post('/admin/api/tenants').set('Origin', origin).set('X-CSRF-Token', csrf).send({ ...body, customer_id:'tenant_b', login_name:'tenant_a' });
  assert.equal(duplicateLogin.status, 409);
  assert.equal(duplicateLogin.body.code, 'LOGIN_NAME_EXISTS');
});

test('API Key 与 X-Customer-Id 必须匹配，停用后拒绝业务 API', async t => {
  const f = await fixture(t), { agent, csrf } = await f.login();
  const a = await createTenant(f, agent, csrf, 'tenant_a');
  const b = await createTenant(f, agent, csrf, 'tenant_b');
  const wrong = await request(f.app).post('/api/v1/verification-codes/send').set('X-Customer-Id', 'tenant_b').set('Authorization', `Bearer ${a.api_key}`).send({ request_id: randomUUID(), email: 'x@example.com' });
  assert.equal(wrong.status, 401);
  const disabled = await agent.patch('/admin/api/tenants/tenant_a').set('Origin', origin).set('X-CSRF-Token', csrf).send({ version: 1, enabled: false });
  assert.equal(disabled.status, 200);
  const rejected = await request(f.app).post('/api/v1/verification-codes/send').set('X-Customer-Id', 'tenant_a').set('Authorization', `Bearer ${a.api_key}`).send({ request_id: randomUUID(), email: 'x@example.com' });
  assert.equal(rejected.body.code, 'TENANT_DISABLED');
});

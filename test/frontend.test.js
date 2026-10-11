import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fixture, origin, password } from './helpers.js';

test('管理员和租户前端页面资源可访问，敏感文件不被静态暴露', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.app).get('/admin/')).status, 200);
  assert.equal((await request(f.app).get('/admin/assets/.env')).status, 404);
  assert.equal((await request(f.app).get('/storage/')).status, 404);
});
test('租户前端登录、额度和配置接口可以完成基本流程', async t => {
  const f = await fixture(t), admin = await f.login();
  const created = await admin.agent.post('/admin/api/tenants').set('Origin', origin).set('X-CSRF-Token', admin.csrf).send({
    customer_id:'front_tenant',name:'前端租户',login_name:'front_tenant',password,
    from_name:'网站',subject:'验证码',html_template:'<p>{{code}}</p>',
    text_template:'验证码 {{code}}',reply_to:'',quota_total:10,enabled:true,
  });
  assert.equal(created.status, 201);
  const tenant = request.agent(f.app);
  const invalidLogin = await tenant.post('/tenant/api/login').set('Origin', origin).send({ login_name: 'x'.repeat(201), password });
  assert.equal(invalidLogin.status, 400);
  const login = await tenant.post('/tenant/api/login').set('Origin', origin).send({login_name:'front_tenant',password});
  assert.equal(login.status, 200);
  assert.equal((await tenant.get('/tenant/api/quota')).body.data.available_count, 10);
  const csrf = login.body.data.csrf_token;
  const config = await tenant.patch('/tenant/api/config').set('Origin', origin).set('X-CSRF-Token', csrf).send({version:1,subject:'新验证码'});
  assert.equal(config.status, 200);
  assert.equal(config.body.data.subject, '新验证码');
  assert.equal((await tenant.get('/tenant/api/requests?page=1&page_size=20')).status, 200);
  assert.equal((await tenant.get('/tenant/api/stats?days=7')).status, 200);
});

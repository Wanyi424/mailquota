import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, gate } from './helpers.js';
import { MailService } from '../src/service.js';

test('客户隔离、独立模板、额度耗尽仍可核销、停用拒绝所有 API', async t => {
  const f = fixture(t), a = f.customer('a', 1), b = f.customer('b', 1);
  for (const c of [a, b]) assert.equal((await f.api(c, 'post', '/send', f.input())).body.code, 'SEND_ACCEPTED');
  assert.match(f.mails[0].html, /a:/); assert.match(f.mails[1].html, /b:/);
  assert.equal(f.mails[0].fromName, 'Sender a'); assert.equal(f.mails[1].subject, 'Subject b');
  assert.equal(f.mails[0].text, `a: ${f.code(a).code} 5`);
  assert.equal((await f.api(a, 'post', '/send', f.input('other@example.com'))).body.code, 'QUOTA_EXHAUSTED');
  const bRequest = f.db.prepare('SELECT request_id FROM send_requests WHERE customer_id=?').get('b').request_id;
  assert.equal((await f.api(a, 'get', `/requests/${bRequest}`)).status, 404);
  assert.equal((await f.api(a, 'post', '/verify', { email: 'user@example.com', code: f.code(a).code })).body.code, 'VERIFIED');
  f.config.update('a', a.version, { enabled: false });
  for (const [method, path, body] of [['post', '/send', f.input()], ['post', '/verify', { email: 'user@example.com', code: '000000' }], ['get', `/requests/${bRequest}`]]) assert.equal((await f.api(a, method, path, body)).status, 403);
});
test('最后 1 次额度并发只发 1 封，同请求并发幂等、参数冲突、时间不续期', async t => {
  const g = gate(), f = fixture(t, { send: () => g.promise }), c = f.customer('a', 1), input = f.input();
  const first = f.service.send(c, input); await Promise.resolve();
  const duplicate = await f.service.send(c, input); assert.equal(duplicate.status, 'pending');
  await assert.rejects(f.service.send(c, { ...input, email: 'different@example.com' }), { code: 'REQUEST_CONFLICT' });
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => f.service.send(c, f.input(`${i}@example.com`))));
  assert(results.every(r => r.status === 'rejected' && r.reason.code === 'QUOTA_EXHAUSTED'));
  assert.equal(f.mails.length, 1); assert.equal(f.usage(c).reserved_count, 1);
  const expiry = f.code(c).expires_at; g.resolve({ status: 'accepted' }); await first;
  f.advance(1000); assert.equal((await f.service.send(c, input)).status, 'accepted');
  assert.equal(f.code(c).expires_at, expiry); assert.equal(f.usage(c).used_count, 1);
  assert.equal(f.db.prepare("SELECT count FROM rate_limits WHERE limit_type='email_hour'").get().count, 1);
});
test('两个 SMTP 槽位满时拒绝新发送，不创建记录和占用', async t => {
  const g = gate(), f = fixture(t, { send: () => g.promise }), c = f.customer();
  const sends = ['a', 'b'].map(v => f.service.send(c, f.input(`${v}@example.com`)));
  await assert.rejects(f.service.send(c, f.input('c@example.com')), { code: 'SERVICE_BUSY' });
  assert.equal(f.usage(c).reserved_count, 2); assert.equal(f.db.prepare('SELECT count(*) n FROM send_requests').get().n, 2);
  g.resolve({ status: 'accepted' }); await Promise.all(sends);
});
test('明确失败释放占用、保留限流、旧请求不重发且验证码不可用', async t => {
  const f = fixture(t, { send: () => ({ status: 'failed', error_code: 'SMTP_REJECTED' }) }), c = f.customer(), input = f.input();
  assert.equal((await f.service.send(c, input)).status, 'failed'); assert.equal(f.usage(c).reserved_count, 0); assert.equal(f.usage(c).used_count, 0);
  assert.equal(f.code(c), undefined); await assert.rejects(f.service.send(c, f.input()), { code: 'EMAIL_COOLDOWN' });
  assert.equal((await f.service.send(c, input)).status, 'failed'); assert.equal(f.mails.length, 1);
});
test('超时保留占用，晚到 SMTP 结果隔离，人工处理只能一次', async t => {
  const g = gate(), f = fixture(t, { send: () => g.promise, deadlineMs: 20 }), c = f.customer(), input = f.input();
  const row = await f.service.send(c, input); assert.equal(row.status, 'unknown'); assert.equal(f.usage(c).reserved_count, 1);
  const result = f.service.settle(row.id, 'unknown', { status: 'accepted' }, { name: 'admin', note: '控制台已核查' });
  assert.equal(result.resolution_note, '控制台已核查');
  g.resolve({ status: 'failed' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.usage(c).used_count, 1); assert.equal(f.usage(c).reserved_count, 0);
  assert.throws(() => f.service.settle(row.id, 'unknown', { status: 'failed' }, { name: 'admin', note: '重复' }), { code: 'STATE_CONFLICT' });
});
test('结算写库失败不谎报结果、保留占用、重启恢复为 unknown 且不重发', async t => {
  const f = fixture(t), c = f.customer(), input = f.input();
  f.db.exec("CREATE TRIGGER fail_settlement BEFORE UPDATE ON send_requests BEGIN SELECT RAISE(ABORT,'injected'); END;");
  await assert.rejects(f.service.send(c, input), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.usage(c).reserved_count, 1); assert.equal(f.usage(c).used_count, 0);
  assert.equal(f.service.request('a', input.request_id).status, 'pending');
  f.db.exec('DROP TRIGGER fail_settlement');
  const restarted = new MailService(f.db, f.config, { send: () => { throw new Error('不得重发'); } });
  assert.equal((await restarted.send(c, input)).status, 'unknown'); assert.equal(f.mails.length, 1);
  restarted.settle(f.service.request('a', input.request_id).id, 'unknown', { status: 'failed' }, { name: 'admin', note: '核查后释放' });
  assert.equal(f.usage(c).reserved_count, 0);
});
test('错误次数持久化，第五次立即失效、格式错误不计数、5 分钟绝对到期', async t => {
  const f = fixture(t), c = f.customer(); await f.service.send(c, f.input());
  const real = f.code(c).code, wrong = real === '000000' ? '999999' : '000000';
  assert.equal((await f.api(c, 'post', '/verify', { email: 'user@example.com', code: 'abc' })).body.code, 'INVALID_ARGUMENT');
  assert.equal(f.code(c).attempts, 0);
  for (let i = 0; i < 5; i++) assert.throws(() => f.service.verify(c, { email: 'user@example.com', code: wrong }), { code: i === 4 ? 'CODE_ATTEMPTS_EXCEEDED' : 'CODE_INVALID' });
  assert.equal(f.code(c).attempts, 5); assert.throws(() => f.service.verify(c, { email: 'user@example.com', code: real }), { code: 'CODE_ATTEMPTS_EXCEEDED' });
  f.advance(60000); await f.service.send(c, f.input()); const expiry = f.code(c).expires_at;
  f.advance(300000); assert.equal(f.now(), expiry); assert.throws(() => f.service.verify(c, { email: 'user@example.com', code: f.code(c).code }), { code: 'CODE_EXPIRED' });
});
test('并发正确核验只能成功一次，响应丢失后不能重放', async t => {
  const f = fixture(t), c = f.customer(); await f.service.send(c, f.input());
  const body = { email: 'user@example.com', code: f.code(c).code };
  const results = await Promise.all([f.api(c, 'post', '/verify', body), f.api(c, 'post', '/verify', body)]);
  assert.deepEqual(results.map(r => r.body.code).sort(), ['CODE_CONSUMED', 'VERIFIED']);
});
test('新发送替换旧码，旧发送失败不会删除新码', async t => {
  const g = gate(); let n = 0;
  const f = fixture(t, { send: () => ++n === 1 ? g.promise : { status: 'accepted' } }), c = f.customer();
  const first = f.service.send(c, f.input()); await Promise.resolve();
  f.advance(60000); const second = await f.service.send(c, f.input());
  const latest = f.code(c); assert.equal(latest.send_request_id, second.id);
  g.resolve({ status: 'failed' }); await first;
  assert.equal(f.code(c).send_request_id, second.id); f.service.verify(c, { email: 'user@example.com', code: latest.code });
});
test('固定窗口邮箱10次、IP30次、冷却60秒，失败也计数且窗口不延长', async t => {
  const f = fixture(t, { send: () => ({ status: 'failed' }) }), c = f.customer();
  const start = f.now();
  for (let i = 0; i < 10; i++) { await f.service.send(c, f.input()); f.advance(60000); }
  await assert.rejects(f.service.send(c, f.input()), { code: 'EMAIL_HOURLY_LIMIT' });
  assert.equal(f.db.prepare("SELECT expires_at FROM rate_limits WHERE limit_type='email_hour'").get().expires_at, start + 3600000);
  for (let i = 0; i < 20; i++) await f.service.send(c, f.input(`ip${i}@example.com`));
  await assert.rejects(f.service.send(c, f.input('blocked@example.com')), { code: 'IP_HOURLY_LIMIT' });
  f.advance(3000000); await f.service.send(c, f.input());
  assert.equal(f.db.prepare("SELECT count FROM rate_limits WHERE limit_type='ip_hour'").get().count, 1);
});
test('请求格式严格、邮箱IP规范化、认证失败与客户速率保护', async t => {
  const f = fixture(t), c = f.customer();
  for (const extra of [{ purpose: 'register' }, { user_id: 2 }, { html: 'body' }, { quota_total: 10 }]) assert.equal((await f.api(c, 'post', '/send', { ...f.input(), ...extra })).status, 400);
  for (const address of ['a@example.com,b@example.com', ['a@example.com']]) assert.equal((await f.api(c, 'post', '/send', { ...f.input(), email: address })).status, 400);
  const input = f.input(' USER@EXAMPLE.COM ', '2001:0db8:0:0:0:0:0:1');
  assert.equal((await f.api(c, 'post', '/send', input)).status, 200);
  assert.equal((await f.api(c, 'post', '/send', { ...input, email: 'user@example.com', client_ip: '2001:db8::1' })).status, 200);
  assert.equal(f.mails.length, 1);
  assert.equal((await f.api({ ...c, api_key: 'wrong' }, 'post', '/send', f.input())).status, 401);
  f.advance(60000);
  for (let i = 0; i < 120; i++) f.service.auth(c.customer_id, c.api_key);
  const r = await f.api(c, 'get', `/requests/${input.request_id}`); assert.equal(r.body.code, 'CUSTOMER_RATE_LIMIT'); assert.equal(r.headers['retry-after'], '60');
});
test('unknown验证码可以核验、清理不释放占用或删除永久历史', async t => {
  const f = fixture(t, { send: () => ({ status: 'unknown' }) }), c = f.customer();
  const row = await f.service.send(c, f.input()); f.service.verify(c, { email: 'user@example.com', code: f.code(c).code });
  f.advance(3600001); f.service.cleanup();
  assert.equal(f.code(c), undefined); assert.equal(f.usage(c).reserved_count, 1); assert.equal(f.service.request('a', row.request_id).status, 'unknown');
});

test('发送预占事务中途失败全部回滚，不触发 SMTP；核销写库故障返回服务异常', async t => {
  const f = fixture(t), c = f.customer();
  f.db.exec("CREATE TRIGGER reservation_fault BEFORE INSERT ON verification_codes BEGIN SELECT RAISE(ABORT,'injected'); END;");
  const failed = await f.api(c, 'post', '/send', f.input()); assert.equal(failed.body.code, 'SERVICE_UNAVAILABLE');
  assert.equal(f.mails.length, 0); assert.equal(f.usage(c).reserved_count, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM send_requests').get().n, 0); assert.equal(f.db.prepare('SELECT count(*) n FROM rate_limits').get().n, 0);
  f.db.exec('DROP TRIGGER reservation_fault'); await f.service.send(c, f.input());
  f.db.exec("CREATE TRIGGER consume_fault BEFORE UPDATE ON verification_codes BEGIN SELECT RAISE(ABORT,'injected'); END;");
  const verify = await f.api(c, 'post', '/verify', { email: 'user@example.com', code: f.code(c).code });
  assert.equal(verify.body.code, 'SERVICE_UNAVAILABLE'); assert.equal(f.code(c).consumed_at, null);
  f.db.exec('DROP TRIGGER consume_fault');
});
test('pending可核销，关停拒绝新发送并等待原发送结算，配置修改不影响已开始邮件', async t => {
  const g = gate(), f = fixture(t, { send: () => g.promise }), c = f.customer();
  const pending = f.service.send(c, f.input()); await Promise.resolve();
  f.service.verify(c, { email: 'user@example.com', code: f.code(c).code });
  f.config.update('a', 1, { from_name: '新昵称', subject: '新标题' });
  const stopped = f.service.stop(); await assert.rejects(f.service.send(c, f.input('next@example.com')), { code: 'SERVICE_UNAVAILABLE' });
  g.resolve({ status: 'accepted' }); await pending; await stopped;
  assert.equal(f.mails[0].fromName, 'Sender a'); assert.equal(f.mails[0].subject, 'Subject a'); assert.equal(f.usage(c).used_count, 1);
});
test('60秒冷却边界和Retry-After，重复请求不刷新冷却', async t => {
  const f = fixture(t), c = f.customer(), input = f.input(); await f.service.send(c, input);
  f.advance(59999); const limited = await f.api(c, 'post', '/send', f.input());
  assert.equal(limited.body.code, 'EMAIL_COOLDOWN'); assert.equal(limited.headers['retry-after'], '1');
  await f.service.send(c, input); f.advance(1); assert.equal((await f.service.send(c, f.input())).status, 'accepted');
});

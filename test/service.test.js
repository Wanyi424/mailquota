import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

test('多租户发送记录、验证码和额度相互隔离', async t => {
  const f = await fixture(t), a = await f.customer('tenant_a', 2), b = await f.customer('tenant_b', 2);
  const ar = await f.service.send(a, f.input('a@example.com'));
  const br = await f.service.send(b, f.input('b@example.com'));
  assert.equal(ar.status, 'accepted');
  assert.equal(br.status, 'accepted');
  assert.equal((await f.service.request(a.id, ar.request_id)).email, 'a@example.com');
  assert.equal(await f.service.request(a.id, br.request_id), undefined);
  assert.equal((await f.usage(a)).used_count, '1');
  assert.equal((await f.usage(b)).used_count, '1');
  assert.notEqual((await f.code(a, 'a@example.com')).code, (await f.code(b, 'b@example.com')).code);
});

test('同一 request_id 更换邮箱返回 REQUEST_CONFLICT', async t => {
  const f = await fixture(t), c = await f.customer('tenant_a', 2), input = f.input('first@example.com');
  await f.service.send(c, input);
  await assert.rejects(() => f.service.send(c, { ...input, email: 'second@example.com' }), { code: 'REQUEST_CONFLICT' });
});

test('额度并发预占只允许额度范围内的发送', async t => {
  const f = await fixture(t), c = await f.customer('tenant_a', 2);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => f.service.send(c, f.input(`${i}@example.com`)).catch(error => error)));
  assert.equal(results.filter(r => r?.status === 'accepted').length, 2);
  assert.equal(results.filter(r => r?.code === 'QUOTA_EXHAUSTED').length, 6);
  const usage = await f.usage(c);
  assert.equal(Number(usage.used_count), 2);
  assert.equal(Number(usage.reserved_count), 0);
});

test('验证码错误次数和单次核销持久化', async t => {
  const f = await fixture(t), c = await f.customer();
  const row = await f.service.send(c, f.input());
  const code = (await f.code(c)).code;
  await assert.rejects(() => f.service.verify(c, { email: 'user@example.com', code: '000000' }), { code: 'CODE_INVALID' });
  assert.equal(Number((await f.code(c)).attempts), 1);
  await f.service.verify(c, { email: 'user@example.com', code });
  await assert.rejects(() => f.service.verify(c, { email: 'user@example.com', code }), { code: 'CODE_CONSUMED' });
  assert.equal((await f.service.request(c.id, row.request_id)).status, 'accepted');
});

test('邮箱冷却和小时限流按租户独立计算', async t => {
  const f = await fixture(t), a = await f.customer('tenant_a', 20), b = await f.customer('tenant_b', 20);
  await f.service.send(a, f.input('same@example.com'));
  await assert.rejects(() => f.service.send(a, f.input('same@example.com')), { code: 'EMAIL_COOLDOWN' });
  const otherTenant = await f.service.send(b, f.input('same@example.com'));
  assert.equal(otherTenant.status, 'accepted');
});

test('明确失败释放预占额度并删除当前验证码', async t => {
  const f = await fixture(t, { send: () => ({ status: 'failed', error_code: 'SMTP_REJECTED' }) });
  const c = await f.customer('tenant_a', 1);
  const result = await f.service.send(c, f.input());
  assert.equal(result.status, 'failed');
  assert.equal(Number((await f.usage(c)).reserved_count), 0);
  assert.equal(Number((await f.usage(c)).used_count), 0);
  assert.equal(await f.code(c), undefined);
});

test('unknown 发送结果保留预占额度并可由管理员结算一次', async t => {
  const f = await fixture(t, { send: () => ({ status: 'unknown', error_code: 'SMTP_UNCERTAIN' }) });
  const c = await f.customer('tenant_a', 1);
  const row = await f.service.send(c, f.input());
  assert.equal(row.status, 'unknown');
  assert.equal(Number((await f.usage(c)).reserved_count), 1);
  const resolved = await f.service.settle(row.id, 'unknown', { status: 'failed' }, { id: 'admin', note: '已核查' });
  assert.equal(resolved.status, 'failed');
  assert.equal(Number((await f.usage(c)).reserved_count), 0);
  await assert.rejects(() => f.service.settle(row.id, 'unknown', { status: 'accepted' }), { code: 'STATE_CONFLICT' });
});

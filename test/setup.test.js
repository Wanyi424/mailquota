import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { savePassword } from '../scripts/password.js';
import { environment } from '../src/environment.js';
import { createApp } from '../src/app.js';
import { fixture, password } from './helpers.js';

function envFile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mailquota-setup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, '.env');
}

test('设置密码自动创建.env，生成可验证的盐哈希及会话密钥，不保存明文', async t => {
  const path = envFile(t);
  await savePassword(password, path);
  const text = readFileSync(path, 'utf8'), values = parseEnv(text);
  assert(await bcrypt.compare(password, values.ADMIN_PASSWORD_HASH));
  assert.match(values.ADMIN_PASSWORD_HASH, /^\$2[aby]\$12\$/);
  assert.equal(values.SESSION_SECRET.length, 43);
  assert.equal(text.includes(password), false);
  assert.equal(values.ADMIN_USERNAME, 'admin');
});

test('重新设置密码保留其他环境配置、注释和已有会话密钥，哈希每次重新加盐', async t => {
  const path = envFile(t), secret = 's'.repeat(43);
  const unrelated = '# 我的本地设置\r\nPUBLIC_ORIGIN=http://localhost:3000\r\nSMTP_PASSWORD="test-$&-value"\r\n';
  writeFileSync(path, unrelated + `export ADMIN_PASSWORD_HASH = 'old'\r\nSESSION_SECRET='${secret}'\r\n`);
  await savePassword(password, path);
  const first = parseEnv(readFileSync(path, 'utf8')).ADMIN_PASSWORD_HASH;
  await savePassword(password, path);
  const text = readFileSync(path, 'utf8'), values = parseEnv(text);
  assert(text.startsWith(unrelated)); assert.equal(values.SESSION_SECRET, secret);
  assert.notEqual(values.ADMIN_PASSWORD_HASH, first); assert(await bcrypt.compare(password, values.ADMIN_PASSWORD_HASH));
  assert.equal(text.match(/^ADMIN_PASSWORD_HASH=/gm).length, 1);
});

test('缺少密码字段自动追加、占位会话密钥补齐，非法密码不改文件', async t => {
  const path = envFile(t);
  await assert.rejects(savePassword('short', path)); assert.equal(existsSync(path), false);
  writeFileSync(path, 'PUBLIC_ORIGIN=http://localhost:3000\nSESSION_SECRET=...');
  await savePassword(password, path);
  const text = readFileSync(path, 'utf8'), values = parseEnv(text);
  assert(await bcrypt.compare(password, values.ADMIN_PASSWORD_HASH)); assert.equal(values.SESSION_SECRET.length, 43);
  await assert.rejects(savePassword('中'.repeat(25), path)); assert.equal(readFileSync(path, 'utf8'), text);
});

const passwordHash = bcrypt.hashSync(password, 12);
function settings(origin) {
  return environment({ PUBLIC_ORIGIN: origin, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: passwordHash, SESSION_SECRET: 's'.repeat(43), SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'test', SMTP_PASSWORD: 'test', SMTP_FROM: 'sender@example.com' });
}

test('PUBLIC_ORIGIN允许HTTP/HTTPS和本地端口，仍拒绝路径和非Web协议', () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://mail.example.com']) assert.equal(settings(origin).admin.origin, origin);
  for (const origin of ['ftp://localhost', 'http://localhost:3000/admin', 'http://localhost:3000/', 'http://user:pass@localhost:3000', 'localhost:3000']) assert.throws(() => settings(origin), /PUBLIC_ORIGIN/);
});

test('HTTP配置直接登录管理端、保持会话及CSRF，页面资源不升级为HTTPS', async t => {
  const f = fixture(t), origin = 'http://localhost:3000';
  const app = createApp({ service: f.service, config: f.config, admin: settings(origin).admin });
  t.after(() => app.locals.dispose());
  const agent = request.agent(app);
  const page = await agent.get('/admin/'); assert.equal(page.status, 200);
  assert.equal(page.headers['strict-transport-security'], undefined);
  assert.doesNotMatch(page.headers['content-security-policy'], /upgrade-insecure-requests/);
  assert.equal((await agent.get('/admin/assets/js/app.js')).status, 200);
  const login = await agent.post('/admin/api/login').set('Origin', origin).send({ username: 'admin', password });
  assert.equal(login.status, 200);
  assert.doesNotMatch(login.headers['set-cookie'][0], /; Secure/i);
  assert.match(login.headers['set-cookie'][0], /HttpOnly/); assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
  assert.equal((await agent.get('/admin/api/session')).status, 200);
  const csrf = login.body.data.csrf_token;
  assert.equal((await agent.post('/admin/api/logout').set('Origin', 'http://other.test').set('X-CSRF-Token', csrf)).status, 403);
  assert.equal((await agent.post('/admin/api/logout').set('Origin', origin).set('X-CSRF-Token', csrf)).status, 200);
  assert.equal((await agent.get('/admin/api/session')).status, 401);
  assert.equal((await agent.post('/api/v1/verification-codes/send').send({})).body.code, 'AUTH_INVALID');
});

test('HTTPS配置自动保留HTTPS请求校验、Secure Cookie和安全响应头', async t => {
  const f = fixture(t), origin = 'https://mail.example.com';
  const app = createApp({ service: f.service, config: f.config, admin: settings(origin).admin });
  t.after(() => app.locals.dispose());
  assert.equal((await request(app).get('/admin/')).body.code, 'HTTPS_REQUIRED');
  const login = await request(app).post('/admin/api/login').set('X-Forwarded-Proto', 'https').set('Origin', origin).send({ username: 'admin', password });
  assert.equal(login.status, 200); assert.match(login.headers['set-cookie'][0], /; Secure/i);
  assert.match(login.headers['strict-transport-security'], /max-age=/);
  assert.match(login.headers['content-security-policy'], /upgrade-insecure-requests/);
});

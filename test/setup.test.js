import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import bcrypt from 'bcryptjs';
import { savePassword } from '../scripts/password.js';
import { environment } from '../src/environment.js';
import { password } from './helpers.js';

function envFile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mailquota-setup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, '.env');
}
test('管理员密码脚本保存 bcrypt 哈希且不保存明文', async t => {
  const path = envFile(t);
  await savePassword(password, path);
  const text = readFileSync(path, 'utf8'), values = parseEnv(text);
  assert(await bcrypt.compare(password, values.ADMIN_PASSWORD_HASH));
  assert.match(values.ADMIN_PASSWORD_HASH, /^\$2[aby]\$12\$/);
  assert.equal(text.includes(password), false);
  assert.equal(values.SESSION_SECRET.length, 43);
});
test('密码脚本拒绝非法密码且不修改已有文件', async t => {
  const path = envFile(t);
  await assert.rejects(savePassword('short', path));
  assert.equal(existsSync(path), false);
});
test('环境变量解析 DATABASE_URL 和 PostgreSQL SMTP 配置', () => {
  const result = environment({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/mailquota',
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: bcrypt.hashSync(password, 4).replace('$04$', '$12$'),
    SESSION_SECRET: 's'.repeat(43), PUBLIC_ORIGIN: 'https://mail.example.test',
    SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_SECURE: 'true',
    SMTP_USER: 'smtp-user', SMTP_PASSWORD: 'smtp-pass', SMTP_FROM: 'sender@example.com',
  });
  assert.equal(result.databaseUrl, 'postgres://user:pass@localhost:5432/mailquota');
  assert.equal(result.smtp.from, 'sender@example.com');
});

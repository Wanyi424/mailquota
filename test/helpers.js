import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import request from 'supertest';
import { openDatabase } from '../src/database.js';
import { ConfigStore } from '../src/config.js';
import { MailService } from '../src/service.js';
import { createApp } from '../src/app.js';

export const password = 'test-password-only-123';
const hash = bcrypt.hashSync(password, 4);
export const origin = 'https://mail.example.test';
const databaseUrl = () => process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

export async function fixture(t, options = {}) {
  const url = databaseUrl();
  assert(url, '请设置 TEST_DATABASE_URL 或 DATABASE_URL');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: url });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  await adminPool.end();
  const separator = url.includes('?') ? '&' : '?';
  const db = openDatabase(`${url}${separator}options=${encodeURIComponent(`-c search_path=${schema},public`)}`);
  await db.ensureSchema();
  const config = new ConfigStore(db);
  let time = Date.now();
  const mails = [];
  const mailer = { send: async mail => { mails.push(mail); return options.send ? options.send(mail) : { status: 'accepted', messageId: 'test-message', accepted: [mail.to], rejected: [] }; } };
  const service = new MailService(db, config, mailer, { now: () => time, deadlineMs: options.deadlineMs || 1000, fromEmail: 'sender@example.com' });
  const app = createApp({ service, config, admin: { username: 'admin', passwordHash: hash, sessionSecret: 's'.repeat(43), origin }, secure: options.secure ?? false });
  const f = {
    db, config, service, app, mails, now: () => time,
    advance: ms => { time += ms; },
    customer: (id = 'tenant_a', quota = 100) => config.create({
      customer_id: id, name: id, login_name: id, password,
      enabled: true, quota_total: quota, from_name: `Sender ${id}`, subject: `Subject ${id}`,
      html_template: `<p>${id}: {{code}} {{expires_minutes}}</p>`,
      text_template: `${id}: {{code}} {{expires_minutes}}`, reply_to: '',
    }),
    input: (email = 'user@example.com') => ({ request_id: randomUUID(), email }),
    code: async (tenant, email = 'user@example.com') => (await db.query('SELECT * FROM verification_codes WHERE tenant_id=$1 AND email=$2', [tenant.id, email])).rows[0],
    usage: async tenant => (await db.query('SELECT * FROM tenant_quotas WHERE tenant_id=$1', [tenant.id])).rows[0],
    api: (tenant, method, path, body) => request(app)[method](`/api/v1/verification-codes${path}`).set('X-Customer-Id', tenant.customer_id).set('Authorization', `Bearer ${tenant.api_key}`).send(body),
    login: async () => {
      const agent = request.agent(app);
      const r = await agent.post('/admin/api/login').set('Origin', origin).send({ username: 'admin', password });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return { agent, csrf: r.body.data.csrf_token };
    },
  };
  t.after(async () => {
    await service.stop();
    await db.end();
    const cleanup = new pg.Pool({ connectionString: url });
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await cleanup.end();
  });
  return f;
}

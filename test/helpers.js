import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { initialize } from '../scripts/init.js';
import { openDatabase } from '../src/database.js';
import { ConfigStore } from '../src/config.js';
import { MailService } from '../src/service.js';
import { createApp } from '../src/app.js';
export const password = 'test-password-only-123';
const hash = bcrypt.hashSync(password, 12);
export const origin = 'https://mail.example.test';
export function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mailquota-')); initialize(root);
  const db = openDatabase(join(root, 'data', 'mailquota.sqlite'));
  const config = new ConfigStore(root, db); let time = 1800000000000;
  const mails = [];
  const mailer = { send: async mail => { mails.push(mail); return options.send ? options.send(mail) : { status: 'accepted', messageId: 'test-message' }; } };
  const service = new MailService(db, config, mailer, { now: () => time, deadlineMs: options.deadlineMs || 1000 });
  const app = createApp({ service, config, admin: { username: 'admin', passwordHash: hash, sessionSecret: 's'.repeat(43), origin }, secure: options.secure ?? false });
  const f = { root, db, config, service, app, mails, now: () => time, advance: n => { time += n; },
    customer: (id = 'a', quota = 100) => config.create({ customer_id: id, name: id, enabled: true, quota_total: quota, from_name: `Sender ${id}`, subject: `Subject ${id}`, html: `<p>${id}: {{code}} {{expires_minutes}}</p>`, text_template: `${id}: {{code}} {{expires_minutes}}`, reply_to: '' }),
    input: (email = 'user@example.com', ip = '203.0.113.1') => ({ request_id: randomUUID(), email, client_ip: ip }),
    code: (c, address = 'user@example.com') => db.prepare('SELECT * FROM verification_codes WHERE customer_id=? AND email=?').get(c.customer_id, address),
    usage: c => db.prepare('SELECT * FROM customer_usage WHERE customer_id=?').get(c.customer_id),
    api: (c, method, path, body) => request(app)[method](`/api/v1/verification-codes${path}`).set('X-Customer-Id', c.customer_id).set('Authorization', `Bearer ${c.api_key}`).send(body),
    login: async () => { const agent = request.agent(app); const r = await agent.post('/admin/api/login').set('Origin', origin).send({ username: 'admin', password }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return { agent, csrf: r.body.data.csrf_token }; },
  };
  t.after(async () => { await service.stop(); app.locals.dispose(); if (db.open) db.close(); rmSync(root, { recursive: true, force: true }); });
  return f;
}
export const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

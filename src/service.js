import { randomInt, timingSafeEqual } from 'node:crypto';
import { fail } from './errors.js';
import { render } from './validation.js';

export class MailService {
  constructor(db, config, mailer, { now = Date.now, deadlineMs = 15000, logger = () => {} } = {}) {
    Object.assign(this, { db, config, mailer, now, deadlineMs, logger });
    this.active = new Map(); this.stopping = false; this.apiWindows = new Map();
    db.prepare("UPDATE send_requests SET status='unknown',error_code='PROCESS_INTERRUPTED',error_detail='上次进程未完成结算',updated_at=? WHERE status='pending'").run(now());
  }
  auth(id, key) {
    const c = this.config.get(id);
    const a = Buffer.from(key || ''), b = Buffer.from(c?.api_key || '');
    if (!c || a.length !== b.length || !timingSafeEqual(a, b)) fail(401, 'AUTH_INVALID', '客户认证无效，请联系管理员');
    if (!c.enabled) fail(403, 'CUSTOMER_DISABLED', '客户已停用，请联系管理员');
    const t = this.now(); let w = this.apiWindows.get(id);
    if (!w || w.expires <= t) { w = { count: 0, expires: t + 60000 }; this.apiWindows.set(id, w); }
    if (w.count >= 120) this.limited('CUSTOMER_RATE_LIMIT', w.expires);
    w.count++; return c;
  }
  limited(code, expiry) { fail(429, code, '请求过于频繁，请稍后重试', { retry_after_seconds: Math.max(1, Math.ceil((expiry - this.now()) / 1000)) }); }
  request(customer, request) { return this.db.prepare('SELECT * FROM send_requests WHERE customer_id=? AND request_id=?').get(customer, request); }
  replay(c, input) {
    const old = this.request(c.customer_id, input.request_id);
    if (old && (old.email !== input.email || old.client_ip !== input.client_ip)) fail(409, 'REQUEST_CONFLICT', '同一请求编号不能更换邮箱或 IP');
    return old;
  }
  async send(c, input) {
    if (this.stopping) fail(503, 'SERVICE_UNAVAILABLE', '服务正在停止', { request_id: input.request_id });
    const old = this.replay(c, input); if (old) return old;
    if (this.active.size >= 2) fail(503, 'SERVICE_BUSY', '发送容量暂满，请稍后重试');
    this.config.check();
    const t = this.now(), code = String(randomInt(0, 1000000)).padStart(6, '0');
    const row = this.db.transaction(() => {
      const existing = this.replay(c, input); if (existing) return existing;
      const rules = [['email_cooldown', input.email, 1, 60000, 'EMAIL_COOLDOWN'], ['email_hour', input.email, 10, 3600000, 'EMAIL_HOURLY_LIMIT'], ['ip_hour', input.client_ip, 30, 3600000, 'IP_HOURLY_LIMIT']];
      for (const [type, target, max, , error] of rules) {
        const r = this.db.prepare('SELECT * FROM rate_limits WHERE customer_id=? AND limit_type=? AND target=?').get(c.customer_id, type, target);
        if (r && r.expires_at > t && r.count >= max) this.limited(error, r.expires_at);
      }
      const u = this.db.prepare('SELECT * FROM customer_usage WHERE customer_id=?').get(c.customer_id);
      if (!u) throw new Error('客户用量缺失');
      if (u.used_count + u.reserved_count >= c.quota_total) fail(409, 'QUOTA_EXHAUSTED', '邮件发送额度已用完，请联系管理员增加额度');
      const result = this.db.prepare("INSERT INTO send_requests(customer_id,request_id,email,client_ip,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)").run(c.customer_id, input.request_id, input.email, input.client_ip, t, t);
      this.db.prepare('UPDATE customer_usage SET reserved_count=reserved_count+1,updated_at=? WHERE customer_id=?').run(t, c.customer_id);
      for (const [type, target, , duration] of rules) this.db.prepare(`INSERT INTO rate_limits VALUES(?,?,?,?,?) ON CONFLICT(customer_id,limit_type,target) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`).run(c.customer_id, type, target, 1, t + duration, t, t);
      this.db.prepare(`INSERT INTO verification_codes VALUES(?,?,?,?,0,?,NULL,?) ON CONFLICT(customer_id,email) DO UPDATE SET code=excluded.code,send_request_id=excluded.send_request_id,attempts=0,expires_at=excluded.expires_at,consumed_at=NULL,created_at=excluded.created_at`).run(c.customer_id, input.email, code, result.lastInsertRowid, t + 300000, t);
      return this.request(c.customer_id, input.request_id);
    }).immediate();
    // Nothing can interleave the synchronous reservation and active-slot registration.
    const flight = { isolated: false };
    this.active.set(row.id, flight);
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => this.mailer.send({ to: input.email, fromName: c.from_name, subject: c.subject, replyTo: c.reply_to || undefined, html: render(c.html, code), text: render(c.text_template, code) }, { signal: controller.signal })).catch(() => ({ status: 'unknown', error_code: 'TRANSPORT_EXCEPTION' })),
        new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ status: 'unknown', error_code: 'SMTP_DEADLINE' }); }, this.deadlineMs); }),
      ]);
      flight.isolated = true; // Late transport results never write the ledger.
      if (!['accepted', 'failed', 'unknown'].includes(result?.status)) throw new Error('无效发送结果');
      return this.settle(row.id, 'pending', result);
    } catch (error) {
      // A failed commit keeps the original reservation. Recover without ever claiming settlement.
      try { this.db.prepare("UPDATE send_requests SET status='unknown',error_code='SETTLEMENT_UNAVAILABLE',error_detail='结算未确认，需人工核查',updated_at=? WHERE id=? AND status='pending'").run(this.now(), row.id); } catch { /* readiness will expose database failure */ }
      fail(503, 'SERVICE_UNAVAILABLE', '发送结算暂不可用，请查询原请求', { request_id: input.request_id });
    } finally { clearTimeout(timer); this.active.delete(row.id); }
  }
  settle(id, expected, outcome, admin) {
    const row = this.db.transaction(() => {
      const r = this.db.prepare('SELECT * FROM send_requests WHERE id=?').get(id);
      if (!r) fail(404, 'REQUEST_NOT_FOUND', '发送记录不存在');
      if (r.status !== expected) fail(409, 'STATE_CONFLICT', '该记录状态已改变，请刷新', { status: r.status });
      if (admin && this.active.has(id) && !this.active.get(id).isolated) fail(409, 'STATE_CONFLICT', '原发送仍在处理中');
      const t = this.now();
      this.db.prepare('UPDATE send_requests SET status=?,provider_message_id=COALESCE(?,provider_message_id),error_code=?,error_detail=?,updated_at=?,resolved_at=?,resolved_by=?,resolution_note=? WHERE id=?').run(outcome.status, outcome.messageId || null, outcome.error_code || null, outcome.error_code ? 'SMTP 状态异常，请结合服务商记录核查' : null, t, admin ? t : null, admin?.name || null, admin?.note || null, id);
      if (outcome.status !== 'unknown') {
        this.db.prepare('UPDATE customer_usage SET reserved_count=reserved_count-1,used_count=used_count+?,updated_at=? WHERE customer_id=?').run(outcome.status === 'accepted' ? 1 : 0, t, r.customer_id);
        if (outcome.status === 'failed') this.db.prepare('DELETE FROM verification_codes WHERE send_request_id=?').run(id);
      }
      return this.db.prepare('SELECT * FROM send_requests WHERE id=?').get(id);
    }).immediate();
    this.logger({ customer_id: row.customer_id, request_id: row.request_id, status: row.status, event: admin ? 'manual_settlement' : 'smtp_settlement' });
    return row;
  }
  verify(c, input) {
    // Return failures out of the transaction so incorrect-attempt increments commit.
    const result = this.db.transaction(() => {
      const r = this.db.prepare('SELECT * FROM verification_codes WHERE customer_id=? AND email=?').get(c.customer_id, input.email);
      if (!r || r.expires_at <= this.now()) return 'CODE_EXPIRED';
      if (r.consumed_at !== null) return 'CODE_CONSUMED';
      if (r.attempts >= 5) return 'CODE_ATTEMPTS_EXCEEDED';
      if (r.code !== input.code) {
        this.db.prepare('UPDATE verification_codes SET attempts=attempts+1 WHERE customer_id=? AND email=?').run(c.customer_id, input.email);
        return r.attempts === 4 ? 'CODE_ATTEMPTS_EXCEEDED' : { code: 'CODE_INVALID', attempts_remaining: 4 - r.attempts };
      }
      this.db.prepare('UPDATE verification_codes SET consumed_at=? WHERE customer_id=? AND email=?').run(this.now(), c.customer_id, input.email);
      return null;
    }).immediate();
    if (result) fail(400, result.code || result, result.code ? '验证码错误' : '验证码不可用，请重新获取', result.code ? { attempts_remaining: result.attempts_remaining } : undefined);
  }
  cleanup() {
    const t = this.now();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM verification_codes WHERE expires_at<=?').run(t);
      this.db.prepare('DELETE FROM rate_limits WHERE expires_at<=?').run(t);
      // Pending records from a failed settlement can be recovered once the flight is isolated.
      for (const r of this.db.prepare("SELECT id FROM send_requests WHERE status='pending'").all()) if (!this.active.has(r.id)) this.db.prepare("UPDATE send_requests SET status='unknown',updated_at=?,error_code='SETTLEMENT_UNAVAILABLE' WHERE id=?").run(t, r.id);
    })();
  }
  async stop() {
    this.stopping = true;
    const until = Date.now() + this.deadlineMs + 1000;
    while (this.active.size && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
    this.cleanup();
  }
}
export function requestData(row) { return { request_id: row.request_id, status: row.status, expires_at: row.created_at + 300000, resend_available_at: row.created_at + 60000 }; }
export function sendResponse(res, row) {
  const codes = { accepted: [200, true, 'SEND_ACCEPTED', '验证码邮件已提交发送，请注意查收'], pending: [202, false, 'SEND_PENDING', '请求仍在处理中'], unknown: [202, false, 'SEND_UNKNOWN', '发送结果待确认，请稍后查询'], failed: [503, false, 'SEND_FAILED', '邮件发送失败，请稍后重新获取'] };
  const [status, success, code, message] = codes[row.status]; res.status(status).json({ success, code, message, data: requestData(row) });
}

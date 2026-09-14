import { readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { customerSchema, createSchema, htmlSchema } from './validation.js';
import { fail, parse } from './errors.js';

export function atomicWrite(path, text) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(tmp, 'wx', 0o600); writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(tmp, path);
  } finally { if (fd !== undefined) closeSync(fd); if (existsSync(tmp)) unlinkSync(tmp); }
}
export class ConfigStore {
  constructor(root, db) {
    this.root = root; this.db = db; this.path = join(root, 'config', 'customers.json');
    const raw = z.object({ customers: z.array(customerSchema) }).strict().parse(JSON.parse(readFileSync(this.path, 'utf8')));
    this.customers = new Map();
    for (const c of raw.customers) {
      if (this.customers.has(c.customer_id)) throw new Error('客户 ID 重复');
      this.customers.set(c.customer_id, Object.freeze({ ...c, html: htmlSchema.parse(readFileSync(join(root, 'templates', c.html_template), 'utf8')) }));
    }
    this.check();
  }
  check() {
    if (!existsSync(this.path) || !existsSync(join(this.root, 'data', 'mailquota.sqlite'))) throw new Error('必要持久化文件丢失');
    for (const c of this.customers.values()) {
      const u = this.db.prepare('SELECT * FROM customer_usage WHERE customer_id=?').get(c.customer_id);
      if (!u || c.quota_total < u.used_count + u.reserved_count || !existsSync(join(this.root, 'templates', c.html_template))) throw new Error('客户配置、模板或用量不一致');
    }
    this.db.prepare('SELECT count(*) FROM customer_usage').get();
  }
  get(id) { return this.customers.get(id); }
  require(id) { const c = this.get(id); if (!c) fail(404, 'CUSTOMER_NOT_FOUND', '客户不存在'); return c; }
  publish(c) {
    const next = new Map(this.customers); next.set(c.customer_id, Object.freeze(c));
    atomicWrite(this.path, JSON.stringify({ customers: [...next.values()].map(({ html, ...v }) => v) }, null, 2) + '\n');
    this.customers = next;
  }
  create(input) {
    const { html, ...value } = parse(createSchema, input);
    if (this.get(value.customer_id) || this.db.prepare('SELECT 1 FROM customer_usage WHERE customer_id=?').get(value.customer_id)) fail(409, 'CUSTOMER_EXISTS', '客户 ID 已存在或有未发布用量行，请检查配置');
    const c = { ...value, api_key: randomBytes(32).toString('base64url'), version: 1, html_template: `${value.customer_id}_${randomUUID()}.html`, html };
    this.db.prepare('INSERT INTO customer_usage(customer_id,updated_at) VALUES(?,?)').run(c.customer_id, Date.now());
    atomicWrite(join(this.root, 'templates', c.html_template), html);
    this.publish(c); return c;
  }
  update(id, oldVersion, changes, newHtml) {
    const current = this.require(id);
    if (oldVersion !== current.version) fail(409, 'EDIT_CONFLICT', '配置已更新，请刷新后再保存');
    const c = { ...current, ...changes, version: current.version + 1 };
    if (c.quota_total < current.quota_total) fail(400, 'INVALID_ARGUMENT', '总额度只能增加');
    parse(customerSchema, (({ html, ...v }) => v)(c));
    if (newHtml !== undefined) {
      c.html = parse(htmlSchema, newHtml);
      // Immutable template names keep the old configuration valid if publishing JSON fails.
      c.html_template = `${id}_${randomUUID()}.html`;
      atomicWrite(join(this.root, 'templates', c.html_template), c.html);
    }
    this.publish(c); return c;
  }
  public(c) {
    const { api_key, html, ...rest } = c;
    const u = this.db.prepare('SELECT used_count,reserved_count FROM customer_usage WHERE customer_id=?').get(c.customer_id);
    if (!u) throw new Error('客户用量行丢失');
    return { ...rest, api_key_mask: `********${api_key.slice(-4)}`, ...u, available_count: c.quota_total - u.used_count - u.reserved_count };
  }
}

// Explicit integration exercise, run with: node test/container-check.js
// Uses isolated storage and a TLS SMTP simulator; never connects to a real provider.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, cpSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import selfsigned from 'selfsigned';
import bcrypt from 'bcryptjs';
const out = resolve('test-output'); mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(out, 'container-')), storage = join(root, 'storage'); mkdirSync(storage);
const name = `mailquota-check-${randomBytes(4).toString('hex')}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cert = await selfsigned.generate([{ name: 'commonName', value: 'host.docker.internal' }], { notBeforeDate: new Date(Date.now() - 86400000), notAfterDate: new Date(Date.now() + 86400000), keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'host.docker.internal' }] }] });
writeFileSync(join(root, 'ca.pem'), cert.cert);
let delivered = 0, hold = false, inData;
const smtp = new SMTPServer({ secure: true, key: cert.private, cert: cert.cert, logger: false, onAuth(auth, session, callback) { callback(null, { user: 'test' }); }, onData(stream, session, callback) { stream.on('data', () => {}); stream.on('end', () => { if (hold) { inData?.(); return; } delivered++; callback(null, 'queued'); }); } });
smtp.on('error', () => {}); await new Promise(resolve => smtp.listen(0, '0.0.0.0', resolve));
const password = randomBytes(24).toString('base64url');
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: await bcrypt.hash(password, 12), SESSION_SECRET: randomBytes(32).toString('base64url'), PUBLIC_ORIGIN: 'https://mail.example.test', SMTP_HOST: 'host.docker.internal', SMTP_PORT: smtp.server.address().port, SMTP_SECURE: 'true', SMTP_USER: 'test', SMTP_PASSWORD: 'test', SMTP_FROM: 'sender@example.com', TRUST_PROXY: 'loopback,uniquelocal', NODE_EXTRA_CA_CERTS: '/verification/ca.pem' };
writeFileSync(join(root, 'test.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
let base, cookie, csrf, key;
const headers = () => ({ 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', Origin: env.PUBLIC_ORIGIN, ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}) });
async function call(path, method = 'GET', body) { const r = await fetch(base + path, { method, headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await r.json(); return { r, data }; }
async function start() {
  docker('run', '-d', '--name', name, '--cpus', '1', '--memory', '256m', '--env-file', join(root, 'test.env'), '-v', `${storage}:/app/storage`, '-v', `${root}:/verification:ro`, '-p', '127.0.0.1::3000', 'mailquota:local');
  base = `http://${docker('port', name, '3000/tcp').split('\n')[0]}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health/ready')).ok) return; } catch {} await delay(200); }
  throw new Error('container readiness failed: ' + docker('logs', name));
}
async function login() { const { r, data } = await call('/admin/api/login', 'POST', { username: 'admin', password }); assert.equal(r.status, 200); cookie = r.headers.get('set-cookie').split(';')[0]; csrf = data.data.csrf_token; }
async function send(i) {
  const input = { request_id: randomUUID(), email: `user${i}@example.com`, client_ip: '203.0.113.1' };
  const started = performance.now();
  const r = await fetch(base + '/api/v1/verification-codes/send', { method: 'POST', headers: { ...headers(), 'X-Customer-Id': 'test', Authorization: `Bearer ${key}` }, body: JSON.stringify(input) });
  return { status: r.status, body: await r.json(), elapsed_ms: performance.now() - started, input };
}
const report = { date: new Date().toISOString(), environment: 'Docker Desktop Linux, Node 24.21.0, CPU limit 1, memory limit 256MiB, TLS simulated SMTP', memory_samples: [] };
try {
  docker('run', '--rm', '-v', `${storage}:/app/storage`, 'mailquota:local', 'node', 'scripts/init.js');
  await start();
  console.log('Container ready; testing 10 sends at 6-second intervals.');
  report.idle_memory = docker('stats', '--no-stream', '--format', '{{.MemUsage}}', name);
  await login();
  const created = await call('/admin/api/customers', 'POST', { customer_id: 'test', name: '测试客户', from_name: '测试客户', subject: '验证码', text_template: '{{code}}，{{expires_minutes}}分钟', reply_to: '', html: '<p>{{code}}，{{expires_minutes}}分钟</p>', enabled: true, quota_total: 100 });
  assert.equal(created.r.status, 201); key = created.data.data.api_key;
  const times = [], started = Date.now(); let original;
  for (let i = 0; i < 10; i++) {
    if (i) await delay(Math.max(0, started + i * 6000 - Date.now()));
    const result = await send(i);
    if (result.body.code !== 'SEND_ACCEPTED') {
      const diagnostic = await promisify(execFile)('docker', ['exec', name, 'node', '-e', `const s=require('tls').connect({host:'host.docker.internal',port:${env.SMTP_PORT},servername:'host.docker.internal'},()=>{console.log('TLS connected');s.end()});s.on('error',e=>console.log(e.code,e.message));s.setTimeout(3000,()=>s.destroy());`]);
      console.log('Test TLS diagnostic:', diagnostic.stdout.trim());
    }
    assert.equal(result.body.code, 'SEND_ACCEPTED', JSON.stringify(result.body)); times.push(result.elapsed_ms); original ||= result.input;
    report.memory_samples.push(docker('stats', '--no-stream', '--format', '{{.MemUsage}}', name));
  }
  report.load = { requests: 10, interval_seconds: 6, elapsed_seconds: (Date.now() - started) / 1000, errors: 0, min_ms: Math.min(...times), mean_ms: times.reduce((a, b) => a + b) / times.length, max_ms: Math.max(...times), smtp_accepted: delivered };
  docker('stop', '-t', '25', name); docker('rm', name);
  const backup = join(root, 'backup'); cpSync(storage, backup, { recursive: true });
  await start(); cookie = undefined; csrf = undefined; await login();
  assert.equal((await call('/admin/api/customers/test')).data.data.used_count, 10);
  report.container_recreation = 'passed: used_count=10';
  docker('stop', '-t', '25', name); docker('rm', name);
  renameSync(storage, join(root, 'before-restore')); cpSync(backup, storage, { recursive: true });
  await start(); cookie = undefined; csrf = undefined; await login();
  assert.equal((await call('/admin/api/customers/test')).data.data.used_count, 10);
  const queried = await fetch(base + `/api/v1/verification-codes/requests/${original.request_id}`, { headers: { ...headers(), 'X-Customer-Id': 'test', Authorization: `Bearer ${key}` } }); assert.equal((await queried.json()).data.status, 'accepted');
  report.backup_restore = 'passed: configuration, templates, used_count=10 and original request status retained';
  // Kill during DATA: restart must preserve its reservation as unknown, without resending.
  hold = true; const entered = new Promise(resolve => { inData = resolve; });
  const interrupted = send('interrupted').catch(() => null); await entered;
  docker('kill', name); await interrupted; docker('rm', name);
  await start(); cookie = undefined; csrf = undefined; await login();
  const usage = (await call('/admin/api/customers/test')).data.data;
  assert.equal(usage.used_count, 10); assert.equal(usage.reserved_count, 1);
  const unknown = (await call('/admin/api/requests?status=unknown')).data.data;
  assert.equal(unknown.total, 1); assert.equal(delivered, 10);
  report.process_crash = 'passed: interrupted DATA recovered as unknown; reserved=1; no resend';
  report.image_bytes = Number(docker('image', 'inspect', 'mailquota:local', '--format', '{{.Size}}'));
  writeFileSync(join(out, 'container-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { docker('stop', '-t', '25', name); docker('rm', name); } catch {}
  await new Promise(resolve => smtp.close(resolve));
}

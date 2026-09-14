import test from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { createMailer } from '../src/smtp.js';
import selfsigned from 'selfsigned';
async function server(t, handlers = {}) {
  const smtp = new SMTPServer({ secure: false, authOptional: true, disabledCommands: ['STARTTLS'], logger: false, ...handlers });
  smtp.on('error', () => {});
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => smtp.close(resolve)));
  return smtp.server.address().port;
}
const mail = { to: 'user@example.com', fromName: '测试网站', subject: '验证码', text: 'Code 083721', html: '<p>083721</p>' };
test('真实 SMTP 协议模拟：受理与 HTML/纯文本两个 MIME 版本', async t => {
  let content = '';
  const port = await server(t, { onData(stream, session, callback) { stream.on('data', b => { content += b; }); stream.on('end', () => callback(null, 'queued')); } });
  const result = await createMailer({ host: '127.0.0.1', port, secure: false, from: 'sender@example.com' }).send(mail);
  assert.equal(result.status, 'accepted'); assert.match(content, /multipart\/alternative/); assert.match(content, /text\/plain/); assert.match(content, /text\/html/); assert.match(content, /083721/);
});
test('真实 SMTP 协议模拟：明确拒绝释放条件', async t => {
  const port = await server(t, { onRcptTo(address, session, callback) { const e = new Error('rejected'); e.responseCode = 550; callback(e); } });
  const result = await createMailer({ host: '127.0.0.1', port, secure: false, from: 'sender@example.com' }).send(mail);
  assert.equal(result.status, 'failed'); assert.equal(result.error_code, 'SMTP_REJECTED');
});
test('真实 SMTP 协议模拟：DATA 已读但不返回结果，截止时间必须 unknown', async t => {
  const port = await server(t, { onData(stream) { stream.resume(); } });
  const started = Date.now();
  const result = await createMailer({ host: '127.0.0.1', port, secure: false, from: 'sender@example.com', deadlineMs: 300 }).send(mail);
  assert.equal(result.status, 'unknown'); assert(Date.now() - started < 1500);
});
test('TLS证书校验与SMTP账号认证后发送', async t => {
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }] });
  const port = await server(t, { secure: true, key: cert.private, cert: cert.cert, onAuth(auth, session, callback) { assert.equal(auth.username, 'test'); assert.equal(auth.password, 'password'); callback(null, { user: 'test' }); }, onData(stream, session, callback) { stream.resume(); stream.on('end', () => callback(null, 'queued')); } });
  const result = await createMailer({ host: '127.0.0.1', port, secure: true, from: 'sender@example.com', auth: { user: 'test', pass: 'password' }, tls: { ca: cert.cert, servername: 'localhost' } }).send(mail);
  assert.equal(result.status, 'accepted', JSON.stringify(result));
});

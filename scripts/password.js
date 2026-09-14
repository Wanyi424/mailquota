import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
if (!process.stdin.isTTY) {
  const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('密码应至少 12 字符且不超过 72 字节');
  console.log(`ADMIN_PASSWORD_HASH='${await bcrypt.hash(password, 12)}'`);
  console.log(`SESSION_SECRET=${randomBytes(32).toString('base64url')}`);
} else {
  console.log('输入管理员密码（不回显），回车生成配置：');
  process.stdin.setRawMode(true); process.stdin.resume();
  let value = '';
  process.stdin.on('data', async data => {
    const text = data.toString();
    if (text === '\u0003') process.exit(130);
    if (text === '\r' || text === '\n') {
      process.stdin.setRawMode(false); process.stdin.pause();
      if (value.length < 12 || Buffer.byteLength(value) > 72) { console.error('密码应至少 12 字符且不超过 72 字节'); process.exitCode = 1; return; }
      console.log(`\nADMIN_PASSWORD_HASH='${await bcrypt.hash(value, 12)}'\nSESSION_SECRET=${randomBytes(32).toString('base64url')}`); value = '';
    } else if (text === '\u007f' || text === '\b') value = value.slice(0, -1);
    else value += text;
  });
}

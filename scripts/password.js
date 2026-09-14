import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { atomicWrite } from '../src/config.js';

export async function savePassword(password, envPath = fileURLToPath(new URL('../.env', import.meta.url))) {
  if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('密码应至少 12 字符且不超过 72 字节');
  const hash = await bcrypt.hash(password, 12);
  let content = readFileSync(existsSync(envPath) ? envPath : new URL('../.env.example', import.meta.url), 'utf8');
  const existing = parseEnv(content);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const set = (name, value) => {
    const line = `${name}='${value}'`;
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[^\\r\\n]*`, 'gm');
    // Use a replacer so bcrypt's dollar signs are preserved literally.
    if (pattern.test(content)) content = content.replace(pattern, () => line);
    else content += (content.endsWith('\n') ? '' : newline) + line + newline;
  };
  set('ADMIN_PASSWORD_HASH', hash);
  if (!existing.SESSION_SECRET || existing.SESSION_SECRET.length < 43) set('SESSION_SECRET', randomBytes(32).toString('base64url'));
  atomicWrite(envPath, content);
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  console.log('输入管理员密码（不回显），回车保存到 .env：');
  return new Promise(resolve => {
    let value = '';
    process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
    const finish = password => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false); process.stdin.pause();
      console.log(); resolve(password);
    };
    const onData = text => {
      for (const char of text) {
        if (char === '\u0003') return finish(null);
        if (char === '\r' || char === '\n') return finish(value);
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const password = await readPassword();
    if (password === null) process.exitCode = 130;
    else {
      await savePassword(password);
      console.log('管理员密码已加盐哈希并写入项目 .env；会话密钥已保留或自动补齐。重启服务后生效。');
    }
  } catch (error) { console.error(`设置密码失败：${error.message}`); process.exitCode = 1; }
}

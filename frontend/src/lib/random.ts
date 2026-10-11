// 这里只用 crypto.getRandomValues：它在普通 HTTP 的内网地址下也可用，
// 而 crypto.randomUUID 只在 HTTPS 或 localhost 下才存在。

/** 一个随机的 UUID（第 4 版），用作写操作的幂等编号。 */
export function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 去掉了 0/O、1/l/I 这些抄写时容易看错的字符。
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 给租户门户账号用的随机密码。 */
export function generatePassword(length = 16) {
  // 字节值超出字母表整数倍的部分丢弃，保证每个字符被选中的机会相同。
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  let password = '';
  while (password.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < limit && password.length < length) password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
    }
  }
  return password;
}

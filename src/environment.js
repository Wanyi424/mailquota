import { resolve } from 'node:path';
import { z } from 'zod';
import { email } from './validation.js';
export function environment(env = process.env) {
  const schema = z.object({
    STORAGE_DIR: z.string().default('./storage'), DATABASE_URL: z.string().min(1), PORT: z.coerce.number().int().min(1).max(65535).default(3000), HOST: z.string().default('127.0.0.1'),
    TRUST_PROXY: z.string().default('loopback'),
    ADMIN_USERNAME: z.string().min(1), ADMIN_PASSWORD_HASH: z.string().regex(/^\$2[aby]\$1[2-6]\$[./A-Za-z0-9]{53}$/),
    SESSION_SECRET: z.string().min(43), PUBLIC_ORIGIN: z.url().refine(v => ['http:', 'https:'].includes(new URL(v).protocol) && new URL(v).origin === v),
    SMTP_HOST: z.string().min(1), SMTP_PORT: z.coerce.number().int().min(1).max(65535), SMTP_SECURE: z.enum(['true', 'false']),
    SMTP_USER: z.string().min(1), SMTP_PASSWORD: z.string().min(1), SMTP_FROM: email,
  });
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`环境配置无效: ${[...new Set(result.error.issues.map(i => i.path[0]))].join(', ')}`);
  const c = result.data;
  return { root: resolve(c.STORAGE_DIR), databaseUrl: c.DATABASE_URL, host: c.HOST, port: c.PORT, trustProxy: c.TRUST_PROXY.split(',').map(v => v.trim()),
    admin: { username: c.ADMIN_USERNAME, passwordHash: c.ADMIN_PASSWORD_HASH, sessionSecret: c.SESSION_SECRET, origin: c.PUBLIC_ORIGIN },
    smtp: { host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_SECURE === 'true', requireTLS: c.SMTP_SECURE !== 'true', auth: { user: c.SMTP_USER, pass: c.SMTP_PASSWORD }, from: c.SMTP_FROM },
  };
}

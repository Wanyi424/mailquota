import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/database.js';
export async function initialize(connectionString) {
  const db = openDatabase(connectionString);
  try { await db.ensureSchema(); } finally { await db.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
  await initialize(process.env.DATABASE_URL); console.log('PostgreSQL 结构检查完成，请通过管理 API 创建租户。');
}

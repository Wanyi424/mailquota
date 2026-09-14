import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/database.js';
export function initialize(root) {
  const config = join(root, 'config', 'customers.json'), database = join(root, 'data', 'mailquota.sqlite');
  if (existsSync(config) || existsSync(database)) throw new Error('已有配置或数据库，拒绝重复初始化');
  for (const dir of ['config', 'templates', 'data']) mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
  const db = openDatabase(database, true); db.close();
  writeFileSync(config, JSON.stringify({ customers: [] }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  initialize(resolve(process.env.STORAGE_DIR || './storage')); console.log('持久化目录初始化完成，客户默认为空。请通过管理 API 创建客户。');
}

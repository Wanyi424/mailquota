import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
export function openDatabase(path, initialize = false) {
  const db = new Database(path, { fileMustExist: !initialize, timeout: 5000 });
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('synchronous = FULL');
  const v = db.pragma('user_version', { simple: true });
  if (initialize && v === 0) db.transaction(() => db.exec(readFileSync(new URL('../migrations/001.sql', import.meta.url), 'utf8')))();
  else if (v !== 1) { db.close(); throw new Error('数据库版本不受支持；请显式执行迁移，禁止重新初始化现有数据'); }
  return db;
}

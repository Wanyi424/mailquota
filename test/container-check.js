import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error('请设置 TEST_DATABASE_URL 或 DATABASE_URL');
const db = openDatabase(url);
try {
  await db.ensureSchema();
  const { rows } = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('tenants','send_requests','verification_codes','rate_limits')");
  assert.equal(rows.length, 4);
  console.log('PostgreSQL schema check passed.');
} finally {
  await db.end();
}

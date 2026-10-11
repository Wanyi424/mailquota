import pg from 'pg';
import { readFileSync } from 'node:fs';
export function openDatabase(connectionString, initialize = false) {
  if (!connectionString) throw new Error('DATABASE_URL 未配置');
  const pool = new pg.Pool({connectionString, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  // Idle connection errors must not terminate the process; readiness will report failures.
  pool.on('error', () => {});
  pool.transaction = async (fn, readOnly = false) => {
    const client = await pool.connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
  };
  pool.ensureSchema = () => pool.transaction(client => client.query(readFileSync(new URL('../migrations/001.sql', import.meta.url), 'utf8')));
  if (initialize) pool.initialization = pool.ensureSchema();
  return pool;
}

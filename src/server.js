import { join } from 'node:path';
import { openDatabase } from './database.js';
import { ConfigStore } from './config.js';
import { MailService } from './service.js';
import { createMailer } from './smtp.js';
import { createApp } from './app.js';
import { environment } from './environment.js';
const logger = event => console.log(JSON.stringify({ time: Date.now(), ...event }));
try {
  const env = environment();
  const db = openDatabase(join(env.root, 'data', 'mailquota.sqlite'));
  const config = new ConfigStore(env.root, db);
  const service = new MailService(db, config, createMailer(env.smtp), { logger });
  const app = createApp({ service, config, admin: env.admin, sender: env.smtp.from, trustProxy: env.trustProxy, logger });
  const cleanup = setInterval(() => { try { service.cleanup(); } catch { logger({ event: 'cleanup_failed' }); } }, 3600000); cleanup.unref();
  const server = app.listen(env.port, env.host, () => logger({ event: 'listening', port: env.port }));
  server.requestTimeout = 25000; server.headersTimeout = 10000;
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true; service.stopping = true;
    server.close(); clearInterval(cleanup);
    try { await service.stop(); app.locals.dispose(); db.close(); server.closeAllConnections(); process.exitCode = 0; }
    catch { logger({ event: 'shutdown_failed' }); process.exitCode = 1; }
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  server.on('error', () => { logger({ event: 'listen_failed' }); stop(); });
} catch (e) { console.error('MailQuota 启动失败，请核查环境配置、持久化目录和数据库版本。'); if (e.message.startsWith('环境配置无效:')) console.error(e.message); process.exitCode = 1; }

import { openDatabase } from './database.js';
import { ConfigStore } from './config.js';
import { MailService } from './service.js';
import { createMailer } from './smtp.js';
import { createApp } from './app.js';
import { environment } from './environment.js';
const logger = event => console.log(JSON.stringify({ time: Date.now(), ...event }));
try {
  const env = environment();
  const db = openDatabase(env.databaseUrl);
  await db.ensureSchema();
  const config = new ConfigStore(db);
  await config.check();
  const service = new MailService(db, config, createMailer(env.smtp), { logger, fromEmail: env.smtp.from });
  await service.recover();
  const app = createApp({ service, config, admin: env.admin, sender: env.smtp.from, trustProxy: env.trustProxy, logger });
  const cleanup = setInterval(() => { service.cleanup().catch(error => logger({ event: 'cleanup_failed', error: error.message })); }, 3600000); cleanup.unref();
  const server = app.listen(env.port, env.host, () => logger({ event: 'listening', port: env.port }));
  server.requestTimeout = 25000; server.headersTimeout = 10000;
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true; service.stopping = true;
    server.close(); clearInterval(cleanup);
    try { await service.stop(); app.locals.dispose(); await db.end(); server.closeAllConnections(); process.exitCode = 0; }
    catch { logger({ event: 'shutdown_failed' }); process.exitCode = 1; }
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  server.on('error', () => { logger({ event: 'listen_failed' }); stop(); });
} catch (e) { console.error('MailQuota 启动失败:', e.message || e); process.exitCode = 1; }

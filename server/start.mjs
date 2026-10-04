import { loadConfig } from './config.mjs';
import { createPool } from './db.mjs';
import { createMailer } from './mail.mjs';
import { createApplication } from './app.mjs';

const config = loadConfig();
const pool = createPool(config);
await pool.query('SELECT 1');
const { app } = createApplication({ pool, config, mailer: createMailer(config) });
const localOrigin = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.origin).hostname);
const server = app.listen(config.port, localOrigin ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(`Date Me Maybe backend → ${config.origin}`);
  if (config.devMailbox) console.log('Local acceptance mailbox enabled for .test addresses only.');
});
server.on('error', error => { console.error(error.code || 'SERVER_START_FAILED'); process.exitCode = 1; pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await pool.end(); process.exit(0); }));

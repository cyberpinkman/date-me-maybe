import { loadConfig } from '../server/config.mjs';
import { createPool, migrateDatabase } from '../server/db.mjs';
import { createAuth } from '../server/auth.mjs';
import { createMailer } from '../server/mail.mjs';

const config = loadConfig();
const pool = createPool(config);
try {
  const auth = createAuth({ pool, config, mailer: createMailer(config) });
  await migrateDatabase({ pool, auth });
  console.log('Database migrations applied.');
} finally { await pool.end(); }

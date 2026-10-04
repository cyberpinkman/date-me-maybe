import express from 'express';
import { attachDatabasePool } from '@vercel/functions';
import { loadConfig } from './server/config.mjs';
import { createPool } from './server/db.mjs';
import { createMailer } from './server/mail.mjs';
import { createApplication } from './server/app.mjs';

// Vercel recognizes this root Express entry. Initialization is once per warm
// instance; local development continues to use server/start.mjs and its listener.
const config = loadConfig();
const pool = createPool(config);
attachDatabasePool(pool);
const application = createApplication({ config, pool, mailer: createMailer(config) });
const app = express();
app.disable('x-powered-by');
app.use(application.app);

export default app;

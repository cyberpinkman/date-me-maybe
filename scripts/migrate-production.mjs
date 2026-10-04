import { createPool } from '../server/db.mjs';

// Schema setup needs a stable database session for its advisory lock. Neon
// injects this direct URL separately from the pooled URL used by the app.
if (process.env.NODE_ENV !== 'production') throw new Error('Use this command only in the production environment.');
if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('DATABASE_URL_UNPOOLED is required for production migrations.');
const url = new URL(process.env.DATABASE_URL_UNPOOLED);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname.includes('-pooler.')) {
  throw new Error('Production migrations require a direct PostgreSQL session connection.');
}
url.searchParams.set('sslmode', 'verify-full');
process.env.DATABASE_URL = url.href;

const pool = createPool({ databaseUrl: url.href });
try {
  const { rows } = await pool.query('SELECT ssl, version FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
  if (rows[0]?.ssl !== true) throw new Error('Production database TLS is required.');
  console.log('Production database TLS verified:', rows[0].version);
} finally { await pool.end(); }

await import('./migrate.mjs');

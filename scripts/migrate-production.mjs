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
  const client = await pool.connect();
  try {
    // Providers can terminate TLS at their proxy. pg_stat_ssl describes the
    // internal Postgres connection, not the client-to-provider TLS boundary.
    const transport = client.connection.stream;
    if (transport.encrypted !== true || transport.authorized !== true) {
      throw new Error('Production database TLS and certificate verification are required.');
    }
    console.log('Production database TLS and certificate verified:', transport.getProtocol());
  } finally { client.release(); }
} finally { await pool.end(); }

await import('./migrate.mjs');

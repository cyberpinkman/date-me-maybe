import { Pool } from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function createPool(config) {
  return new Pool({ connectionString: config.databaseUrl, max: 5, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
}

export async function migrateDatabase({ pool, auth }) {
  const client = await pool.connect();
  try {
    // Serialize schema setup, including Better Auth's pinned-version schema.
    await client.query("SELECT pg_advisory_lock(hashtext('opendater-schema'))");
    const authMigration = await getMigrations(auth.options);
    await authMigration.runMigrations();
    await client.query('CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    const pending = [];
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(`${directory}/${name}`, 'utf8');
      const digest = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query('SELECT digest FROM app_migrations WHERE name=$1', [name]);
      if (previous.rowCount) {
        if (previous.rows[0].digest !== digest) throw new Error(`Applied migration ${name} was changed. Add a new migration instead.`);
        continue;
      }
      pending.push({ name, sql, digest });
    }
    if (!pending.length) return;
    await client.query('BEGIN');
    try {
      // Drain old invitation readers that intend to write before taking the
      // backfill snapshot. Keep reads available, but hold every old writer until
      // the whole pending batch (including its writer guard) commits together.
      if ((await client.query("SELECT to_regclass('invitations') AS existing")).rows[0].existing) {
        await client.query('LOCK TABLE invitations IN EXCLUSIVE MODE');
      }
      for (const { name, sql, digest } of pending) {
        await client.query(sql);
        await client.query('INSERT INTO app_migrations(name,digest) VALUES($1,$2)', [name, digest]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('opendater-schema'))").catch(() => {});
    client.release();
  }
}

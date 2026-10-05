import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;
test('calendar migration atomically drains old writers and gates every subsequent invitation write', {
  skip: !databaseUrl && 'Set the explicitly isolated local TEST_DATABASE_URL', timeout: 60_000,
}, async t => {
  const url = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['55439', '65500'].includes(url.port));
  assert.equal(url.pathname, '/date_me_maybe_test');
  assert.ok(!url.searchParams.has('host') && !url.searchParams.has('port'));
  const [{ Pool }, { getMigrations }, { createAuth }, { migrateDatabase }, { createInvitationService }] = await Promise.all([
    import('pg'), import('better-auth/db/migration'), import('../server/auth.mjs'),
    import('../server/db.mjs'), import('../server/invitations.mjs'),
  ]);
  const base = new Pool({ connectionString: databaseUrl });
  assert.equal((await base.query('SELECT current_database() AS name')).rows[0].name, 'date_me_maybe_test');
  const schema = `writer_test_${randomUUID().replaceAll('-', '')}`;
  await base.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
  await base.query(`CREATE SCHEMA ${schema}`);
  const options = { connectionString: databaseUrl, options: `-c search_path=${schema},public` };
  const pool = new Pool({ ...options, max: 8 }), writerPool = new Pool({ ...options, max: 1 });
  t.after(async () => {
    await writerPool.end(); await pool.end();
    await base.query(`DROP SCHEMA ${schema} CASCADE`); await base.end();
  });
  const config = {
    origin: 'http://127.0.0.1:3010', secret: 'calendar-writer-test-secret-only-000000000000',
    shareSecret: 'calendar-writer-test-share-only-00000000000',
    isProduction: false, devMailbox: false,
  };
  const auth = createAuth({ pool, config, mailer: {} });
  await (await getMigrations(auth.options)).runMigrations();
  const initial = await readFile(new URL('../db/migrations/001_invitations.sql', import.meta.url), 'utf8');
  await pool.query(initial);
  await pool.query('CREATE TABLE app_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('INSERT INTO app_migrations(name,digest) VALUES($1,$2)', ['001_invitations.sql', createHash('sha256').update(initial).digest('hex')]);
  async function user() {
    const id = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,now(),now())', [id, `${id}@example.test`]);
    return id;
  }
  const owner = await user(), id = randomUUID();
  const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const legacy = { id, version: 1, mode: 'fixed', timeZone: 'Asia/Shanghai', closed: false, responded: false,
    approvals: { host: 1, guest: null }, proposal: { date, time: '19:00', place: '公园', activity: '散个步', preferences: { hints: [], detail: '' } } };
  await pool.query('INSERT INTO invitations(id,owner_id,guest_token_hash,guest_token_encrypted,state,version) VALUES($1,$2,$3,$4,$5,1)', [id, owner, randomUUID(), randomUUID(), legacy]);

  await t.test('a failure in the last migration rolls back backfill, schema and migration receipts together', async () => {
    // A name collision makes 003 fail after 002 has completed inside the batch.
    await pool.query('CREATE FUNCTION enforce_calendar_invitation_writer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
    await assert.rejects(migrateDatabase({ pool, auth }), { code: '42723' });
    assert.equal((await pool.query('SELECT to_regclass($1) AS table_name', [`${schema}.calendar_reservations`])).rows[0].table_name, null);
    assert.deepEqual((await pool.query('SELECT name FROM app_migrations ORDER BY name')).rows.map(row => row.name), ['001_invitations.sql']);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname='calendar_invitation_writer'", [`${schema}.invitations`])).rows[0].n, 0);
    await pool.query('UPDATE invitations SET updated_at=now() WHERE id=$1', [id]);
    await pool.query('DROP FUNCTION enforce_calendar_invitation_writer()');
  });

  await t.test('backfill waits for an old in-flight writer and includes its final committed agreement', async () => {
    const old = await pool.connect();
    let failure;
    try {
      await old.query('BEGIN');
      await old.query('SELECT * FROM invitations WHERE id=$1 FOR UPDATE', [id]);
      // This legacy update succeeds before the guard, reproducing the rollout
      // hazard: it knows nothing about the future calendar reservations table.
      await old.query('UPDATE invitations SET state=$1 WHERE id=$2', [{ ...legacy, responded: true, approvals: { host: 1, guest: 1 } }, id]);
      const migration = migrateDatabase({ pool, auth }).catch(error => { failure = error; });
      const deadline = Date.now() + 10_000;
      let waiting = false;
      while (Date.now() < deadline && !failure) {
        waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation=$1::regclass AND mode='ExclusiveLock' AND NOT granted) AS waiting", [`${schema}.invitations`])).rows[0].waiting;
        if (waiting) break;
        await delay(20);
      }
      await old.query('COMMIT');
      await migration;
      if (failure) throw failure;
      assert.equal(waiting, true, 'The batch must drain preexisting writers before taking its backfill snapshot');
    } finally { await old.query('ROLLBACK'); old.release(); }
    const bookings = (await pool.query('SELECT * FROM calendar_reservations WHERE invitation_id=$1', [id])).rows;
    assert.equal(bookings.length, 1);
    assert.equal(new Date(bookings[0].starts_at).toISOString(), `${date}T11:00:00.000Z`);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM app_migrations')).rows[0].n, 3);
    await migrateDatabase({ pool, auth }); // Reapplying the unchanged batch is a no-op.
  });

  await t.test('unmarked legacy inserts and updates fail, with the entire attempted mutation rolled back', async () => {
    await assert.rejects(pool.query('UPDATE invitations SET updated_at=now() WHERE id=$1', [id]), { code: '55000' });
    const newId = randomUUID();
    await assert.rejects(pool.query('INSERT INTO invitations(id,owner_id,guest_token_hash,guest_token_encrypted,state,version) VALUES($1,$2,$3,$4,$5,1)', [newId, owner, randomUUID(), randomUUID(), { ...legacy, id: newId }]), { code: '55000' });
    const old = await pool.connect(), key = randomUUID();
    try {
      await old.query('BEGIN');
      await old.query('INSERT INTO app_rate_limits(key_hash,window_start,count) VALUES($1,now(),1)', [key]);
      await assert.rejects(old.query('UPDATE invitations SET state=$1 WHERE id=$2', [legacy, id]), { code: '55000' });
      await old.query('ROLLBACK');
    } finally { old.release(); }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM app_rate_limits WHERE key_hash=$1', [key])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT state FROM invitations WHERE id=$1', [id])).rows[0].state.approvals.guest, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM calendar_reservations WHERE invitation_id=$1', [id])).rows[0].n, 1);
  });

  await t.test('the current service writes consent with reservations and its pooled marker expires on commit or rollback', async () => {
    const service = createInvitationService({ pool: writerPool, config }), owner = await user();
    const draft = { from: 'A', to: 'B', tone: 'playful', message: '一起见面吧', mode: 'fixed',
      options: [{ date, time: '19:00' }], activity: '散个步', place: '公园', timeZone: 'Asia/Shanghai' };
    const a = await service.create(owner, { draft, requestId: randomUUID() });
    const b = await service.create(owner, { draft, requestId: randomUUID() });
    const access = invitation => ({ token: new URL(invitation.shareUrl).pathname.split('/').at(-1) });
    const confirmed = await service.transition(access(a), { type: 'confirm', version: a.version, requestId: randomUUID() });
    assert.equal(confirmed.approvals.guest, confirmed.version);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM calendar_reservations WHERE invitation_id=$1', [a.id])).rows[0].n, 1);
    await assert.rejects(writerPool.query('UPDATE invitations SET updated_at=now() WHERE id=$1', [a.id]), { code: '55000' });
    await assert.rejects(service.transition(access(b), { type: 'confirm', version: b.version, requestId: randomUUID() }), { code: 'TIME_UNAVAILABLE' });
    await assert.rejects(writerPool.query('UPDATE invitations SET updated_at=now() WHERE id=$1', [b.id]), { code: '55000' });
    assert.equal((await pool.query('SELECT state FROM invitations WHERE id=$1', [b.id])).rows[0].state.approvals.guest, null);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM calendar_reservations WHERE invitation_id=$1', [b.id])).rows[0].n, 0);
  });
});

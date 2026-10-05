import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Model from '../src/model.js';
import { createAdminDataService } from '../server/admin-data.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
test('admin read model: exact status, honest cohorts, pagination and explicit safe projection', {
  skip: !databaseUrl && 'Set the explicitly isolated local TEST_DATABASE_URL', timeout: 60_000,
}, async t => {
  const url = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['55439', '65500'].includes(url.port));
  assert.equal(url.pathname, '/date_me_maybe_test');
  assert.ok(!url.searchParams.has('host') && !url.searchParams.has('port'));
  const { Pool } = await import('pg');
  const base = new Pool({ connectionString: databaseUrl });
  assert.equal((await base.query('SELECT current_database() AS name')).rows[0].name, 'date_me_maybe_test');
  const schema = `admin_data_${randomUUID().replaceAll('-', '')}`;
  await base.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
  await base.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
  t.after(async () => { await pool.end(); await base.query(`DROP SCHEMA ${schema} CASCADE`); await base.end(); });
  await pool.query('CREATE TABLE "user"(id text PRIMARY KEY,name text NOT NULL,email text NOT NULL,"emailVerified" boolean NOT NULL,"createdAt" timestamptz NOT NULL)');
  for (const name of ['001_invitations.sql', '002_scheduling.sql', '003_calendar_writer.sql']) {
    await pool.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const current = new Date('2031-05-02T16:30:00Z'); // May 3 in Shanghai.
  const service = createAdminDataService({ pool, now: () => current });
  const owner = 'betterAuth-text-owner', guest = 'betterAuth-text-guest', idle = 'user-idle';
  await pool.query(`INSERT INTO "user" VALUES
    ($1,'林 100%_','owner@example.test',true,'2031-05-01T15:59:59Z'),
    ($2,'访客','guest@example.test',true,'2031-05-01T16:00:00Z'),
    ($3,'没有邀约','idle@example.test',false,'2031-05-02T16:00:00Z')`, [owner, guest, idle]);
  const states = new Map();
  const proposal = { date: '2031-05-09', time: '18:00', place: 'PRIVATE_PLACE', activity: '吃饭', preferences: { hints: ['PRIVATE_HINT'], detail: '' } };
  const offered = { ...proposal, timeOptions: [{ date: proposal.date, time: proposal.time }], placeOptions: [proposal.place], activities: ['吃饭'], preferences: { hints: ['PRIVATE_HINT'], details: { 吃饭: ['川菜', '粤菜'] }, detail: '川菜' } };
  async function invite(patch = {}, createdAt = '2031-05-02T16:00:00Z') {
    const id = randomUUID();
    const state = { id, from: '邀请人', to: '收件人', mode: 'open', version: 1, responded: false, closed: false,
      approvals: { host: null, guest: null }, proposal: null, history: [], message: 'PRIVATE_MESSAGE', ...patch };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('opendater.calendar_writer','v1',true)");
      await client.query('INSERT INTO invitations(id,owner_id,guest_token_hash,guest_token_encrypted,state,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)', [id, owner, `SECRET_HASH_${id}`, `SECRET_TOKEN_${id}`, state, state.version, createdAt]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); }
    states.set(id, state);
    return id;
  }
  const waiting = await invite();
  const approved = { host: 1, guest: 1 };
  const confirmed = await invite({ mode: 'host', responded: true, proposal: offered, approvals: approved });
  const historic = { version: 1, proposal, approvals: approved };
  const cancelled = await invite({ closed: 'cancelled', responded: true, proposal, approvals: approved });
  await invite({ closed: true });
  const revised = await invite({ version: 2, responded: true, proposal: { ...proposal, date: '2031-05-10' }, approvals: { host: null, guest: 2 }, history: [historic] });
  await invite({ responded: true, proposal, approvals: { host: 1, guest: null } });
  await invite({ responded: true, proposal: { ...proposal, place: '' }, approvals: approved });
  await invite({ proposal: { ...proposal, activities: ['吃饭'], activity: '' }, approvals: approved });
  await invite({ mode: 'host', proposal: offered, approvals: { host: 1, guest: null } });
  await invite({ proposal: offered, responded: true, approvals: { host: null, guest: 1 } });
  await invite({ proposal: { ...offered, preferences: { ...offered.preferences, detail: '' } }, responded: true, approvals: approved });
  await invite({ proposal: { ...offered, preferences: { details: { 吃饭: [] }, detail: '' } }, responded: true, approvals: approved });
  await invite({ proposal: { ...proposal, activities: ['吃饭'] }, responded: true, approvals: approved });
  await invite({ mode: 'fixed', proposal, approvals: approved, responded: false }); // Legacy successful record.
  const old = await invite({ proposal, responded: true, approvals: approved }, '2031-03-01T00:00:00Z');
  // An ongoing meeting is counted once even though both known people reserve it.
  await pool.query('INSERT INTO invitation_guest_accounts(invitation_id,user_id) VALUES($1,$3),($2,$3)', [confirmed, revised, guest]);
  await pool.query('INSERT INTO user_schedules(user_id,time_zone,weekly,overrides) VALUES($1,\'Asia/Shanghai\',\'{}\',\'{}\')', [owner]);
  for (const person of [owner, guest]) {
    await pool.query("INSERT INTO calendar_reservations(id,user_id,invitation_id,kind,starts_at,ends_at) VALUES($1,$2,$3,'booking','2031-05-02T16:00:00Z','2031-05-02T18:00:00Z')", [randomUUID(), person, confirmed]);
  }
  await pool.query("INSERT INTO calendar_reservations(id,user_id,kind,starts_at,ends_at,label) VALUES($1,$2,'busy','2031-05-04T00:00:00Z','2031-05-04T01:00:00Z','PRIVATE_BUSY')", [randomUUID(), owner]);

  await t.test('status queries match the shared model across current and legacy states', async () => {
    const listed = await service.invitations({ pageSize: '100' });
    assert.equal(listed.total, states.size);
    for (const item of listed.items) assert.equal(item.status, Model.status(states.get(item.id)), item.id);
    for (const status of ['waiting', 'confirmed', 'host_review', 'guest_review', 'details', 'cancelled', 'declined']) {
      const expected = [...states].filter(([, state]) => Model.status(state) === status).map(([id]) => id).sort();
      const actual = await service.invitations({ status, pageSize: '100' });
      assert.deepEqual(actual.items.map(item => item.id).sort(), expected);
      assert.equal(actual.total, expected.length);
    }
    assert.equal((await service.invitations({ mode: 'fixed' })).items[0].mode, 'fixed');
  });
  await t.test('overview distinguishes current confirmations, historical cohort conversion and people from bookings', async () => {
    const data = await service.overview();
    assert.equal(data.timeZone, 'Asia/Shanghai');
    assert.deepEqual(data.period, { days: 30, from: '2031-04-04', to: '2031-05-03' });
    assert.equal(data.daily.length, 30);
    assert.deepEqual(data.daily.slice(-3).map(day => day.registrations), [1, 1, 1]);
    assert.deepEqual(data.daily.slice(-1)[0], { date: '2031-05-03', registrations: 1, invitations: states.size - 1 });
    assert.equal(data.totals.users, 3);
    assert.equal(data.totals.invitations, states.size);
    assert.equal(data.totals.confirmedInvitations, [...states.values()].filter(state => Model.status(state) === 'confirmed').length);
    assert.equal(data.totals.cancelledInvitations, 1);
    assert.equal(data.totals.scheduledUsers, 1);
    assert.equal(data.totals.upcomingBookings, 1);
    assert.equal(data.totals.boundGuests, 1);
    assert.equal(data.funnel.invitations, states.size - 1);
    assert.equal(data.funnel.everConfirmed, 6); // current(4), cancellation(1), revision history(1), excludes old cohort.
    assert.ok(data.funnel.responded >= data.funnel.everConfirmed);
    assert.equal((await service.overview({ days: '7' })).daily.length, 7);
    assert.equal((await service.overview({ days: '90' })).daily.length, 90);
  });
  await t.test('stable SQL pagination and literal search preserve counts including empty pages', async () => {
    const first = await service.users({ pageSize: '1' }), second = await service.users({ pageSize: '1', page: '2' });
    assert.equal(first.total, 3); assert.equal(first.items[0].id, idle); assert.equal(second.items[0].id, guest);
    const end = await service.users({ page: '99' });
    assert.equal(end.total, 3); assert.deepEqual(end.items, []);
    assert.equal((await service.users({ search: '100%_' })).items[0].id, owner);
    assert.equal((await service.users({ search: '%' })).total, 1);
    assert.equal((await service.users({ search: "' OR 1=1 --" })).total, 0);
    assert.equal((await service.users({ hasInvitations: 'true' })).total, 1);
    assert.equal((await service.users({ hasInvitations: 'false' })).total, 2);
    const sorted = (await service.invitations({ pageSize: '100' })).items.map(item => item.id);
    assert.deepEqual((await service.invitations({ page: '2', pageSize: '3' })).items.map(item => item.id), sorted.slice(3, 6));
    assert.equal((await service.invitations({ search: 'owner@example.test' })).total, states.size);
    assert.equal((await service.invitations({ search: '收件人' })).total, states.size);
    assert.equal((await service.invitations({ search: 'PRIVATE_PLACE' })).total, 0);
  });
  await t.test('detail uses explicit owner/bound relationships and returns no private payload or capabilities', async () => {
    const host = await service.user(owner), bound = await service.user(guest);
    assert.equal(host.user.id, owner); assert.equal(host.user.scheduleConfigured, true);
    assert.equal(host.summary.manualBusyBlocks, 1); assert.equal(host.summary.upcomingBookings, 1);
    assert.equal(host.invitationsTotal, states.size); assert.ok(host.invitations.every(item => item.role === 'host'));
    assert.equal(bound.summary.boundInvitations, 2); assert.equal(bound.invitationsTotal, 2);
    assert.ok(bound.invitations.every(item => item.role === 'guest'));
    assert.deepEqual(new Set(bound.invitations.map(item => item.id)), new Set([confirmed, revised]));
    assert.equal((await service.user(idle)).invitationsTotal, 0);
    const all = JSON.stringify([host, bound, await service.invitations(), await service.overview()]);
    for (const secret of ['PRIVATE_PLACE', 'PRIVATE_HINT', 'PRIVATE_MESSAGE', 'PRIVATE_BUSY', 'SECRET_HASH', 'SECRET_TOKEN', 'shareUrl', 'guestUrl', 'guest_token', 'approvals', 'history']) assert.ok(!all.includes(secret), secret);
    assert.deepEqual(Object.keys(host.user).sort(), ['id','name','email','emailVerified','joinedAt','invitations','respondedInvitations','confirmedInvitations','scheduleConfigured'].sort());
    await assert.rejects(service.user('missing-user'), { code: 'ADMIN_USER_NOT_FOUND', status: 404 });
  });
  await t.test('query validation rejects ambiguous, unbounded and unknown parameters before SQL', async () => {
    for (const query of [{ page: '0' }, { page: '01' }, { pageSize: '101' }, { page: '1e3' }, { search: ['one','two'] }, { search: 'x'.repeat(201) }, { search: '\u0000' }, { q: 'old' }, { hasInvitations: 'yes' }]) await assert.rejects(service.users(query), { code: 'INVALID_ADMIN_QUERY', status: 422 });
    for (const query of [{ status: 'all' }, { mode: 'anything' }, { limit: '200' }]) await assert.rejects(service.invitations(query), { code: 'INVALID_ADMIN_QUERY' });
    for (const query of [{ days: '8' }, { days: '0' }, { days: ['30'] }, { timezone: 'UTC' }]) await assert.rejects(service.overview(query), { code: 'INVALID_ADMIN_QUERY' });
    await assert.rejects(service.user('x'.repeat(129)), { code: 'INVALID_ADMIN_QUERY' });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM invitations')).rows[0].n, states.size, 'Every admin operation is read-only');
  });
});

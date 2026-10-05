import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSchedulingService } from '../server/scheduling.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
function guard(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['55439', '65500'].includes(url.port));
  assert.equal(url.pathname, '/date_me_maybe_test');
  assert.ok(!url.searchParams.has('host') && !url.searchParams.has('port'));
}
test('PostgreSQL scheduling invariant, lifecycle and availability', {
  skip: !databaseUrl && 'Set the explicitly isolated local TEST_DATABASE_URL', timeout: 120_000,
}, async t => {
  guard(databaseUrl);
  const { Pool } = await import('pg');
  const base = new Pool({ connectionString: databaseUrl });
  const schema = `schedule_test_${randomUUID().replaceAll('-', '')}`;
  assert.equal((await base.query('SELECT current_database() AS name')).rows[0].name, 'date_me_maybe_test');
  await base.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
  await base.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema},public` });
  t.after(async () => { await pool.end(); await base.query(`DROP SCHEMA ${schema} CASCADE`); await base.end(); });
  await pool.query('CREATE TABLE "user"(id text PRIMARY KEY)');
  await pool.query(await readFile(new URL('../db/migrations/001_invitations.sql', import.meta.url), 'utf8'));
  const current = new Date('2031-05-01T00:00:00Z');
  const service = createSchedulingService({ pool, now: () => current });
  const week = () => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, [{ start: '18:00', end: '22:00' }]]));
  const settings = () => ({ timeZone: 'Asia/Shanghai', weekly: week(), overrides: {} });
  async function user() { const id = randomUUID(); await pool.query('INSERT INTO "user"(id) VALUES($1)', [id]); return id; }
  async function invitation(owner, patch = {}) {
    const id = randomUUID(), version = 1;
    const state = { id, version, mode: 'fixed', timeZone: 'Asia/Shanghai', timePolicy: 'free', durationMinutes: 120,
      from: '发起人', to: '受邀人', closed: false, responded: true, approvals: { host: version, guest: version },
      proposal: { date: '2031-05-04', time: '19:00', place: '公园', activity: '散个步', preferences: { hints: [], detail: '' } }, ...patch };
    return (await pool.query('INSERT INTO invitations(id,owner_id,guest_token_hash,guest_token_encrypted,state,version) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [id, owner, randomUUID(), randomUUID(), state, state.version])).rows[0];
  }
  async function tx(run) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const value = await run(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function confirm(row, state = row.state) { return tx(client => service.syncConfirmed(client, row, state)); }
  const oldOwner = await user();
  const oldA = await invitation(oldOwner), oldB = await invitation(oldOwner);
  const brokenOwner = await user();
  const broken = await invitation(brokenOwner, { proposal: { date: 'not-a-date', time: '19:00', place: '旧地点' } });
  const revisedOwner = await user(), revised = await invitation(revisedOwner);
  const previous = structuredClone(revised.state);
  revised.state = { ...revised.state, version: 2, approvals: { host: 2, guest: null }, history: [{ version: 1, proposal: previous.proposal, approvals: previous.approvals }], proposal: { ...previous.proposal, date: '2031-05-05' } };
  await pool.query('UPDATE invitations SET state=$1,version=2 WHERE id=$2', [revised.state, revised.id]);
  const dstOwner = await user(), ambiguous = await invitation(dstOwner, { timeZone: 'America/New_York', proposal: { date: '2031-11-02', time: '01:30', place: '旧地点' } });
  await pool.query(await readFile(new URL('../db/migrations/002_scheduling.sql', import.meta.url), 'utf8'));

  await t.test('migration retains legacy overlapping occupancy and surfaces unresolved records', async () => {
    const rows = (await pool.query('SELECT * FROM calendar_reservations WHERE user_id=$1', [oldOwner])).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.legacy_conflict));
    assert.equal((await service.listCalendar(oldOwner)).conflicts.length, 2);
    const blocked = await invitation(oldOwner);
    await assert.rejects(confirm(blocked), { code: 'TIME_UNAVAILABLE' });
    assert.equal((await service.listCalendar(brokenOwner)).conflicts[0].invitationId, broken.id);
    const unknown = await invitation(brokenOwner);
    await assert.rejects(confirm(unknown), { code: 'CALENDAR_NEEDS_REVIEW' });
    const guest = await user();
    await assert.rejects(tx(client => service.bindGuest(client, broken, guest)), { code: 'CALENDAR_NEEDS_REVIEW' });
    await tx(client => service.syncConfirmed(client, broken, { ...broken.state, closed: true }));
    await confirm(unknown);
    await assert.rejects(pool.query('UPDATE calendar_reservations SET starts_at=starts_at+interval \'1 hour\' WHERE invitation_id=$1', [oldA.id]), { code: '23514' });
    await tx(client => service.syncConfirmed(client, oldB, { ...oldB.state, closed: true }));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM calendar_reservations WHERE user_id=$1', [oldOwner])).rows[0].n, 1);
    assert.equal((await service.listCalendar(oldOwner)).conflicts.length, 0);
    assert.equal((await service.listCalendar(revisedOwner)).bookings[0].start, '2031-05-04T11:00:00.000Z');
    assert.equal((await service.listCalendar(dstOwner)).conflicts[0].invitationId, ambiguous.id);
    assert.equal((await service.listCalendar(dstOwner)).bookings.length, 0);
  });

  await t.test('database boundary rejects concurrent overlaps even when callers bypass the service', async () => {
    const owner = await user();
    const insert = () => pool.query("INSERT INTO calendar_reservations(id,user_id,kind,starts_at,ends_at) VALUES($1,$2,'busy','2031-05-04T11:00Z','2031-05-04T13:00Z')", [randomUUID(), owner]);
    const results = await Promise.allSettled([insert(), insert()]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, '23P01');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM calendar_reservations WHERE user_id=$1', [owner])).rows[0].n, 1);
    await assert.rejects(pool.query("INSERT INTO calendar_reservations(id,user_id,kind,starts_at,ends_at,legacy_conflict) VALUES($1,$2,'busy','2031-05-04T15:00Z','2031-05-04T16:00Z',true)", [randomUUID(), owner]), { code: '23514' });
  });

  await t.test('two independent invitations cannot confirm overlapping intervals for one account', async () => {
    const owner = await user(), a = await invitation(owner), b = await invitation(owner);
    b.state.proposal.time = '20:00';
    const results = await Promise.allSettled([confirm(a), confirm(b)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'TIME_UNAVAILABLE');
    const adjacent = await invitation(owner);
    adjacent.state.proposal.time = '22:00';
    await confirm(adjacent);
    assert.equal((await service.listCalendar(owner)).bookings.length, 2);
  });

  await t.test('weekly hours, overrides, duration, rolling horizon and busy intervals share one availability rule', async () => {
    const owner = await user();
    await service.saveSchedule(owner, settings());
    const row = await invitation(owner, { timePolicy: 'schedule' });
    row.state.options = [{ date: '2031-05-06', time: '18:00' }];
    const initial = await service.availability(row);
    assert.deepEqual(initial.candidateSlots, [{ date: '2031-05-04', time: '19:00', available: true }], 'A revised legacy proposal takes precedence over its original options');
    assert.deepEqual(initial.slots.filter(slot => slot.date === '2031-05-04').map(slot => slot.time), ['18:00', '18:30', '19:00', '19:30', '20:00']);
    assert.equal(initial.slots.some(slot => slot.date >= '2031-05-31'), false);
    assert.equal(initial.slots.some(slot => slot.date === '2031-05-30'), true);
    const busy = await service.addBusy(owner, { date: '2031-05-04', time: '19:00', durationMinutes: 60, label: '工作安排' });
    const remaining = await service.availability(row);
    assert.deepEqual(remaining.slots.filter(slot => slot.date === '2031-05-04').map(slot => slot.time), ['20:00']);
    await assert.rejects(confirm(row), { code: 'TIME_UNAVAILABLE' });
    await assert.rejects(service.addBusy(owner, { date: '2031-05-04', time: '19:30', durationMinutes: 60 }), { code: 'TIME_UNAVAILABLE' });
    await assert.rejects(service.removeBusy(await user(), busy.id), { code: 'BUSY_NOT_FOUND' });
    await service.removeBusy(owner, busy.id);
    await service.saveSchedule(owner, { ...settings(), overrides: { '2031-05-04': [] } });
    assert.equal((await service.availability(row)).slots.some(slot => slot.date === '2031-05-04'), false);
    await assert.rejects(confirm(row), { code: 'TIME_UNAVAILABLE' });
    assert.ok(!JSON.stringify(remaining).includes('工作安排'));
    assert.ok(!JSON.stringify(remaining).includes(owner));
    await assert.rejects(service.saveSchedule(owner, { ...settings(), weekly: { 0: [{ start: '18:00', end: '21:00' }, { start: '20:00', end: '22:00' }] } }), { code: 'INVALID_SCHEDULE' });
    const adjacent = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, [{ start: '18:00', end: '20:00' }, { start: '20:00', end: '22:00' }]]));
    await service.saveSchedule(owner, { ...settings(), weekly: adjacent });
    assert.deepEqual((await service.availability(row)).slots.filter(slot => slot.date === '2031-05-04').map(slot => slot.time), ['18:00', '18:30', '19:00', '19:30', '20:00']);
    const allDay = await service.addBusy(owner, { date: '2031-05-04', allDay: true, label: '出行' });
    assert.equal((await service.availability(row)).slots.some(slot => slot.date === '2031-05-04'), false);
    await service.removeBusy(owner, allDay.id);
    const today = await service.addBusy(owner, { date: '2031-05-01', allDay: true });
    assert.equal(today.start, '2031-04-30T16:00:00.000Z');
    await assert.rejects(service.addBusy(owner, { date: '2031-05-01', time: '00:00', durationMinutes: 60 }), { code: 'INVALID_SCHEDULE' });
    await assert.rejects(service.addBusy(owner, { date: '2031-05-04', time: '00:00', durationMinutes: 1441 }), { code: 'INVALID_SCHEDULE' });
  });

  await t.test('all-day busy follows local calendar boundaries on 23-hour and 25-hour days', async () => {
    for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
      const clock = new Date(`${date}T12:00:00Z`), owner = await user();
      const local = createSchedulingService({ pool, now: () => clock });
      await local.saveSchedule(owner, { ...settings(), timeZone: 'America/New_York' });
      const input = { date, allDay: true, requestId: randomUUID() };
      const busy = await local.addBusy(owner, input);
      assert.equal((Date.parse(busy.end) - Date.parse(busy.start)) / 3_600_000, hours);
      assert.deepEqual(await local.addBusy(owner, input), busy);
      await assert.rejects(local.addBusy(owner, { ...input, time: '00:00' }), { code: 'INVALID_SCHEDULE' });
      await assert.rejects(local.addBusy(owner, { ...input, durationMinutes: 1440 }), { code: 'INVALID_SCHEDULE' });
    }
  });

  await t.test('manual busy retries replay their original response without resurrecting removed intervals', async () => {
    const owner = await user(), input = { date: '2031-05-04', time: '19:00', durationMinutes: 60, label: '工作', requestId: randomUUID() };
    const [first, repeated] = await Promise.all([service.addBusy(owner, input), service.addBusy(owner, input)]);
    assert.deepEqual(repeated, first);
    assert.equal((await service.listCalendar(owner)).busy.length, 1);
    await assert.rejects(service.addBusy(owner, { ...input, time: '20:00' }), { code: 'IDEMPOTENCY_CONFLICT' });
    const other = await service.addBusy(await user(), input);
    assert.notEqual(other.id, first.id);
    await service.removeBusy(owner, first.id);
    assert.deepEqual(await service.addBusy(owner, input), first);
    assert.equal((await service.listCalendar(owner)).busy.length, 0);
  });

  await t.test('pending candidates do not reserve and a stale choice is rejected at final confirmation', async () => {
    const owner = await user(), pending = await invitation(owner, { approvals: { host: null, guest: 1 } });
    await tx(async client => { await service.assertProposal(client, pending, pending.state, { type: 'respond' }); await service.syncConfirmed(client, pending, pending.state); });
    assert.equal((await service.listCalendar(owner)).bookings.length, 0);
    const winner = await invitation(owner);
    await confirm(winner);
    const final = { ...pending.state, approvals: { host: 1, guest: 1 } };
    await assert.rejects(confirm(pending, final), { code: 'TIME_UNAVAILABLE' });
    assert.equal((await service.listCalendar(owner)).bookings[0].invitationId, winner.id);
  });

  await t.test('availability edits preserve exact confirmed intervals, including later location changes', async () => {
    const owner = await user(), row = await invitation(owner, { timePolicy: 'schedule', options: [] });
    await service.saveSchedule(owner, settings());
    await confirm(row);
    await service.saveSchedule(owner, { ...settings(), overrides: { '2031-05-04': [] } });
    assert.deepEqual((await service.availability(row)).candidateSlots, [{ date: '2031-05-04', time: '19:00', available: true }]);
    const pending = { ...row.state, version: 2, approvals: { host: 2, guest: null }, proposal: { ...row.state.proposal, place: '新集合点' } };
    await tx(client => service.assertProposal(client, row, pending, { type: 'propose', proposal: { place: '新集合点' } }));
    await confirm(row, { ...pending, approvals: { host: 2, guest: 2 } });
    assert.equal((await service.listCalendar(owner)).bookings[0].start, '2031-05-04T11:00:00.000Z');
    await assert.rejects(confirm(row, { ...row.state, proposal: { ...row.state.proposal, time: '20:00' } }), { code: 'TIME_UNAVAILABLE' });
  });

  await t.test('rescheduling preserves the old reservation until an atomic successful swap; cancel releases it', async () => {
    const owner = await user(), row = await invitation(owner);
    await confirm(row);
    const pending = { ...row.state, version: 2, approvals: { host: 2, guest: null }, proposal: { ...row.state.proposal, time: '21:00' } };
    await confirm(row, pending);
    assert.equal((await service.listCalendar(owner)).bookings[0].start, '2031-05-04T11:00:00.000Z');
    const busy = await service.addBusy(owner, { date: '2031-05-04', time: '21:00', durationMinutes: 60 });
    const accepted = { ...pending, approvals: { host: 2, guest: 2 } };
    await assert.rejects(confirm(row, accepted), { code: 'TIME_UNAVAILABLE' });
    assert.equal((await service.listCalendar(owner)).bookings[0].start, '2031-05-04T11:00:00.000Z');
    await service.removeBusy(owner, busy.id);
    await confirm(row, accepted);
    assert.equal((await service.listCalendar(owner)).bookings[0].start, '2031-05-04T13:00:00.000Z');
    await confirm(row, { ...accepted, closed: true });
    assert.equal((await service.listCalendar(owner)).bookings.length, 0);
  });

  await t.test('explicit guest binding checks received and initiated bookings; both participants swap atomically', async () => {
    const owner = await user(), guest = await user(), row = await invitation(owner), outgoing = await invitation(guest);
    await confirm(row); await confirm(outgoing);
    await assert.rejects(tx(client => service.bindGuest(client, row, owner)), { code: 'SELF_BINDING' });
    await assert.rejects(tx(client => service.bindGuest(client, row, guest)), { code: 'TIME_UNAVAILABLE' });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM invitation_guest_accounts WHERE invitation_id=$1', [row.id])).rows[0].n, 0);
    await confirm(outgoing, { ...outgoing.state, closed: true });
    const bound = await tx(client => service.bindGuest(client, row, guest));
    assert.equal(bound.calendarBound, true);
    assert.equal(bound.booking.date, '2031-05-04');
    await tx(client => service.bindGuest(client, row, guest));
    assert.equal((await service.listCalendar(guest)).bookings.length, 1);
    await assert.rejects(tx(async client => service.bindGuest(client, row, await user())), { code: 'ALREADY_BOUND' });
    const busy = await service.addBusy(guest, { date: '2031-05-05', time: '19:00', durationMinutes: 120 });
    const rescheduled = { ...row.state, proposal: { ...row.state.proposal, date: '2031-05-05' } };
    await assert.rejects(confirm(row, rescheduled), { code: 'TIME_UNAVAILABLE' });
    for (const userId of [owner, guest]) assert.equal((await service.listCalendar(userId)).bookings[0].start, '2031-05-04T11:00:00.000Z');
    await service.removeBusy(guest, busy.id);
    await confirm(row, rescheduled);
    for (const userId of [owner, guest]) assert.equal((await service.listCalendar(userId)).bookings[0].start, '2031-05-05T11:00:00.000Z');
    await confirm(row, { ...rescheduled, closed: true });
    for (const userId of [owner, guest]) assert.equal((await service.listCalendar(userId)).bookings.length, 0);
  });
});

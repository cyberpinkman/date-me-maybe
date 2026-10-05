const assert = require('node:assert/strict');
const test = require('node:test');

test('wall time resolves to one actual instant and rejects DST gaps and folds', async () => {
  const { resolveWallTime, durationMinutes } = await import('../server/scheduling.mjs');
  assert.equal(resolveWallTime('2031-05-04', '19:00', 'Asia/Shanghai').toISOString(), '2031-05-04T11:00:00.000Z');
  assert.equal(resolveWallTime('2026-03-08', '03:30', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
  assert.throws(() => resolveWallTime('2026-03-08', '02:30', 'America/New_York'), { code: 'INVALID_SCHEDULE' });
  assert.throws(() => resolveWallTime('2026-11-01', '01:30', 'America/New_York'), { code: 'INVALID_SCHEDULE' });
  assert.throws(() => resolveWallTime('2026-04-05', '01:45', 'Australia/Lord_Howe'), { code: 'INVALID_SCHEDULE' });
  assert.throws(() => resolveWallTime('2026-10-04', '02:15', 'Australia/Lord_Howe'), { code: 'INVALID_SCHEDULE' });
  for (const args of [['2026-02-30', '12:00', 'UTC'], ['2026-01-01', '24:00', 'UTC'], ['2026-01-01', '12:00', 'bad-zone']])
    assert.throws(() => resolveWallTime(...args), { code: 'INVALID_SCHEDULE' });
  assert.equal(durationMinutes(), 120);
  for (const value of [0, 29, 721, 60.5, '120', null]) assert.throws(() => durationMinutes(value), { code: 'INVALID_SCHEDULE' });
});

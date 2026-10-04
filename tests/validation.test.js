const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const validation = import('../server/validation.mjs');
const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const openDraft = { from: ' A ', to: ' B ', tone: 'playful', message: '一起见一面吧', mode: 'open', timeZone: 'Asia/Shanghai' };
const proposal = (patch = {}) => ({
  date, time: '18:30', place: '咖啡店门口', activity: '',
  activities: ['喝杯咖啡', '吃点好吃的'],
  preferences: { hints: ['轻松随意就好'], details: { '喝杯咖啡': '安静的小店', '吃点好吃的': '' } },
  ...patch,
});
const invalid = error => error.status === 422 && typeof error.code === 'string';

test('open invitations leave the arrangement empty while legacy drafts remain valid', async () => {
  const { validateDraft } = await validation;
  assert.deepEqual(validateDraft(openDraft), { ...openDraft, from: 'A', to: 'B', options: [], activity: '', place: '' });
  for (const preset of [{ options: [{ date, time: '18:30' }] }, { options: null }, { activity: '喝杯咖啡' }, { place: '预定地点' }]) {
    assert.throws(() => validateDraft({ ...openDraft, ...preset }), invalid);
  }
  for (const mode of ['fixed', 'flexible']) {
    const options = [{ date, time: '18:30' }, { date, time: '20:00' }].slice(0, mode === 'fixed' ? 1 : 2);
    const draft = validateDraft({ ...openDraft, mode, options, activity: '喝杯咖啡', place: '' });
    assert.equal(draft.mode, mode);
    assert.equal(draft.options.length, options.length);
  }
});

test('proposal validation binds each detail to its selected activity and preserves date/place rules', async () => {
  const { validateProposal } = await validation;
  assert.doesNotThrow(() => validateProposal(proposal(), 'Asia/Shanghai'));
  assert.doesNotThrow(() => validateProposal(proposal({ preferences: { hints: [], details: {} } }), 'Asia/Shanghai'));
  for (const patch of [
    { activities: [] }, { activities: ['不存在的活动'] }, { activities: Array(7).fill('喝杯咖啡') },
    { activity: '散个步' }, { place: '   ' }, { place: '地'.repeat(61) },
    { date: '2099-02-30' }, { date: '2000-01-01' }, { time: '24:00' },
    { preferences: { hints: [], details: { '散个步': '公园慢慢走' } } },
    { preferences: { hints: [], details: { '喝杯咖啡': '火锅' } } },
    { preferences: { hints: [], details: { '喝杯咖啡': ['安静的小店'] } } },
    { preferences: { hints: [], detail: '西餐', details: {} } },
  ]) assert.throws(() => validateProposal(proposal(patch), 'Asia/Shanghai'), invalid);
  assert.throws(() => validateProposal(proposal(), 'Asia/Shanghai', {
    preferences: { details: { '散个步': '公园慢慢走' } },
  }), invalid, 'A normalizer cannot silently discard an invalid incoming detail');
  assert.doesNotThrow(() => validateProposal({ date, time: '18:30', place: '', activity: '喝杯咖啡', preferences: { hints: [], detail: '' } }, 'Asia/Shanghai'));
});

test('event input admits activity ranges and limits finalize to a host selection', async () => {
  const { validateEvent } = await validation;
  const event = { type: 'respond', version: 1, requestId: randomUUID(), proposal: proposal() };
  assert.equal(validateEvent(event, 'guest'), event);
  for (const patch of [
    { role: 'host' },
    { proposal: proposal({ activities: [] }) },
    { proposal: proposal({ preferences: { hints: [], details: { unknown: '' } } }) },
  ]) assert.throws(() => validateEvent({ ...event, ...patch }, 'guest'), invalid);
  const finalize = { type: 'finalize', version: 2, requestId: randomUUID(), proposal: { activity: '喝杯咖啡' } };
  assert.equal(validateEvent(finalize, 'host'), finalize);
  assert.throws(() => validateEvent(finalize, 'guest'), invalid);
  for (const patch of [{ activity: '' }, { activity: '喝杯咖啡', place: '偷偷换地点' }, { activity: '喝杯咖啡', activities: ['喝杯咖啡'] }]) {
    assert.throws(() => validateEvent({ ...finalize, proposal: patch }, 'host'), invalid);
  }
});

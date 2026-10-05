const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const validation = import('../server/validation.mjs');
const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const openDraft = { from: ' A ', to: ' B ', tone: 'playful', message: '一起见一面吧', mode: 'open', timeZone: 'Asia/Shanghai' };
const proposal = (patch = {}) => ({
  date, time: '18:30', place: '咖啡店门口', activity: '',
  activities: ['喝杯咖啡', '吃点好吃的'],
  preferences: { hints: ['轻松随意就好'], details: { '喝杯咖啡': ['安静的小店', '有阳光的窗边'], '吃点好吃的': [] } },
  ...patch,
});
const invalid = error => error.status === 422 && typeof error.code === 'string';
const plan = (patch = {}) => ({
  timeOptions: [{ date, time: '18:30' }, { date, time: '20:00' }],
  placeOptions: ['咖啡店门口', '公园南门'], activities: ['喝杯咖啡', '吃点好吃的'],
  preferences: { hints: [], details: { '喝杯咖啡': ['安静的小店', '有阳光的窗边'], '吃点好吃的': ['日料', '火锅'] } },
  ...patch,
});
const scopedProposal = (patch = {}) => ({
  ...plan(), date: '', time: '', place: '', activity: '',
  preferences: { ...plan().preferences, detail: '' }, ...patch,
});

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
    { preferences: { hints: [], detail: '西餐', details: {} } },
  ]) assert.throws(() => validateProposal(proposal(patch), 'Asia/Shanghai'), invalid);
  assert.throws(() => validateProposal(proposal(), 'Asia/Shanghai', {
    preferences: { details: { '散个步': '公园慢慢走' } },
  }), invalid, 'A normalizer cannot silently discard an invalid incoming detail');
  assert.doesNotThrow(() => validateProposal({ date, time: '18:30', place: '', activity: '喝杯咖啡', preferences: { hints: [], detail: '' } }, 'Asia/Shanghai'));
});

test('detail sets validate raw members before normalization and keep the selected display alias exact', async () => {
  const { validateEvent, validateProposal } = await validation;
  const canonical = proposal({ activity: '喝杯咖啡', preferences: {
    hints: [], details: { '喝杯咖啡': ['安静的小店', '有阳光的窗边'], '吃点好吃的': [] },
    detail: '安静的小店、有阳光的窗边',
  } });
  assert.doesNotThrow(() => validateProposal(canonical, 'Asia/Shanghai'));
  for (const selection of [[], ['安静的小店'], [' 安静的小店 ', '安静的小店'], Array(9).fill('安静的小店'), ' 安静的小店 ', '', '   ']) {
    const input = proposal({ preferences: { hints: [], details: { '喝杯咖啡': selection } } });
    assert.doesNotThrow(() => validateEvent({ type: 'respond', version: 1, requestId: randomUUID(), proposal: input }, 'guest'));
    assert.doesNotThrow(() => validateProposal(input, 'Asia/Shanghai'));
  }
  for (const selection of [null, undefined, {}, 1, '火锅', [''], ['   '], ['火锅'], [1], ['安静的小店', null], Array(10).fill('安静的小店')]) {
    const input = proposal({ preferences: { hints: [], details: { '喝杯咖啡': selection } } });
    assert.throws(() => validateEvent({ type: 'respond', version: 1, requestId: randomUUID(), proposal: input }, 'guest'), invalid);
    assert.throws(() => validateProposal(input, 'Asia/Shanghai'), invalid);
    assert.throws(() => validateProposal(canonical, 'Asia/Shanghai', input), invalid, 'Raw invalid members cannot be discarded by normalization');
  }
  for (const detail of ['安静的小店', '有阳光的窗边、安静的小店', '', ['安静的小店', '有阳光的窗边']]) {
    assert.throws(() => validateProposal({ ...canonical, preferences: { ...canonical.preferences, detail } }, 'Asia/Shanghai'), invalid);
  }
  assert.throws(() => validateEvent({ type: 'respond', version: 1, requestId: randomUUID(), proposal: canonical }, 'guest'), invalid, 'Only canonical snapshots may contain the display alias');
  assert.doesNotThrow(() => validateProposal(proposal({ activity: '喝杯咖啡', preferences: { hints: [], details: { '喝杯咖啡': '安静的小店' }, detail: '安静的小店' } }), 'Asia/Shanghai'));
  assert.throws(() => validateProposal({ date, time: '18:30', place: '', activity: '喝杯咖啡', preferences: { hints: [], detail: ['安静的小店'] } }, 'Asia/Shanghai'), invalid, 'Legacy proposals retain their scalar shape');
});

test('event input permits final choices for either role while excluding client-controlled authorization', async () => {
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
  assert.equal(validateEvent(finalize, 'guest'), finalize, 'The locked model transition owns role authorization for the actual invitation mode');
  for (const patch of [{ activity: [] }, { activity: '喝杯咖啡', scopeOwner: 'guest' }, { activity: '喝杯咖啡', activities: ['喝杯咖啡'] }]) {
    assert.throws(() => validateEvent({ ...finalize, proposal: patch }, 'host'), invalid);
  }
  const flatSelection = { ...finalize, proposal: { date, time: '18:30', place: '公园南门', activity: '吃点好吃的', detail: '日料' } };
  assert.equal(validateEvent(flatSelection, 'guest'), flatSelection);
  assert.doesNotThrow(() => validateEvent({ ...finalize, proposal: {} }, 'guest'), 'Only the model may fill unambiguous omitted choices');
  assert.throws(() => validateEvent({ ...flatSelection, scopeOwner: 'host' }, 'guest'), invalid);
  assert.throws(() => validateEvent({ ...flatSelection, proposal: { ...flatSelection.proposal, detail: ['日料'] } }, 'guest'), invalid);
});

test('host drafts accept a complete bounded scope while other modes cannot smuggle a plan', async () => {
  const { validateDraft } = await validation;
  const input = { ...openDraft, mode: 'host', plan: plan() };
  const actual = validateDraft(input);
  assert.equal(actual.mode, 'host');
  assert.deepEqual(actual.plan, plan());
  assert.throws(() => validateDraft({ ...openDraft, plan: plan() }), invalid);
  for (const patch of [
    { timeOptions: [] }, { timeOptions: Array(4).fill({ date, time: '18:30' }) },
    { timeOptions: [{ date: '2000-01-01', time: '18:30' }] },
    { timeOptions: [{ date: '2099-02-30', time: '18:30' }] },
    { timeOptions: [{ date, time: '18:30', scopeOwner: 'host' }] },
    { placeOptions: [] }, { placeOptions: ['  '] }, { placeOptions: ['地'.repeat(61)] },
    { placeOptions: ['A', 'B', 'C', 'D'] }, { activities: [] },
    { preferences: { hints: [], details: { '散个步': ['公园慢慢走'] } } },
    { activity: '喝杯咖啡' }, { date }, { scopeOwner: 'host' },
  ]) assert.throws(() => validateDraft({ ...input, plan: plan(patch) }), invalid);
});

test('full scopes preserve candidate pairs and validate a single final detail inside the chosen activity', async () => {
  const { validateEvent, validateProposal } = await validation;
  assert.doesNotThrow(() => validateEvent({ type: 'respond', version: 1, requestId: randomUUID(), proposal: plan() }, 'guest'));
  assert.doesNotThrow(() => validateProposal(scopedProposal(), 'Asia/Shanghai'));
  const selected = scopedProposal({ date, time: '20:00', place: '公园南门', activity: '吃点好吃的', preferences: { ...plan().preferences, detail: '日料' } });
  assert.doesNotThrow(() => validateProposal(selected, 'Asia/Shanghai'));
  for (const patch of [
    { date, time: '' }, { date, time: '19:00' }, { place: '没提供过的地方' },
    { activity: '散个步' }, { timeOptions: [] }, { placeOptions: [] },
    { preferences: { ...plan().preferences, detail: '日料、火锅' } },
    { preferences: { ...plan().preferences, detail: '安静的小店' } },
    { activity: '', preferences: { ...plan().preferences, detail: '日料' } },
  ]) assert.throws(() => validateProposal({ ...selected, ...patch }, 'Asia/Shanghai'), invalid);
  assert.throws(() => validateProposal(scopedProposal(), 'Asia/Shanghai', plan({ placeOptions: ['公园南门', ' '] })), invalid, 'Raw scope entries cannot be discarded during normalization');
  assert.doesNotThrow(() => validateEvent({ type: 'propose', version: 2, requestId: randomUUID(), proposal: { placeOptions: ['新地点'] } }, 'host'), 'A scope owner may patch one candidate dimension, with authority checked in the model');
});

test('new time ranges must be future but a retained expired alternative does not invalidate another selected slot', async () => {
  const { validateProposal } = await validation;
  const retained = scopedProposal({
    timeOptions: [{ date: '2000-01-01', time: '18:30' }, { date, time: '20:00' }],
    date, time: '20:00', place: '公园南门', activity: '吃点好吃的', preferences: { ...plan().preferences, detail: '日料' },
  });
  assert.doesNotThrow(() => validateProposal(retained, 'Asia/Shanghai', { date, time: '20:00', place: '公园南门', activity: '吃点好吃的', detail: '日料' }));
  assert.doesNotThrow(() => validateProposal(retained, 'Asia/Shanghai', {}), 'Confirm validates the selected schedule, not every historical alternative');
  assert.throws(() => validateProposal(retained, 'Asia/Shanghai', { timeOptions: retained.timeOptions }), invalid, 'A newly submitted candidate array cannot contain past slots');
  assert.throws(() => validateProposal({ ...retained, date: '2000-01-01', time: '18:30' }, 'Asia/Shanghai', {}), invalid, 'The chosen slot itself must still be future');
});

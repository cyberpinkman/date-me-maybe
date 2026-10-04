import { ApiError } from './errors.mjs';

const activities = new Set(['吃点好吃的', '喝杯咖啡', '散个步', '看场电影', '找个地方慢慢聊', '一起逛个展']);
const hints = new Set(['有点暧昧', '像第一次约会', '想多待一会儿', '有点小紧张', '轻松随意就好', '想认真打扮一下', '安静一点', '小惊喜你来定']);
const details = {
  '吃点好吃的': ['日料', '烤肉', '粤菜', '火锅', '烧烤', '西餐', '轻食', '甜品咖啡', '你来推荐'],
  '喝杯咖啡': ['安静的小店', '咖啡加甜品', '有阳光的窗边', '你来推荐'],
  '散个步': ['公园慢慢走', '沿着河边走', '逛逛街区', '你来选路线'],
  '看场电影': ['轻松喜剧', '爱情片', '悬疑片', '你来挑片'],
  '找个地方慢慢聊': ['安静坐坐', '边走边聊', '找家书店', '你来选'],
  '一起逛个展': ['摄影展', '艺术展', '博物馆', '你来挑一个'],
};
const fail = message => { throw new ApiError(422, 'INVALID_INPUT', message); };
export const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('这次没能保存，刷新页面后再试一次吧。');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('这次没能保存，刷新页面后再试一次吧。');
}
function text(value, name, max, optional = false) {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) fail(`请检查一下${name}，最多填写${max}个字。`);
  return value.trim();
}
function timezone(value = 'Asia/Shanghai') {
  if (typeof value !== 'string' || value.length > 80) fail('暂时没能确认见面时间，刷新页面后再试试。');
  try { new Intl.DateTimeFormat('en', { timeZone: value }); } catch { fail('暂时没能确认见面时间，刷新页面后再试试。'); }
  return value;
}
function activityRange(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > activities.size || value.some(activity => !activities.has(activity))) fail('选一到六种你愿意一起做的事吧。');
}
function detailValues(activity, value) {
  // Old ranged snapshots and clients used one string; only arrays require
  // every supplied member to be nonempty, before any deduplication.
  const values = typeof value === 'string' ? (value.trim() ? [value] : []) : value;
  if (!Array.isArray(values) || values.length > 9 || values.some(item => typeof item !== 'string' || !item.trim() || !details[activity].includes(item.trim()))) fail('再选一下这次见面的小安排吧。');
  return values.map(item => item.trim());
}
function preferencesInput(value, allowed = ['hints', 'detail', 'details'], activityNames = [...activities]) {
  fields(value, allowed);
  if ('details' in value) {
    fields(value.details, activityNames);
    for (const [activity, selection] of Object.entries(value.details)) detailValues(activity, selection);
  }
}
function slot(value, zone) {
  fields(value, ['date', 'time']);
  const { date, time } = value;
  if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('请填写完整的日期和时间。');
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('日期不存在。');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const now = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  if (`${date}T${time}` <= now) fail('请选择还没到来的见面时间。');
  return { date, time };
}
export function requestId(value) {
  if (!isUuid(value)) fail('这次没能保存，刷新页面后再试一次吧。');
  return value;
}
export function validateDraft(input) {
  fields(input, ['from', 'to', 'tone', 'message', 'mode', 'options', 'activity', 'place', 'timeZone']);
  const timeZone = timezone(input.timeZone);
  if (!['gentle', 'direct', 'playful'].includes(input.tone) || !['open', 'fixed', 'flexible'].includes(input.mode)) fail('再选一下开场语气和见面时间吧。');
  const invitation = { from: text(input.from, '昵称', 16), to: text(input.to, '对方昵称', 16), message: text(input.message, '邀请语', 120), tone: input.tone, mode: input.mode, timeZone };
  if (input.mode === 'open') {
    if (input.options !== undefined && (!Array.isArray(input.options) || input.options.length !== 0)) fail('这份邀请先留一点期待，具体安排等 TA 来选。');
    if (text(input.activity ?? '', '活动', 60, true) || text(input.place ?? '', '见面地点', 60, true)) fail('这份邀请先留一点期待，具体安排等 TA 来选。');
    return { ...invitation, options: [], activity: '', place: '' };
  }
  if (!activities.has(input.activity)) fail('选一种想一起做的事吧。');
  const count = input.mode === 'fixed' ? 1 : 2;
  if (!Array.isArray(input.options) || input.options.length !== count) fail('见面时间还没填完整，回去检查一下吧。');
  const options = input.options.map(option => slot(option, timeZone));
  if (count === 2 && JSON.stringify(options[0]) === JSON.stringify(options[1])) fail('请选择两个不同的候选时间。');
  return { ...invitation, activity: input.activity, place: text(input.place ?? '', '见面地点', 60, true), options };
}
export function validateEvent(input, role) {
  fields(input, ['type', 'version', 'proposal', 'requestId']);
  if (input.type === 'finalize' && role !== 'host') throw new ApiError(422, 'INVALID_ROLE', '只有发起人可以敲定活动。');
  const types = role === 'host' ? ['confirm', 'propose', 'finalize'] : ['respond', 'confirm', 'propose'];
  if (!types.includes(input.type)) fail('这次没能保存，刷新页面后再试一次吧。');
  if (!Number.isSafeInteger(input.version) || input.version < 1) fail('这次没能保存，刷新页面后再试一次吧。');
  requestId(input.requestId);
  if (input.type === 'finalize') {
    fields(input.proposal, ['activity']);
    if (typeof input.proposal.activity !== 'string' || !input.proposal.activity.trim()) fail('从 TA 愿意的活动里选一种吧。');
  } else if (input.type !== 'confirm') {
    fields(input.proposal, ['date', 'time', 'place', 'activity', 'activities', 'preferences']);
    if ('activities' in input.proposal) activityRange(input.proposal.activities);
    if ('preferences' in input.proposal) preferencesInput(input.proposal.preferences, 'activities' in input.proposal ? ['hints', 'details'] : undefined, input.proposal.activities);
  } else if (input.proposal !== undefined) fail('先保存想改的安排，再确认一下吧。');
  return input;
}
export function validateProposal(proposal, zone, input = proposal) {
  slot({ date: proposal.date, time: proposal.time }, zone);
  const hasRange = Object.hasOwn(proposal, 'activities');
  text(proposal.place, '见面地点', 60, !hasRange);
  if (hasRange) {
    activityRange(proposal.activities);
    if (proposal.activity !== '' && !proposal.activities.includes(proposal.activity)) throw new ApiError(422, 'INVALID_ACTIVITY_SELECTION', '从 TA 愿意的活动里选一种吧。');
  } else if (!activities.has(proposal.activity)) fail('选一种想一起做的事吧。');
  const prefs = proposal.preferences;
  preferencesInput(prefs, hasRange ? ['hints', 'details', 'detail'] : ['hints', 'detail'], proposal.activities);
  // Inspect the original payload too: canonicalization must not erase invalid
  // members, excess entries, or details outside the actual accepted range.
  if (input !== proposal && input.preferences !== undefined) preferencesInput(input.preferences, hasRange ? ['hints', 'details'] : ['hints', 'detail'], proposal.activities);
  if (!Array.isArray(prefs?.hints) || prefs.hints.length > 8 || prefs.hints.some(hint => !hints.has(hint))) fail('再选一下想要的氛围吧。');
  if (hasRange) {
    fields(prefs.details, proposal.activities);
    const alias = proposal.activity ? detailValues(proposal.activity, prefs.details[proposal.activity] ?? []).join('、') : '';
    if ('detail' in prefs && prefs.detail !== alias) fail('再选一下这次见面的小安排吧。');
  } else if (prefs.detail !== '' && !details[proposal.activity].includes(prefs.detail)) fail('再选一下这次见面的小安排吧。');
}

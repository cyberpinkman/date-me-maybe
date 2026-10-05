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
function validateHints(value) {
  if (!Array.isArray(value) || value.length > 8 || value.some(hint => !hints.has(hint))) fail('再选一下想要的氛围吧。');
}
const fullRange = value => Object.hasOwn(value, 'timeOptions') || Object.hasOwn(value, 'placeOptions');
function slot(value, zone, future = true) {
  fields(value, ['date', 'time']);
  const { date, time } = value;
  if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('请填写完整的日期和时间。');
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('日期不存在。');
  if (future) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]));
    const now = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    if (`${date}T${time}` <= now) fail('请选择还没到来的见面时间。');
  }
  return { date, time };
}
function scopeOptions(value, zone, future, partial = false) {
  const result = {};
  if (!partial || Object.hasOwn(value, 'timeOptions')) {
    if (!Array.isArray(value.timeOptions) || value.timeOptions.length < 1 || value.timeOptions.length > 3) fail('请提供一到三个完整的候选时间。');
    result.timeOptions = value.timeOptions.map(option => slot(option, zone, future));
  }
  if (!partial || Object.hasOwn(value, 'placeOptions')) {
    if (!Array.isArray(value.placeOptions) || value.placeOptions.length < 1 || value.placeOptions.length > 3) fail('请提供一到三个见面地点。');
    result.placeOptions = value.placeOptions.map(place => text(place, '见面地点', 60));
  }
  return result;
}
export function requestId(value) {
  if (!isUuid(value)) fail('这次没能保存，刷新页面后再试一次吧。');
  return value;
}
export function validateDraft(input) {
  fields(input, ['from', 'to', 'tone', 'message', 'mode', 'options', 'activity', 'place', 'timeZone', 'plan', 'durationMinutes', 'timePolicy']);
  const timeZone = timezone(input.timeZone);
  if (!['gentle', 'direct', 'playful'].includes(input.tone) || !['host', 'open', 'fixed', 'flexible'].includes(input.mode)) fail('再选一下开场语气和见面时间吧。');
  const durationMinutes = input.durationMinutes === undefined ? 120 : input.durationMinutes;
  const timePolicy = input.timePolicy === undefined ? 'free' : input.timePolicy;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720 || durationMinutes % 30) fail('相处时长请选择半小时到十二小时，以半小时为单位。');
  if (!['free', 'schedule'].includes(timePolicy) || (timePolicy === 'schedule' && input.mode !== 'open')) fail('交给对方选时间时，才可以使用我的时间表。');
  const invitation = { from: text(input.from, '昵称', 16), to: text(input.to, '对方昵称', 16), message: text(input.message, '邀请语', 120), tone: input.tone, mode: input.mode, timeZone, durationMinutes, timePolicy };
  if (input.mode !== 'host' && 'plan' in input) fail('请按邀请模式填写见面安排。');
  if (input.mode === 'host' || input.mode === 'open') {
    if (input.options !== undefined && (!Array.isArray(input.options) || input.options.length !== 0)) fail('这份邀请先留一点期待，具体安排等 TA 来选。');
    if (text(input.activity ?? '', '活动', 60, true) || text(input.place ?? '', '见面地点', 60, true)) fail('这份邀请先留一点期待，具体安排等 TA 来选。');
    if (input.mode === 'open') return { ...invitation, options: [], activity: '', place: '' };
    fields(input.plan, ['timeOptions', 'placeOptions', 'activities', 'preferences']);
    const options = scopeOptions(input.plan, timeZone, true);
    activityRange(input.plan.activities);
    preferencesInput(input.plan.preferences, ['hints', 'details'], input.plan.activities);
    validateHints(input.plan.preferences.hints);
    fields(input.plan.preferences.details, input.plan.activities);
    return { ...invitation, options: [], activity: '', place: '', plan: { ...input.plan, ...options } };
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
  const types = role === 'host' ? ['confirm', 'propose', 'finalize', 'cancel'] : ['respond', 'confirm', 'propose', 'finalize', 'cancel'];
  if (!types.includes(input.type)) fail('这次没能保存，刷新页面后再试一次吧。');
  if (!Number.isSafeInteger(input.version) || input.version < 1) fail('这次没能保存，刷新页面后再试一次吧。');
  requestId(input.requestId);
  if (input.type === 'finalize') {
    fields(input.proposal, ['date', 'time', 'place', 'activity', 'detail']);
    for (const [key, value] of Object.entries(input.proposal)) text(value, '最终安排', key === 'date' ? 10 : key === 'time' ? 5 : 60, true);
  } else if (!['confirm', 'cancel'].includes(input.type)) {
    fields(input.proposal, ['date', 'time', 'place', 'activity', 'activities', 'preferences', 'timeOptions', 'placeOptions']);
    if (fullRange(input.proposal)) {
      scopeOptions(input.proposal, undefined, false, input.type === 'propose');
      if (input.type === 'respond') activityRange(input.proposal.activities);
    }
    if ('activities' in input.proposal) activityRange(input.proposal.activities);
    if ('preferences' in input.proposal) preferencesInput(input.proposal.preferences, 'activities' in input.proposal ? ['hints', 'details'] : undefined, input.proposal.activities);
  } else if (input.proposal !== undefined) fail('先保存想改的安排，再确认一下吧。');
  return input;
}
export function validateProposal(proposal, zone, input = proposal) {
  const hasFullRange = fullRange(proposal);
  if (hasFullRange) {
    scopeOptions(proposal, zone, false);
    activityRange(proposal.activities);
    // Only newly offered time ranges must all be future. Historical consent
    // keeps expired alternatives; choosing a still-future slot remains valid.
    if (fullRange(input)) scopeOptions(input, zone, true, true);
    if (proposal.date || proposal.time) {
      slot({ date: proposal.date, time: proposal.time }, zone);
      if (!proposal.timeOptions.some(option => option.date === proposal.date && option.time === proposal.time)) fail('请从对方提供的候选时间中选择。');
    } else if (proposal.date !== '' || proposal.time !== '') fail('请填写完整的日期和时间。');
    if (proposal.place !== '' && !proposal.placeOptions.includes(proposal.place)) fail('请从对方提供的地点中选择。');
  } else slot({ date: proposal.date, time: proposal.time }, zone);
  const hasRange = Object.hasOwn(proposal, 'activities');
  text(proposal.place, '见面地点', 60, hasFullRange || !hasRange);
  if (hasRange) {
    activityRange(proposal.activities);
    if (proposal.activity !== '' && !proposal.activities.includes(proposal.activity)) throw new ApiError(422, 'INVALID_ACTIVITY_SELECTION', '从 TA 愿意的活动里选一种吧。');
  } else if (!activities.has(proposal.activity)) fail('选一种想一起做的事吧。');
  const prefs = proposal.preferences;
  preferencesInput(prefs, hasRange ? ['hints', 'details', 'detail'] : ['hints', 'detail'], proposal.activities);
  // Inspect the original payload too: canonicalization must not erase invalid
  // members, excess entries, or details outside the actual accepted range.
  if (input !== proposal && input.preferences !== undefined) preferencesInput(input.preferences, hasRange ? ['hints', 'details'] : ['hints', 'detail'], proposal.activities);
  validateHints(prefs.hints);
  if (hasRange) {
    fields(prefs.details, proposal.activities);
    const choices = proposal.activity ? detailValues(proposal.activity, prefs.details[proposal.activity] ?? []) : [];
    if (hasFullRange) {
      if (typeof prefs.detail !== 'string' || (prefs.detail !== '' && !choices.includes(prefs.detail))) fail('请从所选活动的具体偏好中选择一项。');
    } else if ('detail' in prefs && prefs.detail !== choices.join('、')) fail('再选一下这次见面的小安排吧。');
  } else if (prefs.detail !== '' && !details[proposal.activity].includes(prefs.detail)) fail('再选一下这次见面的小安排吧。');
}

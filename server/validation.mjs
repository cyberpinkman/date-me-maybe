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
  if (!['gentle', 'direct', 'playful'].includes(input.tone) || !['fixed', 'flexible'].includes(input.mode)) fail('再选一下开场语气和见面时间吧。');
  if (!activities.has(input.activity)) fail('选一种想一起做的事吧。');
  const count = input.mode === 'fixed' ? 1 : 2;
  if (!Array.isArray(input.options) || input.options.length !== count) fail('见面时间还没填完整，回去检查一下吧。');
  const options = input.options.map(option => slot(option, timeZone));
  if (count === 2 && JSON.stringify(options[0]) === JSON.stringify(options[1])) fail('请选择两个不同的候选时间。');
  return { from: text(input.from, '昵称', 16), to: text(input.to, '对方昵称', 16), message: text(input.message, '邀请语', 120), tone: input.tone, mode: input.mode, activity: input.activity, place: text(input.place ?? '', '见面地点', 60, true), options, timeZone };
}
export function validateEvent(input, role) {
  fields(input, ['type', 'version', 'proposal', 'requestId']);
  const types = role === 'host' ? ['confirm', 'propose'] : ['respond', 'confirm', 'propose'];
  if (!types.includes(input.type)) fail('这次没能保存，刷新页面后再试一次吧。');
  if (!Number.isSafeInteger(input.version) || input.version < 1) fail('这次没能保存，刷新页面后再试一次吧。');
  requestId(input.requestId);
  if (input.type !== 'confirm') {
    fields(input.proposal, ['date', 'time', 'place', 'activity', 'preferences']);
    if ('preferences' in input.proposal) fields(input.proposal.preferences, ['hints', 'detail']);
  } else if (input.proposal !== undefined) fail('先保存想改的安排，再确认一下吧。');
  return input;
}
export function validateProposal(proposal, zone) {
  slot({ date: proposal.date, time: proposal.time }, zone);
  text(proposal.place, '见面地点', 60, true);
  if (!activities.has(proposal.activity)) fail('选一种想一起做的事吧。');
  const prefs = proposal.preferences;
  if (!Array.isArray(prefs?.hints) || prefs.hints.length > 8 || prefs.hints.some(hint => !hints.has(hint))) fail('再选一下想要的氛围吧。');
  if (prefs.detail !== '' && !details[proposal.activity].includes(prefs.detail)) fail('再选一下这次见面的小安排吧。');
}

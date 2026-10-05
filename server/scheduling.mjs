import { createHash, randomUUID } from 'node:crypto';
import Model from '../src/model.js';
import { ApiError } from './errors.mjs';
import { fields, isUuid } from './validation.mjs';

const minute = 60_000, day = 86_400_000;
const bad = message => { throw new ApiError(422, 'INVALID_SCHEDULE', message); };
const unavailable = () => new ApiError(409, 'TIME_UNAVAILABLE', '这个时间已经不方便了，再挑一个时间吧。');
const formats = new Map(), offsetCache = new Map();
const emptyWeek = () => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), []]));
function zone(value) {
  if (typeof value !== 'string' || value.length > 80) bad('请选择有效的时区。');
  try { new Intl.DateTimeFormat('en', { timeZone: value }); } catch { bad('请选择有效的时区。'); }
  return value;
}
function wallParts(instant, timeZone) {
  if (!formats.has(timeZone)) formats.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }));
  const p = Object.fromEntries(formats.get(timeZone).formatToParts(new Date(instant)).map(item => [item.type, item.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
function dateValue(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(value)) bad('请填写完整的日期。');
  const instant = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) bad('日期不存在。');
  return instant;
}
function clockValue(value, end = false) {
  if (end && value === '24:00') return 1440;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) bad('请填写完整的时间。');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
const datePlus = (value, days) => new Date(dateValue(value) + days * day).toISOString().slice(0, 10);
const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

// An invite uses wall-clock input, but reservations use real instants. Reject
// gaps AND repeated times instead of silently choosing one side of a DST jump.
export function resolveWallTime(date, time, timeZone = 'Asia/Shanghai') {
  const base = dateValue(date) + clockValue(time) * minute;
  zone(timeZone);
  const key = `${timeZone}:${date}`;
  if (!offsetCache.has(key)) {
    const offsets = new Set();
    for (let hours = -48; hours <= 48; hours += 6) {
      const instant = base + hours * 60 * minute, wall = wallParts(instant, timeZone);
      offsets.add(Date.parse(`${wall.date}T${wall.time}:00Z`) - instant);
    }
    if (offsetCache.size > 500) offsetCache.clear();
    offsetCache.set(key, [...offsets]);
  }
  const candidates = offsetCache.get(key).map(offset => base - offset).filter(instant => {
    const wall = wallParts(instant, timeZone);
    return wall.date === date && wall.time === time;
  });
  if (candidates.length !== 1) bad('这个时间遇到了时区调整，请换一个明确的时间。');
  return new Date(candidates[0]);
}
export function durationMinutes(value = 120) {
  if (!Number.isSafeInteger(value) || value < 30 || value > 720) bad('相处时长请选择 30 分钟到 12 小时。');
  return value;
}
function interval(slot, state) {
  const start = resolveWallTime(slot.date, slot.time, state.timeZone || 'Asia/Shanghai');
  return { start, end: new Date(start.getTime() + durationMinutes(state.durationMinutes) * minute) };
}
function normalizeWindows(input) {
  if (!Array.isArray(input) || input.length > 8) bad('每天最多设置八段空闲时间。');
  const windows = input.map(item => {
    fields(item, ['start', 'end']);
    if (clockValue(item.start) >= clockValue(item.end, true)) bad('结束时间要晚于开始时间，跨天请分开设置。');
    return { start: item.start, end: item.end };
  }).sort((a, b) => a.start.localeCompare(b.start));
  if (windows.some((item, i) => i && clockValue(item.start) < clockValue(windows[i - 1].end, true))) bad('同一天的空闲时间不能重叠。');
  return mergeWindows(windows);
}
function mergeWindows(windows) {
  const merged = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous?.end === window.start) previous.end = window.end;
    else merged.push({ ...window });
  }
  return merged;
}
function normalizeSchedule(input, now) {
  fields(input, ['timeZone', 'weekly', 'overrides']);
  const timeZone = zone(input.timeZone), today = wallParts(now, timeZone).date;
  fields(input.weekly, ['0', '1', '2', '3', '4', '5', '6']);
  fields(input.overrides, Object.keys(input.overrides ?? {}));
  if (Object.keys(input.overrides).length > 31) bad('可以单独调整未来 30 天的时间。');
  const overrides = {};
  for (const [date, windows] of Object.entries(input.overrides)) {
    dateValue(date);
    // Stale overrides are harmless and disappear on the next save; a schedule
    // opened yesterday remains editable without manual removal of old dates.
    if (date < today) continue;
    if (date >= datePlus(today, 30)) bad('可以单独调整未来 30 天的时间。');
    overrides[date] = normalizeWindows(windows);
  }
  return { timeZone, weekly: Object.fromEntries(Object.keys(emptyWeek()).map(key => [key, normalizeWindows(input.weekly[key] ?? [])])), overrides };
}
function mappedError(error) {
  if (error.code === '23P01') return unavailable();
  return error;
}
async function lockAccounts(client, userIds) {
  for (const id of [...new Set(userIds)].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`calendar:${id}`]);
}
function storedSchedule(row) {
  return row ? { configured: true, timeZone: row.time_zone, weekly: row.weekly, overrides: row.overrides }
    : { configured: false, timeZone: 'Asia/Shanghai', weekly: emptyWeek(), overrides: {} };
}
function windowsFor(schedule, date) {
  const weekday = new Date(dateValue(date)).getUTCDay();
  return mergeWindows(schedule.overrides[date] ?? schedule.weekly[String(weekday)] ?? []);
}
function insideSchedule(schedule, start, end, now) {
  if (!schedule.configured || start.getTime() <= now.getTime()) return false;
  const local = wallParts(start, schedule.timeZone), today = wallParts(now, schedule.timeZone).date;
  if (local.date < today || local.date >= datePlus(today, 30)) return false;
  return windowsFor(schedule, local.date).some(window => {
    try {
      const first = resolveWallTime(local.date, window.start, schedule.timeZone);
      const last = window.end === '24:00' ? resolveWallTime(datePlus(local.date, 1), '00:00', schedule.timeZone)
        : resolveWallTime(local.date, window.end, schedule.timeZone);
      return start >= first && end <= last;
    } catch (error) { if (error instanceof ApiError) return false; throw error; }
  });
}
const bookingResult = row => row ? { start: new Date(row.starts_at).toISOString(), end: new Date(row.ends_at).toISOString() } : null;

export function createSchedulingService({ pool, now = () => new Date() }) {
  async function transaction(run) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw mappedError(error); }
    finally { client.release(); }
  }
  async function readSchedule(client, userId) {
    return storedSchedule((await client.query('SELECT * FROM user_schedules WHERE user_id=$1', [userId])).rows[0]);
  }
  async function participants(client, row) {
    const binding = (await client.query('SELECT user_id FROM invitation_guest_accounts WHERE invitation_id=$1', [row.id])).rows[0];
    return [...new Set([row.owner_id, binding?.user_id].filter(Boolean))];
  }
  async function checkFree(client, userIds, range, invitationId) {
    const issues = await client.query('SELECT 1 FROM calendar_migration_issues WHERE user_id=ANY($1::text[]) AND invitation_id IS DISTINCT FROM $2::uuid LIMIT 1', [userIds, invitationId ?? null]);
    if (issues.rowCount) throw new ApiError(409, 'CALENDAR_NEEDS_REVIEW', '日程里还有一份旧邀约需要确认时间，请先到我的日程处理。');
    const conflict = await client.query(`SELECT 1 FROM calendar_reservations WHERE user_id=ANY($1::text[])
      AND ($2::uuid IS NULL OR invitation_id IS DISTINCT FROM $2::uuid) AND starts_at<$4 AND ends_at>$3 LIMIT 1`, [userIds, invitationId ?? null, range.start, range.end]);
    if (conflict.rowCount) throw unavailable();
  }
  async function validateRange(client, row, state, slot, users) {
    const range = interval(slot, state);
    if (range.start <= now()) throw unavailable();
    if (state.timePolicy === 'schedule') {
      const existing = await client.query('SELECT 1 FROM calendar_reservations WHERE invitation_id=$1 AND user_id=$2 AND starts_at=$3 AND ends_at=$4', [row.id, row.owner_id, range.start, range.end]);
      if (!existing.rowCount && !insideSchedule(await readSchedule(client, row.owner_id), range.start, range.end, now())) throw unavailable();
    }
    await checkFree(client, users, range, row.id);
    return range;
  }
  async function assertProposal(client, row, next, event = {}) {
    if (next.closed) return;
    const users = await participants(client, row);
    await lockAccounts(client, users);
    if (next.timePolicy === 'schedule' && !(await readSchedule(client, row.owner_id)).configured)
      throw new ApiError(422, 'SCHEDULE_REQUIRED', '先设置一下你的空闲时间，再发出邀请吧。');
    if (!next.proposal) return;
    let slots = [];
    if (Model.status(next) === 'confirmed') slots = [next.proposal];
    else if (event.type === 'respond' || event.proposal?.timeOptions || event.type === 'create') slots = next.proposal.timeOptions ?? [next.proposal];
    else if (event.proposal?.date || event.proposal?.time || event.type === 'confirm') slots = next.proposal.date && next.proposal.time ? [next.proposal] : [];
    for (const slot of slots) if (slot.date && slot.time) await validateRange(client, row, next, slot, users);
  }
  async function syncConfirmed(client, row, next) {
    const users = await participants(client, row);
    await lockAccounts(client, users);
    if (next.closed) {
      await client.query('DELETE FROM calendar_reservations WHERE invitation_id=$1', [row.id]);
      await client.query('DELETE FROM calendar_migration_issues WHERE invitation_id=$1', [row.id]);
      return;
    }
    if (Model.status(next) !== 'confirmed') return;
    const range = await validateRange(client, row, next, next.proposal, users);
    // A pending revision keeps its old reservation. Only a newly confirmed
    // plan atomically replaces all participants' intervals in this transaction.
    await client.query('DELETE FROM calendar_reservations WHERE invitation_id=$1', [row.id]);
    await client.query('DELETE FROM calendar_migration_issues WHERE invitation_id=$1', [row.id]);
    try {
      for (const userId of users) await client.query(`INSERT INTO calendar_reservations(id,user_id,invitation_id,kind,starts_at,ends_at)
        VALUES($1,$2,$3,'booking',$4,$5)`, [randomUUID(), userId, row.id, range.start, range.end]);
    } catch (error) { throw mappedError(error); }
  }
  async function getBinding(client, row) {
    const binding = (await client.query('SELECT user_id FROM invitation_guest_accounts WHERE invitation_id=$1', [row.id])).rows[0];
    const reservation = (await client.query('SELECT * FROM calendar_reservations WHERE invitation_id=$1 AND user_id=$2', [row.id, row.owner_id])).rows[0];
    return { calendarBound: Boolean(binding),
      booking: reservation ? { ...bookingResult(reservation), ...wallParts(new Date(reservation.starts_at), row.state.timeZone || 'Asia/Shanghai') } : null };
  }
  async function bindGuest(client, row, userId) {
    if (userId === row.owner_id) throw new ApiError(422, 'SELF_BINDING', '这是你发出的邀请，已经在你的日程里了。');
    if (!row.state.responded || row.state.closed) throw new ApiError(409, 'BINDING_NOT_READY', '先完成这份邀请的回应，再加入你的日程吧。');
    const existing = (await client.query('SELECT user_id FROM invitation_guest_accounts WHERE invitation_id=$1', [row.id])).rows[0];
    if (existing && existing.user_id !== userId) throw new ApiError(409, 'ALREADY_BOUND', '这份邀请已经加入了受邀人的日程。');
    await lockAccounts(client, [row.owner_id, userId]);
    const saved = (await client.query('SELECT * FROM calendar_reservations WHERE invitation_id=$1 AND user_id=$2', [row.id, row.owner_id])).rows[0];
    if (!saved && (await client.query('SELECT 1 FROM calendar_migration_issues WHERE invitation_id=$1', [row.id])).rowCount)
      throw new ApiError(409, 'CALENDAR_NEEDS_REVIEW', '这份旧邀约需要先由发起人确认时间，再加入你的日程。');
    if (saved) await checkFree(client, [userId], { start: saved.starts_at, end: saved.ends_at }, row.id);
    if (!existing) {
      await client.query('INSERT INTO invitation_guest_accounts(invitation_id,user_id) VALUES($1,$2)', [row.id, userId]);
      if (saved) {
        try { await client.query(`INSERT INTO calendar_reservations(id,user_id,invitation_id,kind,starts_at,ends_at) VALUES($1,$2,$3,'booking',$4,$5)`, [randomUUID(), userId, row.id, saved.starts_at, saved.ends_at]); }
        catch (error) { throw mappedError(error); }
      }
    }
    return getBinding(client, row);
  }
  async function availability(row) {
    const state = row.state, timeZone = state.timeZone || 'Asia/Shanghai', duration = durationMinutes(state.durationMinutes);
    const users = await participants(pool, row), schedule = await readSchedule(pool, row.owner_id);
    const [occupied, issues, existing] = await Promise.all([
      pool.query('SELECT starts_at,ends_at FROM calendar_reservations WHERE user_id=ANY($1::text[]) AND invitation_id IS DISTINCT FROM $2::uuid', [users, row.id]),
      pool.query('SELECT 1 FROM calendar_migration_issues WHERE user_id=ANY($1::text[]) AND invitation_id IS DISTINCT FROM $2::uuid LIMIT 1', [users, row.id]),
      pool.query('SELECT starts_at,ends_at FROM calendar_reservations WHERE invitation_id=$1 AND user_id=$2', [row.id, row.owner_id]),
    ]);
    const available = slot => {
      try {
        const { start, end } = interval(slot, state);
        const retained = existing.rows.some(saved => +new Date(saved.starts_at) === +start && +new Date(saved.ends_at) === +end);
        return !state.closed && !issues.rowCount && start > now() && (state.timePolicy !== 'schedule' || retained || insideSchedule(schedule, start, end, now()))
          && !occupied.rows.some(busy => start < new Date(busy.ends_at) && end > new Date(busy.starts_at));
      } catch (error) { if (error instanceof ApiError) return false; throw error; }
    };
    const candidates = state.proposal?.timeOptions ?? (state.proposal?.date && state.proposal?.time ? [state.proposal] : state.options ?? []);
    const candidateSlots = candidates.map(({ date, time }) => ({ date, time, available: available({ date, time }) }));
    const slots = [];
    if (state.timePolicy === 'schedule' && schedule.configured && !issues.rowCount && !state.closed) {
      const today = wallParts(now(), timeZone).date;
      for (let n = 0; n <= 30; n++) {
        const date = datePlus(today, n);
        for (let m = 0; m < 1440; m += 30) {
          const slot = { date, time: clock(m) };
          if (available(slot)) slots.push(slot);
        }
      }
    }
    return { slots, candidateSlots, timeZone, durationMinutes: duration };
  }
  async function listCalendar(userId) {
    const [reservations, issues] = await Promise.all([
      pool.query(`SELECT r.*,i.owner_id,i.state,EXISTS(SELECT 1 FROM calendar_reservations other
        WHERE other.user_id=r.user_id AND other.id<>r.id AND other.starts_at<r.ends_at AND other.ends_at>r.starts_at) AS overlaps
        FROM calendar_reservations r LEFT JOIN invitations i ON i.id=r.invitation_id
        WHERE r.user_id=$1 AND r.ends_at>$2 ORDER BY r.starts_at`, [userId, now()]),
      pool.query('SELECT invitation_id,reason FROM calendar_migration_issues WHERE user_id=$1', [userId]),
    ]);
    const busy = [], bookings = [], conflicts = issues.rows.map(item => ({ invitationId: item.invitation_id, message: item.reason }));
    for (const row of reservations.rows) {
      const range = bookingResult(row);
      if (row.kind === 'busy') busy.push({ id: row.id, ...range, label: row.label });
      else {
        bookings.push({ invitationId: row.invitation_id, ...range, role: row.owner_id === userId ? 'host' : 'guest', from: row.state.from, to: row.state.to, status: Model.status(row.state), legacyConflict: row.overlaps });
        if (row.overlaps) conflicts.push({ invitationId: row.invitation_id, message: '这份旧邀约与另一项安排重叠，请改期或取消其中一项。' });
      }
    }
    return { busy, bookings, conflicts };
  }
  return {
    getSchedule: userId => readSchedule(pool, userId), listCalendar, availability, assertProposal, syncConfirmed, bindGuest, getBinding,
    async saveSchedule(userId, input) {
      const schedule = normalizeSchedule(input, now());
      return transaction(async client => {
        await lockAccounts(client, [userId]);
        await client.query(`INSERT INTO user_schedules(user_id,time_zone,weekly,overrides) VALUES($1,$2,$3,$4)
          ON CONFLICT(user_id) DO UPDATE SET time_zone=EXCLUDED.time_zone,weekly=EXCLUDED.weekly,overrides=EXCLUDED.overrides,updated_at=now()`, [userId, schedule.timeZone, schedule.weekly, schedule.overrides]);
        return { ...schedule, configured: true };
      });
    },
    async addBusy(userId, input) {
      fields(input, ['date', 'time', 'durationMinutes', 'allDay', 'label', 'requestId']);
      if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 60)) bad('日程备注最多填写 60 个字。');
      if (input.requestId !== undefined && !isUuid(input.requestId)) bad('这次没能保存，刷新页面后再试一次吧。');
      if (input.allDay !== undefined && typeof input.allDay !== 'boolean') bad('请重新选择忙碌时间。');
      if (input.allDay && ('time' in input || 'durationMinutes' in input)) bad('全天安排只需选择日期。');
      dateValue(input.date);
      if (!input.allDay) clockValue(input.time);
      const busyMinutes = input.durationMinutes === undefined ? 120 : input.durationMinutes;
      if (!Number.isSafeInteger(busyMinutes) || busyMinutes < 1 || busyMinutes > 1440) bad('忙碌时间请选择 1 分钟到 24 小时。');
      const canonical = input.allDay ? { date: input.date, allDay: true, label: (input.label ?? '').trim() }
        : { date: input.date, time: input.time, durationMinutes: busyMinutes, label: (input.label ?? '').trim() };
      const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
      return transaction(async client => {
        await lockAccounts(client, [userId]);
        if (input.requestId) {
          const prior = (await client.query('SELECT request_hash,response FROM calendar_busy_requests WHERE user_id=$1 AND request_id=$2', [userId, input.requestId])).rows[0];
          if (prior) {
            if (prior.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '这项安排已经有变化，刷新页面后再试一次吧。');
            return prior.response;
          }
        }
        const schedule = await readSchedule(client, userId);
        const start = resolveWallTime(input.date, input.allDay ? '00:00' : input.time, schedule.timeZone);
        const range = { start, end: input.allDay ? resolveWallTime(datePlus(input.date, 1), '00:00', schedule.timeZone)
          : new Date(start.getTime() + busyMinutes * minute) };
        const today = wallParts(now(), schedule.timeZone).date;
        if (input.date < today || range.end <= now()) bad('请选择还没结束的忙碌时间。');
        if (input.date >= datePlus(today, 30)) bad('请设置未来 30 天内的忙碌时间。');
        await checkFree(client, [userId], range);
        const id = randomUUID(), label = canonical.label;
        await client.query("INSERT INTO calendar_reservations(id,user_id,kind,starts_at,ends_at,label) VALUES($1,$2,'busy',$3,$4,$5)", [id, userId, range.start, range.end, label]);
        const result = { id, start: range.start.toISOString(), end: range.end.toISOString(), label };
        if (input.requestId) await client.query('INSERT INTO calendar_busy_requests(user_id,request_id,request_hash,response) VALUES($1,$2,$3,$4)', [userId, input.requestId, hash, result]);
        return result;
      });
    },
    async removeBusy(userId, id) {
      if (!isUuid(id)) throw new ApiError(404, 'BUSY_NOT_FOUND', '暂时找不到这项安排。');
      return transaction(async client => {
        await lockAccounts(client, [userId]);
        const deleted = await client.query("DELETE FROM calendar_reservations WHERE id=$1 AND user_id=$2 AND kind='busy'", [id, userId]);
        if (!deleted.rowCount) throw new ApiError(404, 'BUSY_NOT_FOUND', '暂时找不到这项安排。');
      });
    },
  };
}

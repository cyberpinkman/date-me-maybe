/* Personal availability and explicit recipient account linking. */
let calendarData = null, calendarDraft = null, calendarDirty = false, calendarReturn = false;
let availabilityData = null, availabilityInvitationId = null, availabilityDate = "";
const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const calendarZone = () => calendarDraft?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
const draftTimeZone = () => draft.mode === "open" && draft.timePolicy === "schedule" ? calendarData?.schedule?.timeZone || "Asia/Shanghai" : Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
const durationLabel = (minutes = 120) => minutes % 60 ? `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} 小时 ` : ""}${minutes % 60} 分钟` : `${minutes / 60} 小时`;
const minutesOf = (time) => { const [hour, minute] = String(time).split(":").map(Number); return hour * 60 + minute; };
function zonedDay(zone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
}
function addCalendarDays(date, amount) { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + amount); return next.toISOString().slice(0, 10); }
function futureSlot(slot, zone = current()?.timeZone || calendarZone()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot?.date || "") || !/^\d{2}:\d{2}$/.test(slot?.time || "")) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone || "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const nowTime = ["hour", "minute"].map(type => parts.find(part => part.type === type).value).join(":");
  return `${slot.date}T${slot.time}` > `${zonedDay(zone || "Asia/Shanghai")}T${nowTime}`;
}
function emptyCalendar() { return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai", weekly: Object.fromEntries(dayNames.map((_, index) => [index, []])), overrides: {} }; }
function clearCalendarIdentity() { calendarData = calendarDraft = availabilityData = null; calendarDirty = calendarReturn = false; availabilityInvitationId = null; availabilityDate = ""; }
async function loadCalendar(preserveDraft = false) {
  calendarData = await InviteAPI.get("/api/schedule");
  if (!preserveDraft || !calendarDraft) { calendarDraft = JSON.parse(JSON.stringify(calendarData.schedule || emptyCalendar())); calendarDraft.weekly ||= emptyCalendar().weekly; calendarDraft.overrides ||= {}; calendarDirty = false; }
  return calendarData;
}
async function loadAvailability(x = current()) {
  if (!x) return;
  const data = await InviteAPI.get((guestToken ? `/api/guest/${encodeURIComponent(guestToken)}` : `/api/invitations/${encodeURIComponent(x.id)}`) + "/availability");
  availabilityData = data; availabilityInvitationId = x.id;
  if (!availabilityDate || !data.slots?.some(slot => slot.date === availabilityDate)) availabilityDate = data.slots?.[0]?.date || zonedDay(data.timeZone || x.timeZone || "Asia/Shanghai");
  return data;
}
function currentAvailability(x = current()) { return availabilityInvitationId === x?.id ? availabilityData : null; }
function slotAvailable(slot, x = current()) {
  if (!slot?.date || !slot?.time) return false;
  const data = currentAvailability(x); if (!data) return x?.timePolicy !== "schedule";
  const candidate = data.candidateSlots?.find(item => item.date === slot.date && item.time === slot.time);
  if (candidate) return candidate.available !== false;
  return x?.timePolicy !== "schedule" || !!data.slots?.some(item => item.date === slot.date && item.time === slot.time);
}
function durationField(prefix, value) {
  return `<div class="field"><label class="label" for="${prefix}-duration">预计相处多久</label><select id="${prefix}-duration">${Array.from({ length: 24 }, (_, i) => (i + 1) * 30).map(minutes => `<option value="${minutes}" ${minutes === Number(value || 120) ? "selected" : ""}>${durationLabel(minutes)}</option>`).join("")}</select><p class="hint">确认后，会为这次见面留出完整的时间。</p></div>`;
}
function timingStep() {
  return `<h2>把见面的时间，留给期待。</h2><p class="sub">小安排想听 TA 的，时间也可以轻松一点。</p><div class="field"><div class="label">让 TA 怎么选时间？</div><div class="invitation-modes">${[["free", "时间你来定", "让 TA 留下方便的时间"], ["schedule", "使用我的时间表", "从我有空的时间里挑"]].map(([value, title, note]) => `<button class="mode-choice ${draft.timePolicy === value ? "selected" : ""}" data-action="time-policy" data-policy="${value}" aria-pressed="${draft.timePolicy === value}"><b>${title}</b><small>${note}</small></button>`).join("")}</div></div>${draft.timePolicy === "schedule" ? `<div class="note-box">${calendarData?.schedule?.configured ? "会开放未来 30 天的空闲时间，已约好的时间会自动避开。" : "先把通常有空的时间告诉我们，TA 就能从中挑选啦。"}<button class="text-btn" data-action="schedule-from-draft">${calendarData?.schedule?.configured ? "查看我的时间表" : "设置我的时间表"} ${icon("arrow", 14)}</button></div>` : '<p class="hint">已经约好的时间，会替你避开。</p>'}${durationField("draft", draft.durationMinutes)}<div id="form-error" class="error" role="alert"></div><div class="actions"><button class="text-btn" data-action="prev">回去改改</button><button class="btn primary" data-action="next">看看这份邀请 ${icon("arrow")}</button></div>`;
}
function calendarIntervals(intervals, kind, key) {
  return `<div class="calendar-intervals">${intervals.length ? intervals.map((interval, index) => `<div class="calendar-interval"><input type="time" step="1800" aria-label="${kind === "weekly" ? dayNames[key] : key} 开始时间" data-calendar-kind="${kind}" data-key="${key}" data-index="${index}" data-edge="start" value="${esc(interval.start)}"><span>至</span><input type="time" step="1800" aria-label="${kind === "weekly" ? dayNames[key] : key} 结束时间" data-calendar-kind="${kind}" data-key="${key}" data-index="${index}" data-edge="end" value="${esc(interval.end)}"><button class="text-btn" data-action="calendar-remove-interval" data-kind="${kind}" data-key="${key}" data-index="${index}" aria-label="移除此段时间">×</button></div>`).join("") : '<span class="calendar-day-off">这天没空</span>'}<button class="text-btn calendar-add-time" data-action="calendar-add-interval" data-kind="${kind}" data-key="${key}">＋ 添加时段</button></div>`;
}
function calendarEntryTime(entry) {
  if (!entry.start || !entry.end) return "";
  const format = new Intl.DateTimeFormat("zh-CN", { timeZone: calendarZone(), month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const endFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: calendarZone(), ...(zonedDay(calendarZone(), new Date(entry.start)) !== zonedDay(calendarZone(), new Date(entry.end)) ? { month:"numeric", day:"numeric" } : {}), hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${format.format(new Date(entry.start))} — ${endFormat.format(new Date(entry.end))}`;
}
function calendarView() {
  const schedule = calendarDraft || emptyCalendar(), today = zonedDay(schedule.timeZone), last = addCalendarDays(today, 29);
  const busy = calendarData?.busy || [], bookings = calendarData?.bookings || [], conflicts = calendarData?.conflicts || [];
  return `<section class="calendar-wrap"><div class="list-head"><div><p class="eyebrow">MAKE TIME FOR SOMEONE</p><h1>我的日程</h1><p class="sub">留一点空闲，给想见的人。</p></div><button class="text-btn" data-action="calendar-refresh">刷新日程</button></div>${calendarReturn ? '<button class="text-btn calendar-back" data-action="calendar-return">← 回到正在写的邀请</button>' : ""}${conflicts.length ? `<div class="calendar-warning" role="status">有几份之前的约定需要重新核对一下时间。${conflicts.map((entry,index)=>`<button class="text-btn" data-action="open" data-id="${esc(entry.invitationId)}">查看需要调整的约定 ${index+1} →</button>`).join("")}</div>` : ""}<div class="calendar-layout"><div class="calendar-editor"><section class="calendar-panel"><h2>通常什么时候有空？</h2><p class="hint">按周设置，自动开放未来 30 天。某天有变化，可以在下面单独调整。</p><div class="field"><label class="label" for="calendar-timezone">日程时区</label><select id="calendar-timezone">${[...new Set([schedule.timeZone, "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles", "Australia/Sydney"])].map(zone => `<option value="${esc(zone)}" ${zone === schedule.timeZone ? "selected" : ""}>${esc(zone)}</option>`).join("")}</select></div><div class="calendar-week">${[1, 2, 3, 4, 5, 6, 0].map(day => `<div class="calendar-day"><strong>${dayNames[day]}</strong>${calendarIntervals(schedule.weekly[day] || [], "weekly", day)}</div>`).join("")}</div></section><section class="calendar-panel"><h2>某一天，特别安排</h2><p class="hint">这里的安排会替换当天的每周设置；不添加时段，就表示全天没空。</p><div class="calendar-date-add"><input id="calendar-override-date" type="date" min="${today}" max="${last}" value="${today}" aria-label="单独调整的日期"><button class="btn" data-action="calendar-add-date">调整这天</button></div>${Object.keys(schedule.overrides).sort().filter(date => date >= today).map(date => `<div class="calendar-override"><div class="calendar-override-heading"><strong>${fmt(date)}</strong><button class="text-btn" data-action="calendar-remove-date" data-date="${date}">恢复每周设置</button></div>${calendarIntervals(schedule.overrides[date], "overrides", date)}</div>`).join("")}</section><div class="calendar-save"><p id="calendar-save-status" class="hint" role="status">${calendarDirty ? "有新的调整还没保存。" : "已确认的约会，会一直替你留着。"}</p><button class="btn primary" data-action="calendar-save">保存时间表 ${icon("check")}</button></div></div><aside class="calendar-agenda"><section class="calendar-panel"><h2>留给自己的时间</h2><p class="hint">工作、出行或其他安排，也可以先记下来。</p><div class="field"><label class="label" for="busy-label">这段时间留给</label><input id="busy-label" maxlength="60" placeholder="例如：朋友聚会（仅自己可见）"></div><div class="field"><label class="label" for="busy-date">日期</label><input id="busy-date" type="date" min="${today}" max="${last}" value="${today}"></div><label class="calendar-all-day" for="busy-all-day"><input id="busy-all-day" type="checkbox"> 全天</label><div class="columns"><div class="field"><label class="label" for="busy-start">从</label><input id="busy-start" type="time" step="1800" value="18:00"></div><div class="field"><label class="label" for="busy-end">到</label><input id="busy-end" type="time" step="1800" value="20:00"></div></div><button class="btn wide" data-action="calendar-add-busy">留出这段时间</button>${busy.map(entry => `<div class="calendar-agenda-row"><strong>${esc(entry.label || "自己的安排")}</strong><span>${esc(calendarEntryTime(entry))}</span><button class="text-btn" data-action="calendar-remove-busy" data-id="${esc(entry.id)}">移除</button></div>`).join("")}</section><section class="calendar-panel"><h2>已经说好的见面</h2><p class="hint">自己发起的邀约，以及主动加入日程的邀约，都会记在这里。</p>${bookings.length ? bookings.map(entry => `<div class="calendar-agenda-row"><strong>${entry.role === "guest" ? `与 ${esc(entry.from || "TA")} 的约定` : `与 ${esc(entry.to || "TA")} 的约定`}</strong><span>${esc(calendarEntryTime(entry))}</span>${entry.status && entry.status !== "confirmed" ? '<small>正在商量新安排，原时间仍为你保留</small>' : ""}${entry.role === "guest" ? (entry.guestUrl || entry.shareUrl ? `<a class="text-btn" href="${esc(entry.guestUrl || entry.shareUrl)}">查看约定 →</a>` : "") : `<button class="text-btn" data-action="open" data-id="${esc(entry.invitationId)}">查看约定 →</button>`}</div>`).join("") : '<div class="calendar-empty">还没有约好的见面。<br>先给心里的人留一点时间吧。♡</div>'}</section></aside></div></section>`;
}
function bindCalendar() {
  document.querySelectorAll("[data-calendar-kind]").forEach(input => input.addEventListener("input", () => { calendarDraft[input.dataset.calendarKind][input.dataset.key][Number(input.dataset.index)][input.dataset.edge] = input.value; markCalendarDirty(); }));
  $("#calendar-timezone")?.addEventListener("change", event => { calendarDraft.timeZone = event.target.value; markCalendarDirty(); render(); });
  $("#busy-all-day")?.addEventListener("change", event => { for (const id of ["#busy-start", "#busy-end"]) $(id).disabled = event.target.checked; });
}
function markCalendarDirty() { calendarDirty = true; if ($("#calendar-save-status")) $("#calendar-save-status").textContent = "有新的调整还没保存。"; }
function availabilityPicker(plan, target = "journey") {
  const x = current(), data = currentAvailability(x), slots = data?.slots || [], zone = data?.timeZone || x.timeZone || "Asia/Shanghai";
  const today = zonedDay(zone), selected = target === "proposal" ? [modal?.slot].filter(Boolean) : plan.timeOptions || [];
  return `<div class="availability-picker"><div class="availability-heading"><span>${esc(zone)} · 每次 ${durationLabel(x.durationMinutes)}</span><button class="text-btn" data-action="availability-refresh">刷新</button></div><div class="availability-days" aria-label="未来 30 天的可选日期">${Array.from({ length: 30 }, (_, index) => addCalendarDays(today, index)).map(date => { const enabled = slots.some(slot => slot.date === date); return `<button data-action="availability-date" data-date="${date}" class="availability-day ${date === availabilityDate ? "selected" : ""}" ${enabled ? "" : "disabled"} aria-pressed="${date === availabilityDate}"><small>${dayNames[new Date(`${date}T12:00:00Z`).getUTCDay()]}</small><b>${Number(date.slice(5, 7))}/${Number(date.slice(8))}</b>${selected.some(slot => slot.date === date) ? '<i aria-label="已选">♥</i>' : ""}</button>`; }).join("")}</div>${slots.length ? `<p class="availability-date-label">${fmt(availabilityDate)} ${target === "proposal" ? "· 选一个新时间" : "· 最多选三个时间"}</p><div class="availability-slots">${slots.filter(slot => slot.date === availabilityDate).map(slot => `<button class="availability-slot ${selected.some(item => item.date === slot.date && item.time === slot.time) ? "selected" : ""}" data-action="availability-slot" data-target="${target}" data-date="${slot.date}" data-time="${slot.time}" aria-pressed="${selected.some(item => item.date === slot.date && item.time === slot.time)}">${esc(slot.time)}</button>`).join("")}</div>` : `<div class="calendar-empty">${data ? "这一个月暂时没有合适的空闲时间。<br>和 TA 商量一下，让 TA 调整时间表吧。" : "还没能打开空闲时间，点一下刷新再试试。"}</div>`}${selected.some(slot => slot?.date) ? `<div class="availability-selected">${selected.filter(slot => slot?.date).map(slot => `<span class="${slotAvailable(slot) ? "" : "unavailable"}">${esc(timeLabel(slot))}${slotAvailable(slot) ? "" : " · 已不可选"}<button aria-label="移除 ${esc(timeLabel(slot))}" data-action="availability-remove" data-target="${target}" data-date="${slot.date}" data-time="${slot.time}">×</button></span>`).join("")}</div>` : ""}<p class="hint">${target === "proposal" ? "等对方确认新安排后，才会替换原来的时间。" : "先留下心仪的时间，等双方说好后再为你们留住。"}</p></div>`;
}
function bindingEntry(x) {
  if (!x.responded || InviteModel.status(x) === "cancelled") return "";
  return `<div class="calendar-bind"><p>${x.calendarBound ? "这份约定已加入受邀人的日程，确认后会留出见面时间。" : "把这份小约定，也收进自己的日程。"}</p>${x.calendarBound ? '<a class="text-btn" href="/?schedule=1">查看我的日程 →</a>' : '<button class="text-btn" data-action="calendar-bind">加入我的日程 →</button>'}</div>`;
}
function retainedBookingNote(x) {
  if (!x.booking || ["confirmed", "cancelled"].includes(InviteModel.status(x))) return "";
  return `<div class="note-box retained-booking">新安排还在商量，原来的 ${esc(x.booking.date && x.booking.time ? timeLabel(x.booking) : calendarEntryTime(x.booking))} 仍为你们保留。</div>`;
}
async function completeCalendarBinding() {
  const result = await InviteAPI.post(`/api/guest/${encodeURIComponent(guestToken)}/bind`, {});
  if (result.invitation) mergeInvitation(result.invitation); else await refreshCurrent();
  try { sessionStorage.removeItem("opendater-calendar-bind"); } catch {}
  view = "result"; role = "guest"; await loadAvailability(); toast("这份心意，已经收进你的日程啦");
}
async function calendarAction(name, el) {
  if (name === "schedule" || name === "schedule-from-draft") {
    calendarReturn = name === "schedule-from-draft"; saveCreationDraft("schedule");
    if (requireAccount("schedule")) { await loadCalendar(true); view = "schedule"; }
  } else if (name === "calendar-return") { view = "create"; step = 1; calendarReturn = false; }
  else if (name === "calendar-refresh") { await loadCalendar(calendarDirty); toast(calendarDirty ? "约会已刷新，未保存的调整也还在" : "已经是最新的日程啦"); }
  else if (name === "calendar-save") { await InviteAPI.post("/api/schedule", { schedule: { timeZone: calendarDraft.timeZone, weekly: calendarDraft.weekly, overrides: calendarDraft.overrides } }); await loadCalendar(); saveCreationDraft(); toast("空闲时间，记好啦"); }
  else if (name === "calendar-add-date") { const date = $("#calendar-override-date").value, today = zonedDay(calendarZone()); if (!date || date < today || date > addCalendarDays(today, 29)) throw InviteAPI.userError("挑一个未来 30 天内的日期吧。"); calendarDraft.overrides[date] ||= []; markCalendarDirty(); }
  else if (name === "calendar-remove-date") { delete calendarDraft.overrides[el.dataset.date]; markCalendarDirty(); }
  else if (name === "calendar-add-interval") { const list = calendarDraft[el.dataset.kind][el.dataset.key] ||= []; if (list.length >= 8) throw InviteAPI.userError("一天最多留下八段空闲时间就好。"); list.push({ start: list.length ? "20:00" : "18:00", end: list.length ? "22:00" : "20:00" }); markCalendarDirty(); }
  else if (name === "calendar-remove-interval") { calendarDraft[el.dataset.kind][el.dataset.key].splice(Number(el.dataset.index), 1); markCalendarDirty(); }
  else if (name === "calendar-add-busy") { if (calendarData?.schedule?.timeZone !== calendarDraft.timeZone) throw InviteAPI.userError("先保存新的日程时区，再留出这段时间吧。"); const allDay = $("#busy-all-day")?.checked === true, date = $("#busy-date").value, time = allDay ? "00:00" : $("#busy-start").value, end = allDay ? "24:00" : $("#busy-end").value, durationMinutes = allDay ? 1440 : minutesOf(end) - minutesOf(time); if (!date || !time || !end || durationMinutes <= 0) throw InviteAPI.userError("把开始和结束时间填完整，结束要晚于开始哦。"); await InviteAPI.mutate("/api/schedule/busy", { date, ...(allDay ? {allDay:true} : {time,durationMinutes}), label: $("#busy-label").value.trim() }); await loadCalendar(true); toast("这段时间留给自己啦"); }
  else if (name === "calendar-remove-busy") { await InviteAPI.post(`/api/schedule/busy/${encodeURIComponent(el.dataset.id)}/remove`, {}); await loadCalendar(true); }
  else if (name === "time-policy") { draft.timePolicy = el.dataset.policy; if (draft.timePolicy === "schedule" && sessionUser && !calendarData) await loadCalendar(); saveCreationDraft(); }
  else if (name === "availability-refresh") { await loadAvailability(); }
  else if (name === "availability-date") { availabilityDate = el.dataset.date; }
  else if (name === "availability-slot" || name === "availability-remove") {
    const slot = { date: el.dataset.date, time: el.dataset.time };
    if (name === "availability-slot" && !slotAvailable(slot)) throw InviteAPI.userError("这个时间刚刚有了安排，再挑一个吧。");
    if (el.dataset.target === "proposal") { if (name === "availability-remove") modal.slot = null; else modal.slot = slot; }
    else { const selectedPlan = el.dataset.target === "proposal-range" ? modal.plan : guestJourney.plan; const list = selectedPlan.timeOptions.filter(item => item.date && item.time), exists = list.some(item => item.date === slot.date && item.time === slot.time); if (exists) selectedPlan.timeOptions = list.filter(item => item.date !== slot.date || item.time !== slot.time); else { if (list.length >= 3) throw InviteAPI.userError("最多留三个时间给 TA 挑，先移除一个吧。"); selectedPlan.timeOptions = [...list, slot]; } }
  } else if (name === "calendar-bind") {
    sessionUser = (await InviteAPI.get("/api/session")).user;
    if (sessionUser) { await completeCalendarBinding(); }
    else { accountIntent = "bind"; try { sessionStorage.setItem("opendater-calendar-bind", guestToken); } catch {} view = "account"; accountMessage = ""; }
  } else if (name === "calendar-bind-back") { view = "result"; try { sessionStorage.removeItem("opendater-calendar-bind"); } catch {} }
  else if (name === "cancel-invitation") { modal = { type: "cancel", version: current().version }; }
  else if (name === "confirm-cancel") { await updateRecord({ type: "cancel", version: modal.version }); closeModal(); view = guestToken ? "result" : "host"; await loadAvailability(); toast("这次约定已取消，时间也已空出来了"); }
  else return false;
  render(); return true;
}

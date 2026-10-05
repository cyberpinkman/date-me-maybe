/* Accounts and invitations are server-backed. The invitation URL selects the
   recipient boundary; only the server chooses identity, ownership, and role. */
const $ = (s) => document.querySelector(s);
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  coffee:
    '<path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8Zm14 1h2a3 3 0 1 1 0 6h-2M6 2v3m4-3v3m4-3v3"/>',
  food: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M20 3c-4 2-5 7-4 10h4M20 3v18"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m7 21 3-7 3 2 2 5M10 14l1-6 4 4h4M11 8 7 11H4"/>',
  movie:
    '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M7 4l4 6m3-6 4 6"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (n, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.heart}</svg>`;
const activities = [
  ["吃点好吃的", "food"],
  ["喝杯咖啡", "coffee"],
  ["散个步", "walk"],
  ["看场电影", "movie"],
  ["找个地方慢慢聊", "heart"],
  ["一起逛个展", "movie"],
];
const tones = [
  [
    "gentle",
    "轻轻试探",
    "发现一家想和你一起去的小店。\n想了想，还是想认真约你一次。",
  ],
  [
    "direct",
    "直球一点",
    "想见你这件事，想了有一阵子。\n这个周末，要不要一起出去？",
  ],
  [
    "playful",
    "有点俏皮",
    "这是一份认真又有点紧张的邀请。\n你负责出现，我负责偷偷开心。",
  ],
];
const dateString = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const future = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dateString(d);
};
const fmt = (d, weekday = true) => {
  if (!d) return "时间待商量";
  const x = new Date(d + "T12:00:00");
  return `${x.getMonth() + 1}月${x.getDate()}日${weekday ? " · " + ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][x.getDay()] : ""}`;
};
const emptyPlan = () => ({ timeOptions: [{date:"",time:""}], placeOptions: [""], activities: [], preferences: {hints:[],details:{}} });
const defaultDraft = () => ({
  from: "小宇", to: "小鹿", tone: "playful", message: tones[2][2], mode: "open", plan: emptyPlan(),
});
const creationSteps = () => draft.mode === "host" ? ["写点心里话", "安排见面", "检查邀请"] : ["写点心里话", "检查邀请"];
let draft = defaultDraft(),
  step = 0,
  view = "create",
  role = "host",
  currentId = null,
  modal = null,
  hostActivitySelection = null;
const guestToken = location.pathname.match(/^\/i\/([^/]+)\/?$/)?.[1] || null;
let invitations = [], booting = true, bootError = "", actionBusy = false, stateEpoch = 0;
function mergeInvitation(invitation) {
  const index = invitations.findIndex((item) => item.id === invitation.id);
  if (index < 0) invitations.push(invitation);
  else invitations[index] = invitation;
  return invitation;
}
async function refreshInvitations() {
  if (!sessionUser || guestToken) return;
  invitations = (await InviteAPI.get("/api/invitations")).invitations;
}
function invitationEndpoint() {
  return guestToken
    ? `/api/guest/${encodeURIComponent(guestToken)}`
    : `/api/invitations/${encodeURIComponent(currentId)}`;
}
async function refreshCurrent() {
  const data = await InviteAPI.get(invitationEndpoint());
  mergeInvitation(data.invitation);
  return data.invitation;
}
async function boot() {
  booting = true;
  bootError = "";
  render();
  try {
    appConfig = await InviteAPI.get("/api/config");
    if (guestToken) {
      role = "guest";
      const result = await InviteAPI.get(`/api/guest/${encodeURIComponent(guestToken)}`);
      invitations = [result.invitation];
      currentId = result.invitation.id;
      view = InviteModel.status(result.invitation) === "waiting" ? "guest" : "result";
    } else {
      const query = new URLSearchParams(location.search);
      const fresh = query.get("create") === "new";
      const restored = fresh ? false : restoreCreationDraft();
      if (fresh) {
        draft = defaultDraft(); step = 0; view = "create"; accountIntent = "create";
        saveCreationDraft(); history.replaceState(null, "", "/");
      }
      sessionUser = (await InviteAPI.get("/api/session")).user;
      if (sessionUser) await refreshInvitations();
      const selectedId = query.get("invitation");
      if (selectedId && sessionUser) {
        currentId = selectedId;
        await refreshCurrent();
        view = "host";
      } else if (selectedId) {
        requireAccount("list");
      } else if (query.has("login")) {
        view = sessionUser ? (restored && accountIntent === "list" ? "list" : "create") : "account";
        if (!sessionUser) accountMessage = "登录没有完成，草稿还在，可以重新试一次。";
        history.replaceState(null, "", "/");
      } else if (query.has("error")) {
        view = "account";
        accountMessage = "登录没有完成，草稿还在，可以重新试一次。";
      }
    }
  } catch (error) {
    bootError = error.status === 404 && guestToken
      ? "这份邀请暂时找不到了，检查一下链接是否完整。"
      : InviteAPI.message(error);
  }
  booting = false;
  render();
}
const current = () => invitations.find((x) => x.id === currentId);
const statusNames = {
  waiting: "等对方回应",
  host_review: "等确认见面安排",
  guest_review: "等确认新安排",
  details: "还差一个见面地点",
  confirmed: "已经约好啦",
  declined: "这次先不了",
};
const statusText = (x) => {
  const status = InviteModel.status(x);
  if (status === "host_review") return role === "host" ? "等你说好" : "等 TA 说好";
  if (status === "guest_review") return role === "guest" ? "等你说好" : "等 TA 说好";
  return statusNames[status];
};
const statusBadge = (x) =>
  `<span class="status-label ${InviteModel.status(x)}">${InviteModel.status(x) === "confirmed" ? "●" : "○"} ${statusText(x)}</span>`;
function mascot() {
  return window.MASCOT_DATA
    ? `<div class="mascot"><img src="${window.MASCOT_DATA}" alt="抱着爱心信封、害羞期待的小海豹"></div>`
    : '<div class="mascot"><span class="mascot-fallback">♡</span></div>';
}
function proposalActivities(p) {
  return Array.isArray(p?.activities) && p.activities.length ? [...p.activities] : [];
}
function detailChoices(value) {
  return (Array.isArray(value) ? value : [value]).filter((item) => typeof item === "string" && item.length > 0);
}
function activityDetail(p, activity) {
  const value = p?.preferences?.details?.[activity] ?? (p?.activity === activity ? p?.preferences?.detail || "" : "");
  if (InviteModel.isFullRange(p) && p.activity === activity && p.preferences?.detail) return p.preferences.detail;
  return detailChoices(value).join("、");
}
function activitySummary(x) {
  const p = x.proposal, range = proposalActivities(p), pendingRange = range.length > 0 && (!p.activity || (InviteModel.isFullRange(p) && !InviteModel.complete(p)));
  const items = pendingRange && !p.activity ? range : [p?.activity || x.activity].filter(Boolean);
  return {
    pendingRange,
    label: pendingRange ? "这些都愿意" : InviteModel.status(x) === "confirmed" ? "一起做" : "这次想一起",
    values: items.map((activity) => activity + (activityDetail(p, activity) ? " · " + activityDetail(p, activity) : "")),
  };
}
function selectedHostActivity(x) {
  if (!hostActivitySelection || hostActivitySelection.id !== x.id || hostActivitySelection.version !== x.version) {
    const range = proposalActivities(x.proposal);
    hostActivitySelection = { id: x.id, version: x.version, activity: x.proposal?.activity || (range.length === 1 ? range[0] : "") };
  }
  return hostActivitySelection.activity;
}
function hostActivityChoices(x) {
  const range = proposalActivities(x.proposal), selected = selectedHostActivity(x);
  return `<fieldset class="host-activity-choices"><legend>这次，我们就选一个。</legend><p class="hint">TA 说这些都愿意，你来敲定这次的小安排。</p><div role="radiogroup" aria-label="敲定这次活动">${range.map((activity) => `<button class="host-activity-choice ${selected === activity ? "selected" : ""}" role="radio" aria-checked="${selected === activity}" data-action="host-activity" data-activity="${esc(activity)}"><span><b>${esc(activity)}</b>${activityDetail(x.proposal, activity) ? `<small>${esc(activityDetail(x.proposal, activity))}</small>` : ""}</span><i class="radio"></i></button>`).join("")}</div></fieldset>`;
}
function planTimes(p, x = {}) {
  return p?.date && p?.time ? [{date:p.date,time:p.time}] : p?.timeOptions || x.options || [];
}
function planPlaces(p, x = {}) { return p?.place ? [p.place] : p?.placeOptions || (x.place ? [x.place] : []); }
function timeLabel(slot) { return slot?.date && slot?.time ? `${fmt(slot.date)} ${slot.time}` : "时间还没选好"; }
function proposalForDisplay(x) { return x.proposal || (x.mode === "host" ? x.plan : null); }
function cleanPlan(plan) {
  return { timeOptions: plan.timeOptions.map(({date,time}) => ({date,time})), placeOptions: plan.placeOptions.map((place) => place.trim()), activities: [...plan.activities], preferences: { hints:[...(plan.preferences?.hints || [])], details: Object.fromEntries(plan.activities.map((activity) => [activity, detailChoices(plan.preferences?.details?.[activity])])) } };
}
function validatePlan(plan) {
  if (!plan.timeOptions?.length || plan.timeOptions.some((slot) => !slot.date || !slot.time || !Number.isFinite(new Date(`${slot.date}T${slot.time}`).getTime()) || new Date(`${slot.date}T${slot.time}`) <= new Date())) return "把候选时间选完整，都要是还没到来的时间哦。";
  if (!plan.placeOptions?.length || plan.placeOptions.some((place) => !place.trim())) return "把想见面的地点写好，再把心意交给对方吧。";
  if (!plan.activities?.length) return "至少选一种愿意一起做的事吧。";
  return "";
}
function planRows(d, proposal) {
  const p = proposal || proposalForDisplay(d), summary = activitySummary({...d,proposal:p});
  return `<div class="plan-strip"><div>${icon("calendar",15)}<span>${planTimes(p,d).map(timeLabel).map(esc).join("<br>") || "时间，想挑你方便的"}</span></div><div>${icon("heart",15)}<span>${summary.values.map(esc).join("<br>") || "一起做什么，想听听你的"}</span></div><div>${icon("pin",15)}<span>${planPlaces(p,d).map(esc).join("<br>") || "在哪里见，由你来提议"}</span></div></div>`;
}
function proposalSummaryRows(x) {
  const p=x.proposal, summary=activitySummary(x);
  return `<div class="summary-lines"><div class="summary-line"><span>${p.date ? "时间" : "这些时间都可以"}</span><span>${planTimes(p).map(timeLabel).map(esc).join("<br>")}</span></div><div class="summary-line"><span>${summary.label}</span><span>${summary.values.map(esc).join("<br>")}</span></div><div class="summary-line"><span>${p.place ? "地点" : "这些地方都想去"}</span><span>${planPlaces(p).map(esc).join("<br>") || "待一起确定"}</span></div>${p.preferences?.hints?.length ? `<div class="summary-line"><span>小暗示</span><span>${p.preferences.hints.map(esc).join(" · ")}</span></div>` : ""}</div>`;
}
function cardRows(x) {
  const p=x.proposal, summary=activitySummary(x);
  return [[p.date ? "WHEN" : "候选时间",planTimes(p).map(timeLabel).join(" / ")], [summary.pendingRange ? "这些都愿意 · 等敲定这次安排" : InviteModel.status(x)==="confirmed" ? "TOGETHER" : "这次想一起",summary.values.join(" / ")], [p.place ? "MEET HERE" : "候选地点",planPlaces(p).join(" / ") || "地点，我们再一起选"], ...(p.preferences?.hints?.length ? [["小暗示",p.preferences.hints.join(" · ")]] : [])];
}
function selectedArrangement(x) {
  const p=x.proposal;
  if (!hostActivitySelection || hostActivitySelection.id!==x.id || hostActivitySelection.version!==x.version) hostActivitySelection={id:x.id,version:x.version,date:p.date||"",time:p.time||"",place:p.place||"",activity:p.activity||"",detail:p.preferences?.detail||""};
  return hostActivitySelection;
}
function selectionComplete(p, selection) {
  return !!(selection.date && selection.time && selection.place && selection.activity && (!detailChoices(p.preferences?.details?.[selection.activity]).length || selection.detail));
}
function selectionPayload(selection) { return Object.fromEntries(["date","time","place","activity","detail"].map((key)=>[key,selection[key]||""])); }
function selectArrangement(selection,p,field,value) {
  if (field==="time") { const slot=p.timeOptions[Number(value)]; if(slot) Object.assign(selection,slot); }
  else if(field==="place") selection.place=p.placeOptions[Number(value)] || "";
  else if(field==="activity") {
    const activity=p.activities[Number(value)]; if(!activity) return;
    if(selection.activity===activity) return;
    selection.activity=activity;
    const details=detailChoices(p.preferences?.details?.[activity]); selection.detail=details.length===1?details[0]:"";
  } else if(field==="detail") selection.detail=detailChoices(p.preferences?.details?.[selection.activity])[Number(value)] || "";
}
function fullChoiceFields(x) {
  const p=x.proposal, selected=selectedArrangement(x);
  const choices=(label,field,items,labels,chosen)=> items.length>1 ? `<fieldset class="host-activity-choices"><legend>${label}</legend><div role="radiogroup" aria-label="${label}">${items.map((value,index)=>`<button class="host-activity-choice ${chosen(value)?"selected":""}" role="radio" aria-checked="${chosen(value)}" data-action="plan-choice" data-field="${field}" data-index="${index}"><span>${esc(labels(value))}</span><i class="radio"></i></button>`).join("")}</div></fieldset>`:"";
  return choices("挑一个见面时间","time",p.timeOptions,timeLabel,v=>selected.date===v.date&&selected.time===v.time)+choices("在哪里碰面？","place",p.placeOptions,v=>v,v=>selected.place===v)+choices("这次，我们就选一个。","activity",p.activities,v=>v,v=>selected.activity===v)+(selected.activity?choices("再挑一个具体的小安排","detail",detailChoices(p.preferences?.details?.[selected.activity]),v=>v,v=>selected.detail===v):"");
}
function timeFields(plan,prefix) {
  return `<div class="candidate-list">${plan.timeOptions.map((slot,index)=>`<div class="candidate-row"><div class="columns"><div><label class="label" for="${prefix}-date-${index}">日期${plan.timeOptions.length>1?` ${index+1}`:""}</label><input id="${prefix}-date-${index}" data-plan-input="${prefix}" data-kind="date" data-index="${index}" type="date" min="${dateString(new Date())}" value="${esc(slot.date)}"></div><div><label class="label" for="${prefix}-time-${index}">时间</label><input id="${prefix}-time-${index}" data-plan-input="${prefix}" data-kind="time" data-index="${index}" type="time" value="${esc(slot.time)}"></div></div>${plan.timeOptions.length>1?`<button class="text-btn candidate-remove" data-action="${prefix}-remove-time" data-index="${index}" aria-label="移除候选时间 ${index+1}">移除</button>`:""}</div>`).join("")}</div>${plan.timeOptions.length<3?`<button class="text-btn candidate-add" data-action="${prefix}-add-time">＋ 再留一个时间</button>`:""}`;
}
function placeFields(plan,prefix) {
  return `<div class="candidate-list">${plan.placeOptions.map((place,index)=>`<div class="candidate-row"><label class="label" for="${prefix}-place-${index}">见面地点${plan.placeOptions.length>1?` ${index+1}`:""}</label><input id="${prefix}-place-${index}" data-plan-input="${prefix}" data-kind="place" data-index="${index}" maxlength="60" value="${esc(place)}" placeholder="店名、地址或好找的集合点">${plan.placeOptions.length>1?`<button class="text-btn candidate-remove" data-action="${prefix}-remove-place" data-index="${index}" aria-label="移除候选地点 ${index+1}">移除</button>`:""}</div>`).join("")}</div>${plan.placeOptions.length<3?`<button class="text-btn candidate-add" data-action="${prefix}-add-place">＋ 再留一个地点</button>`:""}`;
}
function editPlanCandidates(plan,action,index) {
  if(action==="add-time"&&plan.timeOptions.length<3) plan.timeOptions.push({date:"",time:""});
  if(action==="remove-time"&&plan.timeOptions.length>1) plan.timeOptions.splice(index,1);
  if(action==="add-place"&&plan.placeOptions.length<3) plan.placeOptions.push("");
  if(action==="remove-place"&&plan.placeOptions.length>1) plan.placeOptions.splice(index,1);
}
function bindPlanInputs(prefix,plan,onChange) {
  document.querySelectorAll(`[data-plan-input="${prefix}"]`).forEach(el=>el.addEventListener("input",()=>{const index=Number(el.dataset.index);if(el.dataset.kind==="place")plan.placeOptions[index]=el.value;else plan.timeOptions[index][el.dataset.kind]=el.value;onChange();}));
}
function invitationCard(d) {
  return `<article class="invitation-card"><div class="card-top"><span>A LITTLE INVITATION</span><span class="mini-heart">♡</span></div>${mascot()}<div class="to-name">给 ${esc(d.to || "那个想见的人")}</div><h2>可以和我<br>一起约会吗？</h2><p class="personal-message">${esc(d.message)}</p>${planRows(d)}<div class="btn primary wide card-action" aria-hidden="true">好呀，我愿意 ${icon("heart", 16)}</div><div class="card-footer">一份藏不住的小心意，等你来拆开</div><div class="card-sign">装作不在意，其实很期待。<br><b>— ${esc(d.from || "你的名字")}</b></div></article>`;
}
function render() {
  cleanupRunaway();
  cleanupRunaway = () => {};
  if (view === "guest" && current() && InviteModel.status(current()) !== "waiting") {
    view = "result";
    guestJourney = null;
  }
  document.body.dataset.view = view;
  document.body.dataset.audience = guestToken ? "guest" : "host";
  document.title = guestToken ? "有一份只给你的邀请 · 见一面" : "见一面 · Date Me Maybe";
  const brand = `<span class="brand-mark">${icon("heart", 21)}</span>见一面`;
  const header = `<header class="site-header">${guestToken ? `<span class="brand">${brand}</span>` : `<button class="brand" data-action="home" aria-label="见一面首页">${brand}</button><nav class="nav" aria-label="主导航"><button class="${view === "create" || view === "ready" ? "active" : ""}" data-action="home">制作邀请</button><button class="${view === "list" || view === "host" ? "active" : ""}" data-action="list">我的邀约${sessionUser && invitations.length ? ` · ${invitations.length}` : ""}</button>${sessionUser ? `<button class="account-nav" data-action="logout" title="${esc(sessionUser.email || sessionUser.name)}">退出登录</button>` : '<button class="account-nav" data-action="login">登录</button>'}</nav>`}</header>`;
  const content = booting
    ? '<section class="loading-state" role="status"><span class="loading-heart">♡</span><p>正在打开这份小心意…</p></section>'
    : bootError
      ? `<section class="loading-state"><span class="loading-heart">♡</span><h2>还没能打开。</h2><p class="sub">${esc(bootError)}</p><button class="btn primary" data-action="retry-boot">再试一次</button></section>`
      : view === "account" ? accountView() : view === "create" ? editor() : view === "ready" ? readyView() : view === "list" ? listView() : view === "host" ? hostView() : guestView();
  $("#root").innerHTML = `${header}<main>${content}</main><footer class="footer"><span>见一面 · 先从一次小小的邀请开始</span><span>认真邀请，轻松回应。</span></footer><div id="modal-root"></div><div id="toast-root" role="status" aria-live="polite"></div>`;
  bind();
  if (modal) renderModal();
}

function editor() {
  return `<div class="workbench"><section class="editor"><p class="eyebrow">FOR SOMEONE SPECIAL</p><h1>有点想见你。<br>那就，认真约一次。</h1><p class="sub" style="margin-top:10px">把没说出口的话，变成一份小邀请。</p><div class="steps">${creationSteps().map((s, i) => `${i ? '<span class="step-line"></span>' : ""}<div class="step ${step === i ? "active" : step > i ? "done" : ""}"><i>${step > i ? "✓" : i + 1}</i>${s}</div>`).join("")}</div><div class="form-section">${step === 0 ? firstStep() : draft.mode === "host" && step === 1 ? arrangementStep() : invitationReview()}</div></section><aside class="preview-column" aria-label="邀请实时预览"><div class="preview-label"><span>对方会收到这样一份邀请</span><span class="live-label">实时预览</span></div><div class="stage" id="live-preview">${invitationCard(draft)}</div><p class="preview-note">只要真诚一点，就已经很可爱了。</p></aside></div>`;
}
function firstStep() {
  return `<div class="field"><div class="label">这次，想怎么邀请？</div><div class="invitation-modes">${[["host","我来安排","先准备好小安排，让 TA 从中选"],["open","想听 TA 的","让 TA 说说心愿，最后我来敲定"]].map(([mode,title,note])=>`<button class="mode-choice ${draft.mode===mode?"selected":""}" data-action="creation-mode" data-mode="${mode}" aria-pressed="${draft.mode===mode}"><b>${title}</b><small>${note}</small></button>`).join("")}</div></div><div class="columns"><div class="field"><label class="label" for="from">你的昵称</label><input id="from" data-field="from" maxlength="16" value="${esc(draft.from)}" placeholder="对方怎么称呼你"></div><div class="field"><label class="label" for="to">想邀请谁</label><input id="to" data-field="to" maxlength="16" value="${esc(draft.to)}" placeholder="TA 的昵称"></div></div><div class="field"><div class="label">选一种开场语气 <small>文案可以自己改</small></div><div class="tone-group">${tones.map((t) => `<button class="tone ${draft.tone === t[0] ? "selected" : ""}" data-action="tone" data-tone="${t[0]}" aria-pressed="${draft.tone === t[0]}">${t[1]}</button>`).join("")}</div></div><div class="field"><label class="label" for="message">想对 TA 说的话 <small id="word-count">${draft.message.length}/120</small></label><textarea id="message" data-field="message" maxlength="120">${esc(draft.message)}</textarea><p class="hint">换上你们的昵称，再写一句只有 TA 能懂的话。</p></div><div id="form-error" class="error" role="alert"></div><div class="actions"><button class="btn primary" data-action="next">${draft.mode === "host" ? "准备一点小安排" : "看看这份邀请"} ${icon("arrow")}</button></div>`;
}
function arrangementStep() {
  const plan=draft.plan;
  return `<h2>把想见你的心意，安排好。</h2><p class="sub">每项可以留一个答案，也可以留几个小提议，让 TA 来选。</p><div class="field"><h3>什么时候见</h3>${timeFields(plan,"draft")}</div><div class="field"><h3>在哪里见</h3>${placeFields(plan,"draft")}</div><div class="field"><h3>想一起做什么</h3><div class="scene-activities">${activities.map(([activity,symbol])=>`<button class="scene-activity ${plan.activities.includes(activity)?"selected":""}" data-action="draft-activity" data-activity="${activity}" aria-pressed="${plan.activities.includes(activity)}">${icon(symbol,22)}<span>${activity}</span><i class="multi-check">${plan.activities.includes(activity)?"✓":""}</i></button>`).join("")}</div></div>${plan.activities.map(activity=>`<div class="field"><h3>${esc(activity)} · 小偏好</h3><p class="hint">喜欢的都可以留给 TA 选，不选也没关系。</p><div class="scene-hints">${sceneDetails[activity].items.map(([emoji,detail],index)=>`<button class="hint-choice ${detailChoices(plan.preferences.details[activity]).includes(detail)?"selected":""}" data-action="draft-detail" data-activity="${activity}" data-index="${index}" aria-pressed="${detailChoices(plan.preferences.details[activity]).includes(detail)}"><span>${emoji} ${detail}</span><span class="hint-check">${detailChoices(plan.preferences.details[activity]).includes(detail)?"✓":"+"}</span></button>`).join("")}</div></div>`).join("")}<div id="form-error" class="error" role="alert"></div><div class="actions"><button class="text-btn" data-action="prev">回去改改</button><button class="btn primary" data-action="next">看看这份邀请 ${icon("arrow")}</button></div>`;
}
function invitationReview() {
  return `<h2>这一份，只想发给 ${esc(draft.to)}。</h2><p class="sub">${draft.mode==="host"?"小安排准备好了，等 TA 来选喜欢的。":"心意先到，见面的安排想听听 TA 的。"}</p><div class="summary-lines"><div class="summary-line"><span>邀请对象</span><b>${esc(draft.from)} → ${esc(draft.to)}</b></div><div class="summary-line"><span>想对 TA 说</span><span class="review-message">${esc(draft.message)}</span></div></div>${draft.mode==="host"?planRows(draft):'<div class="note-box">让 TA 留下方便的时间、想去的地方和愿意一起做的事。等心意回来，你再敲定这次见面。</div>'}<div id="form-error" class="error" role="alert"></div><div class="actions"><button class="text-btn" data-action="prev">回去改改</button><button class="btn primary" data-action="create">把邀请准备好 ${icon("heart")}</button></div>`;
}
function shareControls(x) {
  return `<div class="share-box"><label class="label" for="share-link">发给 ${esc(x.to)} 的专属链接</label><input id="share-link" value="${esc(x.shareUrl || "")}" readonly aria-label="邀请分享链接"><div class="actions"><button class="btn primary" data-action="copy-link">${icon("copy")}复制邀请链接</button><a class="btn" href="${esc(x.shareUrl || "#")}" target="_blank" rel="noopener noreferrer">打开这份邀请 ${icon("arrow")}</a></div><p class="hint">把链接发给 TA，回来看看有没有收到心动的回应。</p></div>`;
}
function readyView() {
  const x = current();
  return `<div class="workbench"><section class="editor"><div class="success-check">${icon("check", 25)}</div><p class="eyebrow">READY TO MAKE A LITTLE MOVE</p><h1>心意准备好了。<br>剩下的，交给勇气。</h1><p class="sub" style="margin-top:17px">给 ${esc(x.to)} 的邀请已保存在「我的邀约」。</p>${shareControls(x)}<div class="actions"><button class="text-btn" data-action="host">查看邀请和回应 ${icon("arrow")}</button></div></section><aside class="preview-column"><div class="stage">${invitationCard(x)}</div></aside></div>`;
}

function switchHeader() {
  return guestToken
    ? `<div class="view-header guest-result-header"><span>我们的小约定</span><button class="text-btn" data-action="refresh">刷新回应 ${icon("arrow", 15)}</button></div>`
    : `<div class="view-header"><button class="text-btn" data-action="list">${icon("back", 15)} 我的邀约</button><button class="text-btn" data-action="refresh">刷新回应 ${icon("arrow", 15)}</button></div>`;
}

function guestView() {
  const x = current();
  if (!x) return '<div class="empty">这份邀请暂时无法打开。</div>';
  return view === "guest"
    ? journeyView(x)
    : `${switchHeader()}<div class="recipient-area">${resultCard(x, true)}${x.responded ? '<div class="recipient-create"><p>也有一个，想认真邀请的人？</p><a class="btn" href="/?create=new">我也要发起邀约 ♡</a></div>' : ""}</div>`;
}
function resultCard(x, buttons = false) {
  const s = InviteModel.status(x),
    p = x.proposal;
  const titles = {
    confirmed: "那就说好啦，<br>到时候见。",
    details: "愿意见面，<br>已经很开心了。",
    host_review: "你的心意，<br>也被认真收到了。",
    guest_review: "有一个新安排，<br>想和你确认。",
    declined: "谢谢你，<br>认真告诉我。",
    waiting: "一份小邀请，<br>等一个回应。",
  };
  const notes = {
    confirmed: "这一次的时间、地点和小安排，我们都说好了。",
    details: "还差一个见面地点，一起补上吧。",
    host_review: proposalActivities(p).length && (!p.activity || (InviteModel.isFullRange(p) && !InviteModel.complete(p)))
      ? (role === "host" ? "TA 的时间、地点和小心思都在这里，挑一个最合心意的安排吧。" : "这些都是你愿意的小安排，等 TA 敲定这次见面。")
      : (role === "host" ? "TA 捎来了见面的安排，看看是不是正合你意。" : "这份小安排已经告诉 TA 了，等一句说好。"),
    guest_review: "看看新的时间和地点，合适就约好啦。",
    declined: "这次邀请就到这里。愿我们都轻松一点。",
    waiting: "不着急，给对方一点时间。",
  };
  return `<article class="invitation-card result-card"><div class="card-top"><span>OUR LITTLE PROMISE</span><span class="mini-heart">♡</span></div>${mascot()}${statusBadge(x)}<h2 class="result-title">${titles[s]}</h2><p class="result-note">${notes[s]}</p>${s !== "declined" ? (p ? ticket(x) : planRows(x)) : ""}${buttons ? resultActions(x) : ""}<div class="ticket-note">${esc(x.from)} & ${esc(x.to)}<br>见面这件小事，我们认真一点。</div></article>`;
}
function ticket(x) {
  const p=x.proposal,summary=activitySummary(x),times=planTimes(p),places=planPlaces(p);
  return `<div class="ticket"><div class="ticket-detail"><small>${p.date?"见面时间":"这些时间都可以"}</small>${times.map(slot=>`<b class="activity-summary-item">${esc(timeLabel(slot))}</b>`).join("")}</div><div class="ticket-detail"><small>${summary.label}</small>${summary.values.map(value=>`<b class="activity-summary-item">${esc(value)}</b>`).join("")}${summary.pendingRange?'<p class="hint">把这次的时间、地点和小安排敲定，再说好见面。</p>':""}</div><div class="ticket-detail"><small>${p.place?"MEET HERE":"这些地方都想去"}</small><b data-plan-place>${places.map(esc).join("<br>")||"还需要填写见面地点"}</b></div>${preferenceRows(p)}</div>`;
}
function resultActions(x) {
  const s=InviteModel.status(x),p=x.proposal,range=proposalActivities(p),full=InviteModel.isFullRange(p);
  const review=(role==="host"&&s==="host_review")||(role==="guest"&&s==="guest_review");
  const fullFinalize=full&&review&&role!==InviteModel.scopeOwner(x)&&!InviteModel.complete(p);
  const legacyFinalize=!full&&role==="host"&&s==="host_review"&&range.length>0&&!p.activity;
  const canConfirm=review&&!fullFinalize&&!legacyFinalize&&!!p?.activity;
  return `${fullFinalize?fullChoiceFields(x):legacyFinalize?hostActivityChoices(x):""}<div class="response-actions">${fullFinalize||legacyFinalize?`<button class="btn primary wide" data-action="finalize" ${(fullFinalize?!selectionComplete(p,selectedArrangement(x)):!selectedHostActivity(x))?"disabled":""}>就这样，说好啦 ${icon("check")}</button>`:canConfirm?`<button class="btn primary wide" data-action="confirm">这个安排可以，确认 ${icon("check")}</button>`:""}${s==="confirmed"?`<button class="btn primary wide" data-action="save-card">保存约定卡 ${icon("download")}</button>`:["host_review","guest_review","details"].includes(s)?`<button class="btn wide" data-action="save-card">保存这份小心意 ${icon("download")}</button>`:""}${s==="confirmed"?'<button class="text-btn" data-action="change">需要改期或换个地点</button>':s==="details"&&!full?'<button class="btn primary wide" data-action="change">一起把地点定下来</button>':""}</div>`;
}
function hostView() {
  const x = current();
  if (!x) return listView();
  const s = InviteModel.status(x);
  const titles = {
    waiting: `邀请已经准备好，<br>等 ${esc(x.to)} 的回应。`,
    host_review: `${esc(x.to)} 愿意见面，<br>看看 TA 的安排。`,
    guest_review: "新安排准备好了，<br>等对方再确认。",
    details: "我们愿意见面，<br>再把地点定下来。",
    confirmed: "这次见面，<br>终于有了具体模样。",
    declined: "收到了 TA 的回复，<br>这次就先到这里。",
  };
  return `${switchHeader()}<div class="host-layout"><section class="host-copy">${statusBadge(x)}<h1>${titles[s]}</h1><p class="sub">${s === "waiting" ? "把专属链接发给 TA，再回来看看心意有没有回音。" : s === "confirmed" ? "时间、地点和心意，都在这张小约定里。" : s === "declined" ? "回应已经保存。感谢对方的坦诚，也照顾好自己的心情。" : "把时间和地点一起说好，就等见面啦。"}</p>${x.proposal && s !== "declined" ? proposalSummaryRows(x) : ""}${resultActions(x)}${shareControls(x)}<p class="hint">${s === "confirmed" ? "小约定收好啦，见面的期待也留好了。" : s === "host_review" ? "TA 的小心思都在这里，看看是不是正合你意。" : s === "waiting" ? "有新回应时，这里就会告诉你。" : "想看看有没有新消息，点一下「刷新回应」就好。"}</p></section>${resultCard(x)}</div>`;
}
function listView() {
  return `<section class="list-wrap"><div class="list-head"><div><p class="eyebrow">MY LITTLE INVITATIONS</p><h1>我的邀约</h1></div><div class="list-head-actions"><button class="text-btn" data-action="refresh">刷新</button><button class="btn primary" data-action="new">＋ 再写一份</button></div></div>${
    invitations.length
      ? `<div class="invite-list">${invitations
          .slice()
          .reverse()
          .map(
            (x) =>
              `<button class="invite-row" data-action="open" data-id="${esc(x.id)}"><div><h3>给 ${esc(x.to)} 的小邀请</h3><p>${esc(x.proposal ? (activitySummary(x).pendingRange ? "这些都愿意：" : "") + activitySummary(x).values.join(" / ") : x.activity || "等 TA 选个小安排")} · ${esc(planTimes(proposalForDisplay(x),x).map(timeLabel).join(" / ") || "时间，等一起选")}</p></div><div style="text-align:right">${statusBadge(x)}<div>${icon("arrow", 18)}</div></div></button>`,
          )
          .join(
            "",
          )}</div><p class="hint" style="margin-top:18px">想见谁、约到哪一步，都替你记在这里。</p>`
      : '<div class="empty"><h2>第一份心意，还等你落笔。</h2><p class="sub">有个想见的人，就从这里开始。</p><button class="btn primary" data-action="new">写一份小邀请 ' +
        icon("heart") +
        "</button></div>"
  }</section>`;
}
function bind() {
  if (view === "create") bindPlanInputs("draft",draft.plan,()=>{saveCreationDraft();updatePreview();});
  if (view === "account") bindAccount();
  if (view === "guest") bindJourneyInputs();
  document
    .querySelectorAll("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => action(el.dataset.action, el)),
    );
  document.querySelectorAll("[data-field]").forEach((el) =>
    el.addEventListener("input", () => {
      draft[el.dataset.field] = el.value;
      saveCreationDraft();
      updatePreview();
      if ($("#word-count"))
        $("#word-count").textContent = draft.message.length + "/120";
    }),
  );

}
function updatePreview() {
  const p = $("#live-preview");
  if (p) p.innerHTML = invitationCard(draft);
}
function validateStep(all = false) {
  if (!draft.from.trim() || !draft.to.trim()) return "先填一下你和 TA 的昵称吧。";
  if (!draft.message.trim()) return "写一句想对 TA 说的话吧。";
  if(draft.mode === "host" && (all || step > 0)) return validatePlan(draft.plan);
  return "";
}
async function updateRecord(event) {
  const x = current();
  const body = { type: event.type, version: event.version ?? x.version };
  if (event.proposal) body.proposal = event.proposal;
  try {
    const result = await InviteAPI.mutate(invitationEndpoint() + "/actions", body);
    return mergeInvitation(result.invitation);
  } catch (error) {
    if (error.status === 409) {
      await refreshCurrent();
      disposeCardExport(modal);
      modal = null;
      render();
      error.message = "安排刚刚有更新，已经帮你换成新的了。看看，再说好吧。";
      error.userSafe = true;
    }
    throw error;
  }
}
async function action(a, el) {
  if (actionBusy) return;
  actionBusy = true;
  stateEpoch++;
  if (el?.tagName === "BUTTON") el.disabled = true;
  try {
    if (a === "retry-boot") { await boot(); return; }
    if (a.startsWith("journey-")) { await journeyAction(a, el); return; }
    if (["home","new","open","host","list","login"].includes(a) && modal) closeModal();
    if (!guestToken && await accountAction(a)) {
      render();
      return;
    }
    if (a === "home") {
      if (guestToken) { location.assign("/"); return; }
      view = "create";
      role = "host";
      history.replaceState(null, "", "/");
    } else if (a === "new") {
      draft = defaultDraft();
      step = 0;
      view = "create";
      role = "host";
      saveCreationDraft();
      history.replaceState(null, "", "/");
    } else if (a === "login") {
      requireAccount("list");
    } else if (a === "list") {
      if (guestToken) return;
      if (requireAccount("list")) {
        await refreshInvitations();
        view = "list";
      }
      role = "host";
      history.replaceState(null, "", "/");
    } else if (a === "next") {
      const error = validateStep();
      if (error) { $("#form-error").textContent = error; return; }
      step = Math.min(creationSteps().length-1,step+1);
      saveCreationDraft();
    } else if (a === "prev") { step = Math.max(0,step-1); saveCreationDraft(); }
    else if (a === "creation-mode") { draft.mode=el.dataset.mode === "host" ? "host" : "open"; step=0; saveCreationDraft(); }
    else if(a.startsWith("draft-")) {
      const plan=draft.plan,activity=el.dataset.activity;
      if(a==="draft-activity") plan.activities=plan.activities.includes(activity)?plan.activities.filter(v=>v!==activity):[...plan.activities,activity];
      else if(a==="draft-detail") {const detail=sceneDetails[activity].items[Number(el.dataset.index)][1],selected=detailChoices(plan.preferences.details[activity]);plan.preferences.details[activity]=selected.includes(detail)?selected.filter(v=>v!==detail):[...selected,detail];}
      else editPlanCandidates(plan,a.slice(6),Number(el.dataset.index));
      saveCreationDraft();
    } else if (a === "tone") {
      draft.tone = el.dataset.tone;
      draft.message = tones.find((t) => t[0] === draft.tone)[2];
      saveCreationDraft();
    } else if (a === "create") {
      if (!requireAccount("create")) { render(); return; }
      const error = validateStep(true);
      if (error) throw InviteAPI.userError(error);
      const cleanDraft = {
        from: draft.from.trim(), to: draft.to.trim(), tone: draft.tone,
        message: draft.message.trim(), mode: draft.mode,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
      };
      if (draft.mode === "host") cleanDraft.plan=cleanPlan(draft.plan);
      const result = await InviteAPI.mutate("/api/invitations", { draft: cleanDraft });
      mergeInvitation(result.invitation);
      currentId = result.invitation.id;
      view = "ready";
      history.replaceState(null, "", "/?invitation=" + encodeURIComponent(currentId));
      try { sessionStorage.removeItem(draftStorageKey); } catch {}
      celebrate();
    } else if (a === "open") {
      if (guestToken) return;
      currentId = el.dataset.id;
      await refreshCurrent();
      role = "host";
      view = "host";
      history.replaceState(null, "", "/?invitation=" + encodeURIComponent(currentId));
    } else if (a === "host") {
      if (guestToken) return;
      role = "host";
      view = "host";
    } else if (a === "refresh") {
      if (view === "list") await refreshInvitations();
      else await refreshCurrent();
      render();
      toast("已经是最新回应啦");
      return;
    } else if (a === "host-activity") {
      const x = current();
      if (role !== "host" || !proposalActivities(x.proposal).includes(el.dataset.activity)) return;
      selectedHostActivity(x);
      hostActivitySelection.activity = el.dataset.activity;
    } else if (a === "plan-choice") {
      selectArrangement(selectedArrangement(current()),current().proposal,el.dataset.field,el.dataset.index);
    } else if (a === "finalize") {
      if(InviteModel.isFullRange(current().proposal)) {
        const selected=selectedArrangement(current());
        if(!selectionComplete(current().proposal,selected)) throw InviteAPI.userError("把时间、地点和具体的小安排都选好吧。");
        await updateRecord({type:"finalize",proposal:selectionPayload(selected)});
      } else {
        const activity=selectedHostActivity(current());
        if(!activity) throw InviteAPI.userError("先挑一个这次想一起做的事吧。");
        await updateRecord({type:"finalize",proposal:{activity}});
      }
      celebrate();
    } else if (a === "confirm") {
      await updateRecord({ type: "confirm" });
      celebrate();
    } else if (a === "change") {
      if (InviteModel.status(current()) !== "confirmed" && !(InviteModel.status(current()) === "details" && !InviteModel.isFullRange(current().proposal))) return;
      modal = { type: "proposal", version: current().version, activity: role === "host" ? selectedHostActivity(current()) : current().proposal?.activity || "" };
      renderModal();
      return;
    } else if (a === "close-modal") { closeModal(); return; }
    else if (a === "submit-proposal") {
      const date = $("#proposal-date").value, time = $("#proposal-time").value,
        place = $("#proposal-place").value.trim();
      if (!date || !time || new Date(`${date}T${time}`) <= new Date()) {
        $("#proposal-error").textContent = "请选一个完整、还没到来的时间。";
        return;
      }
      if (!place) {
        $("#proposal-error").textContent = "还差一个见面地点，写下在哪里碰面吧。";
        return;
      }
      const proposal = { date, time, place }, p = current().proposal;
      if (!InviteModel.isFullRange(p) && role === "host" && proposalActivities(p).length) {
        proposal.activity = p.activity || document.querySelector('[name="proposal-activity"]:checked')?.value || "";
        if (!proposal.activity) { $("#proposal-error").textContent = "再选一个这次想一起做的事吧。"; return; }
      }
      await updateRecord({ type: "propose", version: modal.version, proposal });
      closeModal();
      view = guestToken ? "result" : "host";
    } else if (a === "copy-link") {
      try {
        await navigator.clipboard.writeText(current().shareUrl);
        toast("专属链接已复制，发给 TA 吧");
      } catch {
        $("#share-link")?.select();
        toast("请复制已选中的邀请链接");
      }
      return;
    } else if (a === "copy") { await copyText(); return; }
    else if (a === "save-card") { await saveCard(); return; }
    render();
    if (!["tone", "host-activity", "plan-choice", "creation-mode"].includes(a) && !a.startsWith("draft-")) window.scrollTo({ top: 0, behavior: "instant" });
  } catch (error) {
    if (error.status === 401 && !guestToken) {
      const intent = view === "create" ? "create" : "list";
      resetSenderIdentity();
      requireAccount(intent);
      render();
    }
    if (view === "account") {
      accountMessage = InviteAPI.message(error);
      const message = $("#account-message");
      if (message) message.textContent = accountMessage;
    } else toast(InviteAPI.message(error));
  } finally {
    actionBusy = false;
    if (el?.isConnected && el.tagName === "BUTTON") el.disabled = false;
  }
}
// Refresh server state only on reading screens. Draft inputs and a recipient's
// unfinished scene remain untouched by background updates.
setInterval(async () => {
  if (booting || bootError || actionBusy || modal || document.hidden || !["host", "list", "result"].includes(view)) return;
  const before = JSON.stringify(invitations), epoch = stateEpoch, readingView = view;
  try {
    const result = await InviteAPI.get(view === "list" ? "/api/invitations" : invitationEndpoint());
    if (epoch !== stateEpoch || readingView !== view || modal || actionBusy) return;
    if (view === "list") invitations = result.invitations;
    else mergeInvitation(result.invitation);
    if (before !== JSON.stringify(invitations)) render();
  } catch { /* Explicit refresh provides a visible retry without interrupting reading. */ }
}, 15000);
let toastTimer;
function toast(text) {
  clearTimeout(toastTimer);
  $("#toast-root").innerHTML = `<div class="toast">${esc(text)}</div>`;
  toastTimer = setTimeout(() => {
    if ($("#toast-root")) $("#toast-root").innerHTML = "";
  }, 3500);
}
function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < 10; i++) {
    const h = document.createElement("span");
    h.className = "heart-float";
    h.textContent = "♥";
    h.style.left = `${30 + Math.random() * 40}%`;
    h.style.top = `${45 + Math.random() * 20}%`;
    h.style.animationDelay = `${i * 0.06}s`;
    document.body.append(h);
    setTimeout(() => h.remove(), 2500);
  }
}
let priorFocus;
function renderModal() {
  const x = current();
  priorFocus = document.activeElement;
  if (modal.type === "card") { renderCardModal(); return; }
  const p = x.proposal || { ...x.options?.[0], place: x.place || "" };
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">换个舒服的安排。</h2><button class="close" data-action="close-modal" aria-label="关闭">×</button></div><p>${InviteModel.status(x) === "confirmed" ? "换了时间或地点，再和 TA 说好一次。" : "把你方便的时间和地点告诉对方，等 TA 确认。"}</p><div class="columns"><div class="field"><label class="label" for="proposal-date">日期</label><input id="proposal-date" type="date" min="${dateString(new Date())}" value="${esc(p.date)}"></div><div class="field"><label class="label" for="proposal-time">时间</label><input id="proposal-time" type="time" value="${esc(p.time)}"></div></div><div class="field"><label class="label" for="proposal-place">见面地点</label><input id="proposal-place" maxlength="60" placeholder="具体在哪里碰面？" value="${esc(p.place)}"><p class="hint">留下一个好找的地方，见面时就不怕错过啦。</p></div>${role === "host" && proposalActivities(p).length && !p.activity ? `<fieldset class="modal-activity-choices"><legend>这次想一起做什么？</legend>${proposalActivities(p).map((activity, index) => `<label for="proposal-activity-${index}"><input id="proposal-activity-${index}" name="proposal-activity" type="radio" value="${esc(activity)}" ${modal.activity === activity ? "checked" : ""}><span>${esc(activity)}${activityDetail(p, activity) ? ` · ${esc(activityDetail(p, activity))}` : ""}</span></label>`).join("")}</fieldset>` : ""}<div class="error" id="proposal-error" role="alert"></div><button class="btn primary wide" data-action="submit-proposal">提议这个安排 ${icon("arrow")}</button></section></div>`;
  $("#modal-root")
    .querySelectorAll("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => action(el.dataset.action, el)),
    );
  $("#modal-root").querySelector("input,button")?.focus();
}
function closeModal() {
  disposeCardExport(modal);
  modal = null;
  $("#modal-root").innerHTML = "";
  priorFocus?.focus();
}
document.addEventListener("keydown", (e) => {
  if (!modal) return;
  if (e.key === "Escape") closeModal();
  if (e.key === "Tab") {
    const els = Array.from(
      $("#modal-root").querySelectorAll("button,input,textarea,a[href]"),
    ).filter((x) => !x.disabled);
    const first = els[0],
      last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
function invitationText(x) {
  const p=proposalForDisplay(x),summary=activitySummary({...x,proposal:p});
  return `${x.to}，可以和我一起约会吗？\n\n${x.message}\n\n${planTimes(p,x).map(timeLabel).join(" 或 ")||"时间，想挑你方便的"}\n${summary.values.length?summary.label+"："+summary.values.join(" / "):"一起做什么，想听听你的"}\n${planPlaces(p,x).join(" 或 ")||"在哪里见，由你来提议"}${p?.preferences?.hints?.length?"\n小暗示："+p.preferences.hints.join(" · "):""}\n\n——${x.from}`;
}
async function copyText() {
  const text = invitationText(current());
  try {
    await navigator.clipboard.writeText(text);
    toast("邀请文字已复制，发给 TA 吧");
  } catch {
    toast("没能直接复制，试试长按邀请文字吧");
  }
}

boot();

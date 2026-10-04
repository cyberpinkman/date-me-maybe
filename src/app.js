/* Prototype scope: browser-local invitations, explicit role simulation, no remote delivery.
   Shared invariant: confirmed means both roles accepted the same complete proposal version. */
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
const defaultDraft = () => ({
  from: "小宇",
  to: "小鹿",
  tone: "playful",
  message: tones[2][2],
  mode: "fixed",
  options: [
    { date: future(3), time: "18:30" },
    { date: future(4), time: "15:00" },
  ],
  activity: "吃点好吃的",
  place: "",
});
let draft = defaultDraft(),
  step = 0,
  view = "create",
  role = "host",
  currentId = null,
  selectedTime = -1,
  modal = null;
const storageKey = "meet-once-prototype-v1";
const readInvites = () => {
  const rows = JSON.parse(localStorage.getItem(storageKey) || "[]");
  return Array.isArray(rows) ? rows : [];
};
const store = InviteStore({
  read: readInvites,
  write: (rows) => localStorage.setItem(storageKey, JSON.stringify(rows)),
  lock: (fn) =>
    navigator.locks
      ? navigator.locks.request(storageKey, fn)
      : Promise.reject(
          new Error("这个浏览器暂不支持原型的同步保存，请在新版浏览器中打开"),
        ),
});
let invitations = [];
try {
  invitations = store.all();
} catch {}
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey) return;
  try {
    invitations = store.all();
    if (currentId && !current()) {
      currentId = null;
      view = "list";
      modal = null;
    }
    render();
    toast("邀请有更新，已显示最新安排");
  } catch {
    toast("暂时无法读取邀请记录");
  }
});
const current = () => invitations.find((x) => x.id === currentId);
const statusNames = {
  waiting: "等对方回应",
  host_review: "等发起人确认",
  guest_review: "等接收者确认",
  details: "还差一个见面地点",
  confirmed: "已经约好啦",
  declined: "这次先不了",
};
const statusBadge = (x) =>
  `<span class="status-label ${InviteModel.status(x)}">${InviteModel.status(x) === "confirmed" ? "●" : "○"} ${statusNames[InviteModel.status(x)]}</span>`;
function mascot() {
  return window.MASCOT_DATA
    ? `<div class="mascot"><img src="${window.MASCOT_DATA}" alt="抱着爱心信封、害羞期待的小海豹"></div>`
    : '<div class="mascot"><span class="mascot-fallback">♡</span></div>';
}
function planRows(d, p) {
  const slots = p ? [p] : d.mode === "fixed" ? [d.options[0]] : d.options;
  return `<div class="plan-strip"><div>${icon("calendar", 15)}<span>${slots.map((s) => `${fmt(s.date)} ${esc(s.time)}`).join("<br>")}</span></div><div>${icon(activities.find((a) => a[0] === (p?.activity || d.activity))?.[1] || "heart", 15)}<span>${esc(p?.activity || d.activity)}</span></div><div>${icon("pin", 15)}<span>${esc(p?.place || d.place || "地点想和你一起选")}</span></div></div>`;
}
function invitationCard(d, interactive = false) {
  return `<article class="invitation-card"><div class="card-top"><span>A LITTLE INVITATION</span><span class="mini-heart">♡</span></div>${mascot()}<div class="to-name">给 ${esc(d.to || "那个想见的人")}</div><h2>可以和我<br>一起约会吗？</h2><p class="personal-message">${esc(d.message)}</p>${planRows(d)}${interactive ? guestActions(d) : `<div class="btn primary wide card-action" aria-hidden="true">好呀，我愿意 ${icon("heart", 16)}</div><div class="card-footer">一份藏不住的小心意，等你来拆开</div>`}<div class="card-sign">装作不在意，其实很期待。<br><b>— ${esc(d.from || "你的名字")}</b></div></article>`;
}
function guestActions(x) {
  const s = InviteModel.status(x);
  if (s !== "waiting")
    return `<button class="btn primary wide" data-action="guest-result">查看我们的安排 ${icon("arrow")}</button>`;
  return `${x.mode === "flexible" ? `<p class="hint">选一个方便的时间，也可以提个新的。</p>${x.options.map((t, i) => `<button class="choice-time ${selectedTime === i ? "selected" : ""}" data-action="select-time" data-index="${i}" aria-pressed="${selectedTime === i}">${fmt(t.date)} ${esc(t.time)} <span>${selectedTime === i ? "●" : "○"}</span></button>`).join("")}` : ""}<div class="response-actions"><button class="btn primary wide" data-action="accept" ${x.mode === "flexible" && selectedTime < 0 ? "disabled" : ""}>好呀，我愿意 ${icon("heart", 16)}</button><button class="btn wide" data-action="change">想去，换个安排</button></div>`;
}
function render() {
  cleanupRunaway();
  cleanupRunaway = () => {};
  if (
    view === "guest" &&
    current() &&
    InviteModel.status(current()) !== "waiting"
  ) {
    view = "result";
    guestJourney = null;
  }
  document.body.dataset.view = view;
  document.title = "见一面 · 暧昧期邀约原型";
  $("#root").innerHTML =
    `<div class="demo-bar">交互原型 · 可切换双方视角体验 <span>／ 数据只保存在此浏览器，尚未连接真实分享与通知</span></div><header class="site-header"><button class="brand" data-action="home" aria-label="见一面首页"><span class="brand-mark">${icon("heart", 21)}</span>见一面</button><nav class="nav" aria-label="主导航"><button class="scene-demo-link" data-action="demo-journey">体验收邀</button><button class="${view === "create" || view === "ready" ? "active" : ""}" data-action="home">制作邀请</button><button class="${view === "list" || view === "host" ? "active" : ""}" data-action="list">我的邀请${invitations.length ? ` · ${invitations.length}` : ""}</button></nav></header><main>${view === "create" ? editor() : view === "ready" ? readyView() : view === "list" ? listView() : view === "host" ? hostView() : guestView()}</main><footer class="footer"><span>见一面 · 先从一次小小的邀请开始</span><span>认真邀请，轻松回应。</span></footer><div id="modal-root"></div><div id="toast-root" role="status" aria-live="polite"></div>`;
  bind();
  if (modal) renderModal();
}
function editor() {
  return `<div class="workbench"><section class="editor"><p class="eyebrow">FOR SOMEONE SPECIAL</p><h1>有点想见你。<br>那就，认真约一次。</h1><p class="sub" style="margin-top:10px">把没说出口的话，变成一份小邀请。</p><div class="steps">${["写点心里话", "安排见面", "检查邀请"].map((s, i) => `${i ? '<span class="step-line"></span>' : ""}<div class="step ${step === i ? "active" : step > i ? "done" : ""}"><i>${step > i ? "✓" : i + 1}</i>${s}</div>`).join("")}</div><div class="form-section">${step === 0 ? firstStep() : step === 1 ? secondStep() : thirdStep()}</div></section><aside class="preview-column" aria-label="邀请实时预览"><div class="preview-label"><span>对方会收到这样一份邀请</span><span class="live-label">实时预览</span></div><div class="stage" id="live-preview">${invitationCard(draft)}</div><p class="preview-note">只要真诚一点，就已经很可爱了。</p></aside></div>`;
}
function firstStep() {
  return `<div class="columns"><div class="field"><label class="label" for="from">你的昵称</label><input id="from" data-field="from" maxlength="16" value="${esc(draft.from)}" placeholder="对方怎么称呼你"></div><div class="field"><label class="label" for="to">想邀请谁</label><input id="to" data-field="to" maxlength="16" value="${esc(draft.to)}" placeholder="TA 的昵称"></div></div><div class="field"><div class="label">选一种开场语气 <small>文案可以自己改</small></div><div class="tone-group">${tones.map((t) => `<button class="tone ${draft.tone === t[0] ? "selected" : ""}" data-action="tone" data-tone="${t[0]}" aria-pressed="${draft.tone === t[0]}">${t[1]}</button>`).join("")}</div></div><div class="field"><label class="label" for="message">想对 TA 说的话 <small id="word-count">${draft.message.length}/120</small></label><textarea id="message" data-field="message" maxlength="120">${esc(draft.message)}</textarea><p class="hint">上面是示例昵称和文案，改成你们之间的表达就好。</p></div><div id="form-error" class="error" role="alert"></div><div class="actions"><button class="btn primary" data-action="next">下一步，安排见面 ${icon("arrow")}</button></div>`;
}
function secondStep() {
  return `<div class="field"><div class="label">时间，怎么安排？</div><div class="mode-grid"><button class="mode-choice ${draft.mode === "fixed" ? "selected" : ""}" data-action="mode" data-mode="fixed" aria-pressed="${draft.mode === "fixed"}"><strong>我有一个小计划</strong><span>定好时间，邀请 TA 加入</span></button><button class="mode-choice ${draft.mode === "flexible" ? "selected" : ""}" data-action="mode" data-mode="flexible" aria-pressed="${draft.mode === "flexible"}"><strong>留一点选择给 TA</strong><span>给两个时间，一起决定</span></button></div>${draft.options
    .slice(0, draft.mode === "fixed" ? 1 : 2)
    .map(
      (s, i) =>
        `<div class="slot-editor"><div><label class="label" for="date-${i}">${draft.mode === "flexible" ? `候选 ${i + 1}` : "见面日期"}</label><input id="date-${i}" type="date" min="${dateString(new Date())}" data-slot="${i}" data-part="date" value="${s.date}"></div><div><label class="label" for="time-${i}">见面时间</label><input id="time-${i}" type="time" data-slot="${i}" data-part="time" value="${s.time}"></div></div>`,
    )
    .join(
      "",
    )}</div><div class="field"><div class="label">想一起做什么？</div><div class="choice-grid">${activities.map((a) => `<button class="choice ${draft.activity === a[0] ? "selected" : ""}" data-action="activity" data-activity="${a[0]}" aria-pressed="${draft.activity === a[0]}">${icon(a[1])}${a[0]}<span class="radio"></span></button>`).join("")}</div></div><div class="field"><label class="label" for="place">在哪里见 <small>可以稍后一起选</small></label><input id="place" data-field="place" value="${esc(draft.place)}" maxlength="60" placeholder="例如：某家咖啡店门口，补上地址更好"><p class="hint">地点暂空也能发出邀请，确定后再正式约好。</p></div><div id="form-error" class="error" role="alert"></div><div class="actions"><button class="text-btn" data-action="prev">上一步</button><button class="btn primary" data-action="next">看看这份邀请 ${icon("arrow")}</button></div>`;
}
function thirdStep() {
  return `<h2>这一份，只想发给 ${esc(draft.to)}。</h2><p class="sub">确认一下安排，就可以准备送出啦。</p><div class="summary-lines"><div class="summary-line"><span>邀请对象</span><b>${esc(draft.from)} → ${esc(draft.to)}</b></div><div class="summary-line"><span>见面时间</span><span>${draft.options
    .slice(0, draft.mode === "fixed" ? 1 : 2)
    .map((s) => `${fmt(s.date)} ${esc(s.time)}`)
    .join(
      "<br>",
    )}</span></div><div class="summary-line"><span>一起做</span><span>${esc(draft.activity)}<small class="hint" style="display:block">TA 接受邀请后，还可以选择氛围和具体偏好。</small></span></div><div class="summary-line"><span>见面地点</span><span>${esc(draft.place || "留给我们一起选")}</span></div></div><div class="note-box">${draft.mode === "fixed" && draft.place ? "TA 会先回应邀请，再逐步选择见面时间、氛围和具体偏好，最后交给你确认。" : "TA 愿意后，还会一起确认" + (!draft.place ? "地点" : "最后的时间") + "，再生成正式约定。"}</div><div class="actions"><button class="text-btn" data-action="prev">回去改改</button><button class="btn primary" data-action="create">生成这份邀请 ${icon("heart")}</button></div>`;
}
function readyView() {
  const x = current();
  return `<div class="workbench"><section class="editor"><div class="success-check">${icon("check", 25)}</div><p class="eyebrow">READY TO MAKE A LITTLE MOVE</p><h1>心意准备好了。<br>剩下的，交给勇气。</h1><p class="sub" style="margin-top:17px">给 ${esc(x.to)} 的邀请已保存在「我的邀请」。</p><div class="actions"><button class="btn primary" data-action="guest">体验对方收到邀请 ${icon("arrow")}</button></div><div class="actions"><button class="btn" data-action="copy">${icon("copy")}复制邀请文字</button><button class="text-btn" data-action="host">查看邀请</button></div><div class="note-box" style="margin-top:35px">当前是原型演示：可以切换双方身份走完整流程。真实链接分享、跨设备回复和消息通知尚未接入。</div></section><aside class="preview-column"><div class="stage">${invitationCard(x)}</div></aside></div>`;
}
function switchHeader() {
  return `<div class="view-header"><button class="text-btn" data-action="list">${icon("back", 15)} 我的邀请</button><div class="role-switch" aria-label="原型体验身份"><button data-action="host" class="${role === "host" ? "selected" : ""}">我是发起人</button><button data-action="guest" class="${role === "guest" ? "selected" : ""}">我是接收者</button></div></div>`;
}
function guestView() {
  const x = current();
  if (!x) return listView();
  return view === "guest"
    ? journeyView(x)
    : `${switchHeader()}<div class="recipient-area">${resultCard(x, true)}</div>`;
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
    confirmed: "这一次的时间和地点，我们都确认好了。",
    details: "还差一个见面地点，一起补上吧。",
    host_review:
      role === "host"
        ? "TA 提出了这个安排，合适就确认一下。"
        : "你选好的安排，等对方确认就约好啦。",
    guest_review: "看看新的时间和地点，合适就约好啦。",
    declined: "这次邀请就到这里。愿我们都轻松一点。",
    waiting: "不着急，给对方一点时间。",
  };
  return `<article class="invitation-card result-card"><div class="card-top"><span>OUR LITTLE PROMISE</span><span class="mini-heart">♡</span></div>${mascot()}${statusBadge(x)}<h2 class="result-title">${titles[s]}</h2><p class="result-note">${notes[s]}</p>${s !== "declined" ? (p ? ticket(x) : planRows(x)) : ""}${buttons ? resultActions(x) : ""}<div class="ticket-note">${esc(x.from)} & ${esc(x.to)}<br>见面这件小事，我们认真一点。</div></article>`;
}
function ticket(x) {
  const p = x.proposal;
  return `<div class="ticket"><div class="ticket-top"><div><small>DATE</small><strong>${fmt(p.date, false)}</strong><div class="hint">${fmt(p.date).split(" · ")[1]}</div></div><div><small>TIME</small><strong>${esc(p.time)}</strong></div></div><div class="ticket-detail"><small>TOGETHER</small><b>${esc(p.activity)}</b></div><div class="ticket-detail"><small>MEET HERE</small><b data-plan-place>${esc(p.place || "还需要一起确认地点")}</b></div>${preferenceRows(p)}</div>`;
}
function resultActions(x) {
  const s = InviteModel.status(x);
  if (s === "declined")
    return `<div class="response-actions"><button class="btn wide" data-action="home">我也想制作一份邀请 ${icon("heart")}</button></div>`;
  const canConfirm =
    (role === "host" && s === "host_review") ||
    (role === "guest" && s === "guest_review");
  return `<div class="response-actions">${canConfirm ? '<button class="btn primary wide" data-action="confirm">这个安排可以，确认 ' + icon("check") + "</button>" : ""}${s === "details" ? '<button class="btn primary wide" data-action="change">一起把地点定下来 ' + icon("pin") + "</button>" : ""}${s === "confirmed" ? '<button class="btn primary wide" data-action="save-card">保存约定卡 ' + icon("download") + "</button>" : ["host_review", "guest_review", "details"].includes(s) ? '<button class="btn wide" data-action="save-card">保存这份小心意 ' + icon("download") + "</button>" : ""}${!["waiting", "details"].includes(s) ? '<button class="text-btn" data-action="change">' + (s === "confirmed" ? "需要改期或换个地点" : "想换个安排") + "</button>" : ""}</div>`;
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
  return `${switchHeader()}<div class="host-layout"><section class="host-copy">${statusBadge(x)}<h1>${titles[s]}</h1><p class="sub">${s === "waiting" ? "邀请发出以后，也给对方轻松回答的空间。" : s === "confirmed" ? "时间、地点和心意，都在这张小约定里。" : s === "declined" ? "回应已经保存。感谢对方的坦诚，也照顾好自己的心情。" : "双方确认同一个安排，才会生成正式约定。"}</p>${x.proposal && s !== "declined" ? `<div class="summary-lines"><div class="summary-line"><span>时间</span><span>${fmt(x.proposal.date)} ${esc(x.proposal.time)}</span></div><div class="summary-line"><span>活动</span><span>${esc(x.proposal.activity)}</span></div><div class="summary-line"><span>地点</span><span>${esc(x.proposal.place || "待一起确定")}</span></div>${x.proposal.preferences?.detail ? `<div class="summary-line"><span>具体偏好</span><span>${esc(x.proposal.preferences.detail)}</span></div>` : ""}${x.proposal.preferences?.hints?.length ? `<div class="summary-line"><span>小暗示</span><span>${x.proposal.preferences.hints.map(esc).join(" · ")}</span></div>` : ""}</div>` : ""}${resultActions(x)}${s === "waiting" ? '<div class="actions"><button class="btn primary" data-action="guest">体验接收方回应 ' + icon("arrow") + '</button></div><div class="actions"><button class="btn" data-action="copy">复制邀请文字 ' + icon("copy") + "</button></div>" : ""}<div class="note-box">原型中的两个身份共用当前浏览器里的记录。切换上方身份，可以体验对方看到的状态。</div></section>${resultCard(x)}</div>`;
}
function listView() {
  return `<section class="list-wrap"><div class="list-head"><div><p class="eyebrow">MY LITTLE INVITATIONS</p><h1>我的邀请</h1></div><button class="btn primary" data-action="new">＋ 再写一份</button></div>${
    invitations.length
      ? `<div class="invite-list">${invitations
          .slice()
          .reverse()
          .map(
            (x) =>
              `<button class="invite-row" data-action="open" data-id="${esc(x.id)}"><div><h3>给 ${esc(x.to)} 的小邀请</h3><p>${esc(x.proposal?.activity || x.activity)} · ${fmt(x.proposal?.date || x.options[0].date)}</p></div><div style="text-align:right">${statusBadge(x)}<div>${icon("arrow", 18)}</div></div></button>`,
          )
          .join(
            "",
          )}</div><p class="hint" style="margin-top:18px">这里只保存在此浏览器中创建的原型记录。</p>`
      : '<div class="empty"><h2>第一份心意，还等你落笔。</h2><p class="sub">有个想见的人，就从这里开始。</p><button class="btn primary" data-action="new">写一份小邀请 ' +
        icon("heart") +
        "</button></div>"
  }</section>`;
}
function bind() {
  if (view === "guest") bindJourneyInputs();
  document
    .querySelectorAll("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => action(el.dataset.action, el)),
    );
  document.querySelectorAll("[data-field]").forEach((el) =>
    el.addEventListener("input", () => {
      draft[el.dataset.field] = el.value;
      updatePreview();
      if ($("#word-count"))
        $("#word-count").textContent = draft.message.length + "/120";
    }),
  );
  document.querySelectorAll("[data-slot]").forEach((el) =>
    el.addEventListener("input", () => {
      draft.options[Number(el.dataset.slot)][el.dataset.part] = el.value;
      updatePreview();
    }),
  );
}
function updatePreview() {
  const p = $("#live-preview");
  if (p) p.innerHTML = invitationCard(draft);
}
function validateStep() {
  if (step === 0) {
    if (!draft.from.trim() || !draft.to.trim())
      return "先填一下你和 TA 的昵称吧。";
    if (!draft.message.trim()) return "写一句想对 TA 说的话吧。";
  }
  if (step === 1) {
    const slots = draft.options.slice(0, draft.mode === "fixed" ? 1 : 2);
    for (const s of slots) {
      if (!s.date || !s.time) return "请填完整日期和时间。";
      if (new Date(`${s.date}T${s.time}`) <= new Date())
        return "选一个还没到来的时间吧。";
    }
    if (
      slots.length === 2 &&
      slots[0].date === slots[1].date &&
      slots[0].time === slots[1].time
    )
      return "给 TA 两个不同的时间吧。";
  }
  return "";
}
async function updateRecord(event) {
  const x = current();
  const expectedVersion = event.version ?? x.version;
  try {
    const next = await store.transition(x.id, {
      ...event,
      version: expectedVersion,
      role: event.role ?? role,
    });
    invitations = store.all();
    return next;
  } catch (error) {
    invitations = store.all();
    modal = null;
    render();
    throw error;
  }
}
async function action(a, el) {
  try {
    if (a.startsWith("journey-")) {
      await journeyAction(a, el);
      return;
    }
    if (a === "demo-journey") {
      const sample = {
        ...defaultDraft(),
        from: "小宇",
        to: "你",
        mode: "flexible",
        isDemo: true,
      };
      const x =
        invitations.find(
          (i) =>
            i.isDemo &&
            InviteModel.status(i) === "waiting" &&
            new Date(`${i.options[0].date}T${i.options[0].time}`) > new Date(),
        ) || (await store.create(sample));
      invitations = store.all();
      currentId = x.id;
      role = "guest";
      guestJourney = null;
      view = "guest";
    } else if (a === "home") {
      view = "create";
      role = "host";
    } else if (a === "new") {
      draft = defaultDraft();
      step = 0;
      view = "create";
      role = "host";
    } else if (a === "list") {
      view = "list";
      role = "host";
    } else if (a === "next") {
      const error = validateStep();
      if (error) {
        $("#form-error").textContent = error;
        return;
      }
      step++;
    } else if (a === "prev") step--;
    else if (a === "tone") {
      draft.tone = el.dataset.tone;
      draft.message = tones.find((t) => t[0] === draft.tone)[2];
    } else if (a === "mode") draft.mode = el.dataset.mode;
    else if (a === "activity") draft.activity = el.dataset.activity;
    else if (a === "create") {
      draft.from = draft.from.trim();
      draft.to = draft.to.trim();
      draft.place = draft.place.trim();
      const x = await store.create({
        ...draft,
        options: draft.options.slice(0, draft.mode === "fixed" ? 1 : 2),
      });
      invitations = store.all();
      currentId = x.id;
      view = "ready";
      celebrate();
    } else if (a === "open") {
      currentId = el.dataset.id;
      role = "host";
      view = "host";
    } else if (a === "host") {
      role = "host";
      view = "host";
    } else if (a === "guest") {
      role = "guest";
      view = InviteModel.status(current()) === "waiting" ? "guest" : "result";
      selectedTime = -1;
    } else if (a === "guest-result") view = "result";
    else if (a === "select-time") selectedTime = Number(el.dataset.index);
    else if (a === "accept") {
      const x = current();
      if (x.mode === "flexible") {
        if (selectedTime < 0) return;
        await updateRecord({
          type: "propose",
          role: "guest",
          proposal: {
            ...x.options[selectedTime],
            place: x.place,
            activity: x.activity,
          },
        });
      } else await updateRecord({ type: "confirm", role: "guest" });
      view = "result";
      celebrate();
    } else if (a === "confirm") {
      await updateRecord({ type: "confirm" });
      celebrate();
    } else if (a === "change") {
      modal = { type: "proposal", version: current().version };
      renderModal();
      return;
    } else if (a === "close-modal") {
      closeModal();
      return;
    } else if (a === "submit-proposal") {
      const date = $("#proposal-date").value,
        time = $("#proposal-time").value,
        place = $("#proposal-place").value.trim();
      if (!date || !time || new Date(`${date}T${time}`) <= new Date()) {
        $("#proposal-error").textContent = "请选一个完整、还没到来的时间。";
        return;
      }
      await updateRecord({
        type: "propose",
        version: modal.version,
        proposal: { date, time, place },
      });
      closeModal();
      view = role === "host" ? "host" : "result";
    } else if (a === "copy") {
      await copyText();
      return;
    } else if (a === "save-card") {
      await saveCard();
      return;
    }
    render();
    if (!["tone", "mode", "activity", "select-time"].includes(a))
      window.scrollTo({ top: 0, behavior: "instant" });
  } catch (e) {
    toast(e.message);
  }
}
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
  if (modal.type === "card") {
    $("#modal-root").innerHTML =
      `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">把小约定收好。</h2><button class="close" data-action="close-modal" aria-label="关闭">×</button></div><p>长按图片保存，也可以下载到相册或文件。</p><img src="${modal.data}" alt="生成的约定卡图片" style="display:block;width:100%;height:auto;border-radius:9px;margin-bottom:18px"><a class="btn primary wide" href="${modal.data}" download="我们的小约定.png" style="text-decoration:none">下载约定卡 ${icon("download")}</a></section></div>`;
    $("#modal-root")
      .querySelector("[data-action]")
      .addEventListener("click", closeModal);
    $("#modal-root").querySelector("button").focus();
    return;
  }
  const p = x.proposal || { ...x.options[0], place: x.place };
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">换个舒服的安排。</h2><button class="close" data-action="close-modal" aria-label="关闭">×</button></div><p>${InviteModel.status(x) === "confirmed" ? "提交新安排后，需要对方重新确认；原来的确认不会沿用。" : "把你方便的时间和地点告诉对方，等 TA 确认。"}</p><div class="columns"><div class="field"><label class="label" for="proposal-date">日期</label><input id="proposal-date" type="date" min="${dateString(new Date())}" value="${esc(p.date)}"></div><div class="field"><label class="label" for="proposal-time">时间</label><input id="proposal-time" type="time" value="${esc(p.time)}"></div></div><div class="field"><label class="label" for="proposal-place">见面地点</label><input id="proposal-place" maxlength="60" placeholder="具体在哪里碰面？" value="${esc(p.place)}"><p class="hint">地点确定后，双方再正式确认约定。</p></div><div class="error" id="proposal-error" role="alert"></div><button class="btn primary wide" data-action="submit-proposal">提议这个安排 ${icon("arrow")}</button></section></div>`;
  $("#modal-root")
    .querySelectorAll("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => action(el.dataset.action, el)),
    );
  $("#modal-root").querySelector("input,button")?.focus();
}
function closeModal() {
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
async function copyText() {
  const x = current();
  const p = x.proposal;
  const dates = (p ? [p] : x.options)
    .map((s) => `${fmt(s.date)} ${s.time}`)
    .join(" 或 ");
  const text = `${x.to}，可以和我一起约会吗？\n\n${x.message}\n\n${dates}\n${p?.activity || x.activity}${p?.preferences?.detail ? " · " + p.preferences.detail : ""}\n${p?.place || x.place || "地点一起选"}${p?.preferences?.hints?.length ? "\n小暗示：" + p.preferences.hints.join(" · ") : ""}\n\n——${x.from}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("邀请文字已复制，可以自行发给对方");
  } catch {
    toast("当前浏览器无法直接复制，请在邀请卡中选取文字");
  }
}
async function saveCard() {
  const x = current(),
    s = InviteModel.status(x),
    p = x.proposal;
  if (!p || s === "declined") {
    toast("先一起选好一个安排，再生成小约定");
    return;
  }
  const c = document.createElement("canvas"),
    q = c.getContext("2d");
  c.width = 900;
  function wrap(value, font, width = 650) {
    q.font = font;
    let lines = [""];
    for (const ch of Array.from(value)) {
      const last = lines.length - 1;
      if (q.measureText(lines[last] + ch).width > width) lines.push(ch);
      else lines[last] += ch;
    }
    return lines;
  }
  const rows = [
    ["WHEN", `${fmt(p.date)}  ${p.time}`],
    ["TOGETHER", p.activity],
    ...(p.preferences?.detail
      ? [
          [
            p.activity === "吃点好吃的" ? "MENU" : "PREFERENCE",
            p.preferences.detail,
          ],
        ]
      : []),
    ["MEET HERE", p.place || "地点，我们再一起选"],
    ...(p.preferences?.hints?.length
      ? [["小暗示", p.preferences.hints.join(" · ")]]
      : []),
  ].map(([label, value]) => ({ label, lines: wrap(value, "28px sans-serif") }));
  const names = wrap(`${x.from}  &  ${x.to}`, "25px sans-serif");
  c.height =
    610 +
    rows.reduce((sum, row) => sum + 66 + row.lines.length * 39, 0) +
    170 +
    names.length * 34;
  const height = c.height;
  q.fillStyle = "#f9f0ee";
  q.fillRect(0, 0, 900, height);
  q.fillStyle = "#302b2c";
  q.beginPath();
  q.roundRect(69, 66, 772, height - 110, 28);
  q.fill();
  q.fillStyle = "#fffdfa";
  q.strokeStyle = "#302b2c";
  q.lineWidth = 4;
  q.beginPath();
  q.roundRect(55, 52, 772, height - 110, 28);
  q.fill();
  q.stroke();
  q.textAlign = "center";
  q.fillStyle = "#846974";
  q.font = "21px sans-serif";
  q.fillText("见一面  /  OUR LITTLE PROMISE", 450, 118);
  if (window.MASCOT_DATA) {
    const image = new Image();
    image.src = window.MASCOT_DATA;
    await image.decode();
    q.drawImage(image, 315, 143, 270, 270);
  }
  q.fillStyle = "#302b2c";
  q.font = "bold 44px sans-serif";
  q.fillText(
    s === "confirmed" ? "那就说好啦，到时候见。" : "一份想和你一起的小约定。",
    450,
    467,
  );
  q.fillStyle = s === "confirmed" ? "#52775d" : "#a55279";
  q.font = "24px sans-serif";
  q.fillText(s === "confirmed" ? "双方已确认" : statusNames[s], 450, 515);
  q.textAlign = "left";
  let y = 593;
  for (const row of rows) {
    q.fillStyle = "#947b86";
    q.font = "18px sans-serif";
    q.fillText(row.label, 125, y);
    q.fillStyle = "#302b2c";
    q.font = "28px sans-serif";
    y += 43;
    for (const line of row.lines) {
      q.fillText(line, 125, y);
      y += 39;
    }
    y += 23;
  }
  q.textAlign = "center";
  q.fillStyle = "#846974";
  q.font = "25px sans-serif";
  names.forEach((name, i) => q.fillText(name, 450, y + 28 + i * 34));
  q.font = "20px sans-serif";
  q.fillText("见面这件小事，我们认真一点。", 450, y + 67 + names.length * 34);
  modal = { type: "card", data: c.toDataURL("image/png") };
  renderModal();
}

render();

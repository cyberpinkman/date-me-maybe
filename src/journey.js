/* Receiver-side scene drafts are transient. Only the review screen commits a response. */
let guestJourney = null;
let cleanupRunaway = () => {};
const sceneHints = [
  "有点暧昧",
  "像第一次约会",
  "想多待一会儿",
  "有点小紧张",
  "轻松随意就好",
  "想认真打扮一下",
  "安静一点",
  "小惊喜你来定",
];
const sceneDetails = {
  吃点好吃的: {
    title: "我们吃点什么？",
    note: "想吃什么，今天听你的。",
    cta: "就吃这个",
    items: [
      ["🍣", "日料"],
      ["🥩", "烤肉"],
      ["🥟", "粤菜"],
      ["🍲", "火锅"],
      ["🍢", "烧烤"],
      ["🍝", "西餐"],
      ["🥗", "轻食"],
      ["🍰", "甜品咖啡"],
      ["♡", "你来推荐"],
    ],
  },
  喝杯咖啡: {
    title: "这杯咖啡，怎么喝？",
    note: "找个地方，把聊天的时间拉长一点。",
    cta: "就去这样的地方",
    items: [
      ["☕", "安静的小店"],
      ["🍰", "咖啡加甜品"],
      ["☀", "有阳光的窗边"],
      ["♡", "你来推荐"],
    ],
  },
  散个步: {
    title: "想和你，走哪一段？",
    note: "路线可以短一点，聊天可以久一点。",
    cta: "就这样慢慢走",
    items: [
      ["🌿", "公园慢慢走"],
      ["🌊", "沿着河边走"],
      ["🏙", "逛逛街区"],
      ["♡", "你来选路线"],
    ],
  },
  看场电影: {
    title: "这次，想看哪一种？",
    note: "先选个类型，具体场次我们再商量。",
    cta: "就看这个类型",
    items: [
      ["☺", "轻松喜剧"],
      ["♡", "爱情片"],
      ["🔎", "悬疑片"],
      ["🎬", "你来挑片"],
    ],
  },
  找个地方慢慢聊: {
    title: "找个舒服的地方。",
    note: "没有特别的安排，也可以只是好好聊天。",
    cta: "就在那里慢慢聊",
    items: [
      ["☕", "安静坐坐"],
      ["🌿", "边走边聊"],
      ["📖", "找家书店"],
      ["♡", "你来选"],
    ],
  },
  一起逛个展: {
    title: "想一起看看什么？",
    note: "交换一点好奇心，也多认识你一点。",
    cta: "一起去看看",
    items: [
      ["📷", "摄影展"],
      ["🎨", "艺术展"],
      ["🏛", "博物馆"],
      ["♡", "你来挑一个"],
    ],
  },
};
function startGuestJourney(x) {
  if (
    !guestJourney ||
    guestJourney.id !== x.id ||
    guestJourney.version !== x.version
  ) {
    guestJourney = {
      id: x.id,
      version: x.version,
      scene: "invite",
      time: x.mode === "fixed" && x.options?.[0] ? { ...x.options[0] } : null,
      customTime: !x.options?.length,
      activities: [],
      detailIndex: 0,
      details: {},
      hints: [],
      place: x.place || "",
      teaseCount: 0,
      teasePosition: null,
    };
  }
}
function guestProposal() {
  const g = guestJourney;
  return {
    date: g.time?.date || "",
    time: g.time?.time || "",
    place: g.place.trim(),
    activities: [...g.activities],
    activity: "",
    preferences: {
      hints: [...g.hints],
      details: Object.fromEntries(g.activities.map((activity) => [activity, g.details[activity] || ""])),
    },
  };
}
function preferenceRows(p) {
  const pref = p?.preferences || {};
  return pref.hints?.length ? `<div class="ticket-detail"><small>小暗示</small><div class="hint-tags">${pref.hints.map((h) => `<span>${esc(h)}</span>`).join("")}</div></div>` : "";
}
function sceneTimeFoot() {
  const t = guestJourney.time;
  return t?.date && t?.time
    ? `<p class="scene-time-note">${icon("calendar", 13)} 见面时间：${fmt(t.date)} ${esc(t.time)}</p>`
    : "";
}
function sceneButton(label, action, disabled = false) {
  return `<button class="btn primary wide" data-action="${action}" ${disabled ? "disabled" : ""}>${label} ${icon("arrow", 17)}</button>`;
}
function journeyView(x) {
  startGuestJourney(x);
  const g = guestJourney;
  const order = [
    "invite",
    "surprise",
    "time",
    "hints",
    "activity",
    "detail",
    "review",
  ];
  const index = order.indexOf(g.scene);
  const titles = [
    "一份专属邀请",
    "先偷偷开心一下",
    "挑个见面时间",
    "说点小暗示",
    "想怎么见面",
    "再具体一点",
    "我们的小约定",
  ];
  return `<section class="journey-shell" aria-label="只给你的邀请"><div class="journey-topbar">${index > 0 ? `<button class="journey-back" data-action="journey-back" aria-label="返回上一步">${icon("back", 18)}</button>` : '<span class="journey-back-placeholder" aria-hidden="true">♡</span>'}<span>${titles[index]}</span><span class="scene-count">${String(index + 1).padStart(2, "0")} / 07</span></div><article class="invitation-card scene-card journey-scene-${g.scene}" aria-live="polite">${sceneContent(x, g)}</article><div class="journey-progress" aria-hidden="true">${order.map((_, i) => `<i class="${i <= index ? "filled" : ""}"></i>`).join("")}</div><p class="journey-outside">只属于你们的一份小心意。</p></section>`;
}
function sceneContent(x, g) {
  if (g.scene === "invite")
    return `<div class="card-top"><span>JUST FOR ${esc(x.to).toUpperCase()}</span><span class="mini-heart">♡</span></div>${mascot()}<div class="to-name">${esc(x.from)} 有个问题想问你</div><h2>可以和我<br>一起约会吗？</h2><p class="personal-message">${esc(x.message)}</p><p class="tease-note">装作不在意，其实很期待。</p><div class="invitation-emotions"><button class="btn primary" data-action="journey-yes">愿意 ${icon("heart", 17)}</button><span class="tease-slot" aria-hidden="true"></span><button class="btn tease-button" data-dodges="${g.teaseCount}">${RunawayButton.label(g.teaseCount)}</button></div><p class="card-sign">只发给你的，一份小小的心意。<br>— ${esc(x.from)}</p>`;
  if (g.scene === "surprise")
    return `<div class="card-top"><span>A LITTLE TOO HAPPY</span><span class="mini-heart">♡</span></div><div class="surprise-mascot">${mascot()}<span class="surprise-heart one">♡</span><span class="surprise-heart two">♡</span></div><div class="stamp-note">今天的开心，有点超标</div><h2>等一下，<br>你真的愿意吗？</h2><p class="personal-message">让我先偷偷开心三秒。<br>然后，我们认真安排一下见面。</p><div class="scene-bottom">${sceneButton("好啦，选个时间", "journey-next")}</div>`;
  if (g.scene === "time")
    return `<div class="card-top"><span>MAKE A LITTLE TIME</span><span class="mini-heart">♡</span></div><div class="scene-symbol">${icon("calendar", 32)}</div><h2>所以，什么时候<br>能见到你？</h2><p class="personal-message">${!x.options?.length ? "挑个你方便的时间，想好好见你。" : x.mode === "fixed" ? "这是对方提议的时间，也想听听你的想法。" : "这里有两个小提议，选个你方便的。"}</p><div class="scene-time-options">${(x.options || []).map((t, i) => `<button class="scene-time-option ${!g.customTime && g.time?.date === t.date && g.time?.time === t.time ? "selected" : ""}" data-action="journey-time" data-index="${i}" aria-pressed="${!g.customTime && g.time?.date === t.date && g.time?.time === t.time}"><span><strong>${fmt(t.date, false)}</strong><small>${fmt(t.date).split(" · ")[1]}</small></span><b>${esc(t.time)}</b><span class="radio"></span></button>`).join("")}</div>${x.options?.length ? `<button class="text-btn time-custom-toggle" data-action="journey-custom">${g.customTime ? "正在选择一个新时间" : "我想选另一个时间"}</button>` : ""}${g.customTime ? `<div class="columns scene-custom-time"><div><label for="journey-date" class="label">见面日期</label><input id="journey-date" data-journey-field="date" type="date" min="${dateString(new Date())}" value="${esc(g.time?.date || "")}"></div><div><label for="journey-time" class="label">见面时间</label><input id="journey-time" data-journey-field="time" type="time" value="${esc(g.time?.time || "")}"></div></div>` : ""}<div class="error" id="journey-error" role="alert"></div><div class="scene-bottom">${sceneButton("就这个时间吧", "journey-next", !g.time?.date || !g.time?.time)}</div>`;
  if (g.scene === "hints")
    return `<div class="card-top"><span>A FEW LITTLE HINTS</span><span class="mini-heart">♡</span></div><div class="scene-symbol">${icon("heart", 32)}</div><h2>还有什么，<br>想偷偷暗示我？</h2><p class="personal-message">可以多选，也可以先保密。</p><div class="scene-hints">${sceneHints.map((h, i) => `<button class="hint-choice ${g.hints.includes(h) ? "selected" : ""}" data-action="journey-hint" data-index="${i}" aria-pressed="${g.hints.includes(h)}"><span>${h}</span><span class="hint-check">${g.hints.includes(h) ? "✓" : "+"}</span></button>`).join("")}</div><div class="scene-bottom">${sceneTimeFoot()}${sceneButton(g.hints.length ? "暗示给你了" : "先保密，下一步", "journey-next")}</div>`;
  if (g.scene === "activity")
    return `<div class="card-top"><span>A LITTLE PLAN FOR US</span><span class="mini-heart">♡</span></div><div class="scene-symbol">${icon("heart", 32)}</div><h2>那天，<br>想怎么见面？</h2><p class="personal-message">愿意一起做的，都可以选。<br>这次做哪一个，交给 ${esc(x.from)} 来敲定。</p><div class="scene-activities">${activities.map((a) => `<button class="scene-activity ${g.activities.includes(a[0]) ? "selected" : ""}" data-action="journey-activity" data-activity="${esc(a[0])}" aria-pressed="${g.activities.includes(a[0])}">${icon(a[1], 25)}<span>${a[0]}</span><i class="multi-check" aria-hidden="true">${g.activities.includes(a[0]) ? "✓" : ""}</i></button>`).join("")}</div><div class="scene-bottom">${sceneButton(g.activities.length ? "这些都愿意，再具体一点" : "选点愿意一起做的事", "journey-next", !g.activities.length)}</div>`;
  if (g.scene === "detail") {
    const activity = g.activities[g.detailIndex], config = sceneDetails[activity];
    const last = g.detailIndex === g.activities.length - 1;
    return `<div class="card-top"><span>THE LITTLE DETAILS</span><span class="mini-heart">♡</span></div><div class="scene-symbol">${icon(activities.find((a) => a[0] === activity)?.[1] || "heart", 32)}</div><h2>${config.title}</h2><p class="personal-message">${config.note}<br>还没想好，也可以交给对方。</p>${g.activities.length > 1 ? `<div class="detail-tabs" aria-label="每个小安排的偏好">${g.activities.map((item, index) => `<button class="detail-tab ${index === g.detailIndex ? "selected" : ""}" data-action="journey-detail-tab" data-index="${index}" aria-pressed="${index === g.detailIndex}">${esc(item)}${g.details[item] ? " ✓" : ""}</button>`).join("")}</div>` : ""}<div class="scene-details ${config.items.length === 9 ? "nine" : "four"}">${config.items.map((item, i) => `<button class="detail-choice ${g.details[activity] === item[1] ? "selected" : ""}" data-action="journey-detail" data-index="${i}" aria-pressed="${g.details[activity] === item[1]}"><span class="detail-emoji" aria-hidden="true">${item[0]}</span><span>${item[1]}</span><i class="radio"></i></button>`).join("")}</div><div class="scene-bottom">${sceneButton(last ? (g.details[activity] ? "把小心思放在一起" : "这个听你的，看看小安排") : (g.details[activity] ? "收好，再看下一个" : "这个听你的，再看下一个"), "journey-next")}</div>`;
  }
  const proposal = guestProposal();
  return `<div class="card-top"><span>OUR LITTLE PROMISE</span><span class="mini-heart">♡</span></div><div class="mini-mascot">${mascot()}</div><h2>我的小心思，<br>都告诉你啦。</h2><p class="personal-message">时间和愿意一起做的事，都放在这里了。</p><div class="journey-place-field"><label class="label" for="journey-place">想在哪里碰面？</label><input id="journey-place" data-journey-field="place" maxlength="60" value="${esc(g.place)}" placeholder="店名、地址或好找的集合点"><p class="hint">留个好找的地方，让这次见面更近一点。</p></div><div class="journey-ticket">${ticket({ ...x, proposal })}</div><p class="scene-submit-note">这些都是我愿意的，这次一起做什么，等 ${esc(x.from)} 来敲定。</p><div class="error" id="journey-error" role="alert"></div><div class="scene-bottom">${sceneButton("把小心思交给你", "journey-submit", !proposal.place)}</div>`;
}

function bindJourneyInputs() {
  document.querySelectorAll("[data-journey-field]").forEach((el) =>
    el.addEventListener("input", () => {
      if (el.dataset.journeyField === "place") {
        guestJourney.place = el.value;
        const placeValue = $(".journey-ticket [data-plan-place]");
        if (placeValue)
          placeValue.textContent = el.value.trim() || "还需要填写见面地点";
        const submit = document.querySelector('[data-action="journey-submit"]');
        if (submit) submit.disabled = !el.value.trim();
      } else {
        guestJourney.time ??= { date: "", time: "" };
        guestJourney.time[el.dataset.journeyField] = el.value;
        const next = document.querySelector('[data-action="journey-next"]');
        if (next)
          next.disabled = !guestJourney.time.date || !guestJourney.time.time;
      }
    }),
  );
  const area = document.querySelector(".invitation-emotions");
  if (area) cleanupRunaway = RunawayButton.bind(area, guestJourney);
}
async function journeyAction(a, el) {
  const x = current();
  startGuestJourney(x);
  const g = guestJourney;
  const order = [
    "invite",
    "surprise",
    "time",
    "hints",
    "activity",
    "detail",
    "review",
  ];
  if (a === "journey-yes") {
    g.scene = "surprise";
    celebrate();
  } else if (a === "journey-back") {
    if (g.scene === "detail" && g.detailIndex > 0) g.detailIndex--;
    else {
      if (g.scene === "review") g.detailIndex = g.activities.length - 1;
      g.scene = order[Math.max(0, order.indexOf(g.scene) - 1)];
    }
  } else if (a === "journey-next") {
    if (
      g.scene === "time" &&
      (!g.time?.date ||
        !g.time?.time ||
        new Date(`${g.time.date}T${g.time.time}`) <= new Date())
    ) {
      $("#journey-error").textContent = "选一个还没到来的时间吧。";
      return;
    }
    if (g.scene === "activity") {
      if (!g.activities.length) return;
      g.detailIndex = 0;
    }
    if (g.scene === "detail" && g.detailIndex < g.activities.length - 1) g.detailIndex++;
    else g.scene = order[Math.min(order.length - 1, order.indexOf(g.scene) + 1)];
  } else if (a === "journey-time") {
    g.time = { ...x.options[Number(el.dataset.index)] };
    g.customTime = false;
  } else if (a === "journey-custom") {
    g.customTime = true;
    g.time ??= { date: future(3), time: "18:30" };
  } else if (a === "journey-hint") {
    const h = sceneHints[Number(el.dataset.index)];
    g.hints = g.hints.includes(h)
      ? g.hints.filter((v) => v !== h)
      : [...g.hints, h];
  } else if (a === "journey-activity") {
    const activity = el.dataset.activity;
    if (!sceneDetails[activity]) return;
    g.activities = g.activities.includes(activity)
      ? g.activities.filter((item) => item !== activity)
      : [...g.activities, activity];
  } else if (a === "journey-detail") {
    const activity = g.activities[g.detailIndex];
    const detail = sceneDetails[activity].items[Number(el.dataset.index)][1];
    g.details[activity] = g.details[activity] === detail ? "" : detail;
  } else if (a === "journey-detail-tab") {
    const index = Number(el.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < g.activities.length) g.detailIndex = index;
  } else if (a === "journey-submit") {
    if (g.scene !== "review") return;
    const proposal = guestProposal();
    if (!proposal.date || !proposal.time || new Date(`${proposal.date}T${proposal.time}`) <= new Date()) {
      $("#journey-error").textContent = "时间也要一起选好，回去挑个还没到来的时间吧。";
      return;
    }
    if (!proposal.activities.length || !proposal.place) {
      $("#journey-error").textContent = !proposal.place ? "还差一个见面地点，写下在哪里碰面吧。" : "选一点愿意一起做的事，再把心意交给对方吧。";
      return;
    }
    el.disabled = true;
    await updateRecord({
      type: "respond",
      version: g.version,
      proposal,
    });
    guestJourney = null;
    view = "result";
    celebrate();
  }
  render();
  if (
    ![
      "journey-hint",
      "journey-activity",
      "journey-detail",
      "journey-time",
      "journey-custom",
      "journey-detail-tab",
    ].includes(a)
  )
    window.scrollTo({ top: 0, behavior: "instant" });
}

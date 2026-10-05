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
    title: "想和你，去哪儿走走？",
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
    title: "这次，想看点什么？",
    note: "把想看的类型先记下，具体场次我们再商量。",
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
const hostChoosesForGuest = (x) => x.mode === "host" && InviteModel.isFullRange(x.proposal);
function startGuestJourney(x) {
  if (guestJourney && guestJourney.id === x.id && guestJourney.version === x.version) return;
  const hostPlan=hostChoosesForGuest(x), p=x.proposal;
  const plan=hostPlan?JSON.parse(JSON.stringify(p)):emptyPlan();
  if(!hostPlan) {
    if(x.options?.length) plan.timeOptions=x.options.slice(0,3).map(({date,time})=>({date,time}));
    if(x.place) plan.placeOptions=[x.place];
  }
  guestJourney={id:x.id,version:x.version,scene:"invite",plan,detailIndex:0,
    choice:hostPlan?{date:p.date||"",time:p.time||"",place:p.place||"",activity:p.activity||"",detail:p.preferences?.detail||""}:{},
    teaseCount:0,teasePosition:null};
}
function guestProposal() { return cleanPlan(guestJourney.plan); }
function guestDisplayProposal(x) {
  const g=guestJourney;
  return hostChoosesForGuest(x)?{...g.plan,...selectionPayload(g.choice),preferences:{...g.plan.preferences,detail:g.choice.detail||""}}:{...guestProposal(),date:"",time:"",place:"",activity:""};
}
function preferenceRows(p) {
  return p?.preferences?.hints?.length?`<div class="ticket-detail"><small>小暗示</small><div class="hint-tags">${p.preferences.hints.map(h=>`<span>${esc(h)}</span>`).join("")}</div></div>`:"";
}
function sceneTimeFoot() {
  const g=guestJourney;
  return `<p class="scene-time-note">${icon("calendar",13)} ${esc(g.choice.date?timeLabel(g.choice):g.plan.timeOptions.filter(s=>s.date&&s.time).map(timeLabel).join(" / "))}</p>`;
}
function sceneButton(label,action,disabled=false) {return `<button class="btn primary wide" data-action="${action}" ${disabled?"disabled":""}>${label} ${icon("arrow",17)}</button>`;}
const journeyScenes=["invite","surprise","time","hints","activity","detail","review"];
function journeyView(x) {
  startGuestJourney(x);
  const g=guestJourney,index=journeyScenes.indexOf(g.scene),titles=["一份专属邀请","先偷偷开心一下","挑个见面时间","说点小暗示","想怎么见面","再具体一点","我们的小约定"];
  return `<section class="journey-shell" aria-label="只给你的邀请"><div class="journey-topbar">${index>0?`<button class="journey-back" data-action="journey-back" aria-label="返回上一步">${icon("back",18)}</button>`:'<span class="journey-back-placeholder" aria-hidden="true">♡</span>'}<span>${titles[index]}</span><span class="scene-count">${String(index+1).padStart(2,"0")} / 07</span></div><article class="invitation-card scene-card journey-scene-${g.scene}" aria-live="polite">${sceneContent(x,g)}</article><div class="journey-progress" aria-hidden="true">${journeyScenes.map((_,i)=>`<i class="${i<=index?"filled":""}"></i>`).join("")}</div><p class="journey-outside">只属于你们的一份小心意。</p></section>`;
}
function sceneContent(x,g) {
  const hostPlan=hostChoosesForGuest(x),plan=g.plan;
  if(g.scene==="invite") return `<div class="card-top"><span>JUST FOR ${esc(x.to).toUpperCase()}</span><span class="mini-heart">♡</span></div>${mascot()}<div class="to-name">${esc(x.from)} 有个问题想问你</div><h2>可以和我<br>一起约会吗？</h2><p class="personal-message">${esc(x.message)}</p><p class="tease-note">装作不在意，其实很期待。</p><div class="invitation-emotions"><button class="btn primary" data-action="journey-yes">愿意 ${icon("heart",17)}</button><span class="tease-slot" aria-hidden="true"></span><button class="btn tease-button" data-dodges="${g.teaseCount}">${RunawayButton.label(g.teaseCount)}</button></div><p class="card-sign">只发给你的，一份小小的心意。<br>— ${esc(x.from)}</p>`;
  if(g.scene==="surprise") return `<div class="card-top"><span>A LITTLE TOO HAPPY</span><span class="mini-heart">♡</span></div><div class="surprise-mascot">${mascot()}<span class="surprise-heart one">♡</span><span class="surprise-heart two">♡</span></div><div class="stamp-note">今天的开心，有点超标</div><h2>等一下，<br>你真的愿意吗？</h2><p class="personal-message">让我先偷偷开心三秒。<br>${hostPlan?"想和你见面的安排，都认真准备好了。":"然后，我们认真安排一下见面。"}</p>${hostPlan&&InviteModel.complete(x.proposal)?`<div class="journey-ticket">${ticket(x)}</div>`:""}<div class="scene-bottom">${hostPlan&&InviteModel.complete(x.proposal)?`${sceneButton("就这样，说好啦","journey-accept",!slotAvailable(x.proposal))}${!slotAvailable(x.proposal)?'<p class="hint">这个时间已经有了安排，让 TA 更新一下邀请吧。</p><button class="text-btn" data-action="availability-refresh">刷新空闲时间</button>':""}`:sceneButton("好啦，选个时间","journey-next")}</div>`;
  if(g.scene==="time") return `<div class="card-top"><span>MAKE A LITTLE TIME</span><span class="mini-heart">♡</span></div><div class="scene-symbol">${icon("calendar",32)}</div><h2>所以，什么时候<br>能见到你？</h2><p class="personal-message">${hostPlan?"这是 TA 认真留出的时间，挑一个你方便的。":x.timePolicy === "schedule" ? "这些时候，TA 都有空。留一到三个你也方便的时间吧。" : "留下一到三个方便的时间，让 TA 挑一个。"}</p>${hostPlan?`<p class="hint">${esc(x.timeZone)} · 预计 ${durationLabel(x.durationMinutes)}</p><div class="scene-time-options">${plan.timeOptions.map((slot,index)=>`<button class="scene-time-option ${g.choice.date===slot.date&&g.choice.time===slot.time?"selected":""}" data-action="journey-choice" data-field="time" data-index="${index}" aria-pressed="${g.choice.date===slot.date&&g.choice.time===slot.time}" ${slotAvailable(slot)?"":"disabled"}><span><strong>${fmt(slot.date,false)}</strong><small>${slotAvailable(slot)?fmt(slot.date).split(" · ")[1]||"":"已经有了安排"}</small></span><b>${esc(slot.time)}</b><span class="radio"></span></button>`).join("")}</div>${plan.timeOptions.every(slot=>!slotAvailable(slot))?'<div class="note-box">这些时间暂时都不能选了，让 TA 更新一下候选时间吧。</div>':""}<button class="text-btn" data-action="availability-refresh">刷新空闲时间</button>`:x.timePolicy === "schedule" ? availabilityPicker(plan) : `<p class="hint">${esc(x.timeZone)} · 预计 ${durationLabel(x.durationMinutes)}</p>${timeFields(plan,"journey")}`}<div class="error" id="journey-error" role="alert"></div><div class="scene-bottom">${sceneButton(hostPlan?"就这个时间吧":"这些时间都可以","journey-next",hostPlan?!slotAvailable(g.choice):x.timePolicy==="schedule"&&!plan.timeOptions.some(slot=>slot.date&&slot.time&&slotAvailable(slot)))}</div>`;

  if(g.scene==="hints") return `<div class="card-top"><span>A FEW LITTLE HINTS</span><span class="mini-heart">♡</span></div><div class="scene-symbol">${icon("heart",32)}</div><h2>${hostPlan?"还有一点，<br>TA 的小心思。":"还有什么，<br>想偷偷暗示我？"}</h2><p class="personal-message">${hostPlan?"认真准备的，其实不只是见面。":"可以多选，也可以先保密。"}</p>${hostPlan?`<div class="hint-tags">${plan.preferences.hints.length?plan.preferences.hints.map(h=>`<span>${esc(h)}</span>`).join(""):"有些话，想等见面再告诉你。"}</div>`:`<div class="scene-hints">${sceneHints.map((h,index)=>`<button class="hint-choice ${plan.preferences.hints.includes(h)?"selected":""}" data-action="journey-hint" data-index="${index}" aria-pressed="${plan.preferences.hints.includes(h)}"><span>${h}</span><span class="hint-check">${plan.preferences.hints.includes(h)?"✓":"+"}</span></button>`).join("")}</div>`}<div class="scene-bottom">${sceneTimeFoot()}${sceneButton(hostPlan?"小心思，收到啦":plan.preferences.hints.length?"暗示给你了":"先保密，下一步","journey-next")}</div>`;
  if(g.scene==="activity") {
    const choices=hostPlan?activities.filter(([activity])=>plan.activities.includes(activity)):activities;
    return `<div class="card-top"><span>A LITTLE PLAN FOR US</span><span class="mini-heart">♡</span></div><div class="scene-symbol">${icon("heart",32)}</div><h2>那天，<br>想怎么见面？</h2><p class="personal-message">${hostPlan?"从 TA 准备的小安排里，选一个这次想一起做的。":`愿意一起做的，都可以选。<br>这次做哪一个，交给 ${esc(x.from)} 来敲定。`}</p><div class="scene-activities">${choices.map(([activity,symbol])=>{const selected=hostPlan?g.choice.activity===activity:plan.activities.includes(activity);return `<button class="scene-activity ${selected?"selected":""}" data-action="journey-activity" data-activity="${activity}" aria-pressed="${selected}">${icon(symbol,25)}<span>${activity}</span><i class="${hostPlan?"radio":"multi-check"}" aria-hidden="true">${!hostPlan&&selected?"✓":""}</i></button>`}).join("")}</div><div class="scene-bottom">${sceneButton(hostPlan?"这次就选这个":"这些都愿意，再具体一点","journey-next",hostPlan?!g.choice.activity:!plan.activities.length)}</div>`;
  }
  if(g.scene==="detail") {
    const activity=hostPlan?g.choice.activity:plan.activities[g.detailIndex],config=sceneDetails[activity],last=hostPlan||g.detailIndex===plan.activities.length-1;
    const available=hostPlan?detailChoices(plan.preferences.details[activity]):config.items.map(item=>item[1]);
    const selected=hostPlan?[g.choice.detail]:detailChoices(plan.preferences.details[activity]);
    return `<div class="card-top"><span>THE LITTLE DETAILS</span><span class="mini-heart">♡</span></div><div class="scene-symbol">${icon(activities.find(a=>a[0]===activity)?.[1]||"heart",32)}</div><h2>${config.title}</h2><p class="personal-message">${hostPlan?(available.length?"这些都是 TA 准备的，挑一个最合心意的。":"把见面留给期待，具体的小惊喜到时候再揭晓。"):"喜欢的都可以选，没想好也可以交给对方。"}</p>${!hostPlan&&plan.activities.length>1?`<div class="detail-tabs" aria-label="每个小安排的偏好">${plan.activities.map((item,index)=>`<button class="detail-tab ${index===g.detailIndex?"selected":""}" data-action="journey-detail-tab" data-index="${index}" aria-pressed="${index===g.detailIndex}">${esc(item)}${detailChoices(plan.preferences.details[item]).length?" ✓":""}</button>`).join("")}</div>`:""}<div class="scene-details ${available.length>4?"nine":"four"}">${config.items.filter(item=>available.includes(item[1])).map(item=>`<button class="detail-choice ${selected.includes(item[1])?"selected":""}" data-action="journey-detail" data-index="${config.items.indexOf(item)}" aria-pressed="${selected.includes(item[1])}"><span class="detail-emoji" aria-hidden="true">${item[0]}</span><span>${item[1]}</span><i class="${hostPlan?"radio":"multi-check"}" aria-hidden="true">${!hostPlan&&selected.includes(item[1])?"✓":""}</i></button>`).join("")}</div><div class="scene-bottom">${sceneButton(last?"把小心思放在一起":"收好，再看下一个","journey-next",hostPlan&&available.length>0&&!g.choice.detail)}</div>`;
  }
  const proposal=guestDisplayProposal(x);
  return `<div class="card-top"><span>OUR LITTLE PROMISE</span><span class="mini-heart">♡</span></div><div class="mini-mascot">${mascot()}</div><h2>${hostPlan?"这次的小安排，<br>就这样说好？":"我的小心思，<br>都告诉你啦。"}</h2><p class="personal-message">${hostPlan?"选一个见面的地方，就可以开始期待了。":"再留一到三个想去的地方，交给 TA 来敲定。"}</p><div class="journey-place-field">${hostPlan?`<div class="scene-time-options">${plan.placeOptions.map((place,index)=>`<button class="scene-time-option ${g.choice.place===place?"selected":""}" data-action="journey-choice" data-field="place" data-index="${index}" aria-pressed="${g.choice.place===place}"><span>${esc(place)}</span><i class="radio"></i></button>`).join("")}</div>`:placeFields(plan,"journey")}</div><div class="journey-ticket">${ticket({...x,proposal})}</div><p class="scene-submit-note">${hostPlan?"这次的时间、地点和小安排，都想和你说好。":`这些都是我愿意的，等 ${esc(x.from)} 来敲定这次见面。`}</p><div class="error" id="journey-error" role="alert"></div><div class="scene-bottom">${sceneButton(hostPlan?"就这样，说好啦":"把小心思交给你","journey-submit",hostPlan&&!selectionComplete(plan,g.choice))}</div>`;
}
function bindJourneyInputs() {
  const x=current();
  if(!hostChoosesForGuest(x)) bindPlanInputs("journey",guestJourney.plan,()=>{const preview=$(".journey-ticket");if(preview)preview.innerHTML=ticket({...x,proposal:guestDisplayProposal(x)});});
  const area=document.querySelector(".invitation-emotions");if(area) cleanupRunaway=RunawayButton.bind(area,guestJourney);
}
async function submitGuestChoice(x) {
  const g=guestJourney;
  if(!selectionComplete(g.plan,g.choice)) throw InviteAPI.userError("把时间、地点和具体的小安排都选好吧。");
  await loadAvailability();
  if (!slotAvailable(g.choice)) throw InviteAPI.userError("这个时间刚刚有了安排，再挑一个吧。");
  await updateRecord(InviteModel.complete(x.proposal)?{type:"confirm",version:g.version}:{type:"finalize",version:g.version,proposal:selectionPayload(g.choice)});
  guestJourney=null;view="result";celebrate();
}
async function journeyAction(a,el) {
  const x=current();startGuestJourney(x);const g=guestJourney,plan=g.plan,hostPlan=hostChoosesForGuest(x);
  if(a==="journey-yes") {g.scene="surprise";celebrate();}
  else if(a==="journey-accept") {if(hostPlan&&g.scene==="surprise"&&InviteModel.complete(x.proposal))await submitGuestChoice(x);}
  else if(a==="journey-back") {
    if(!hostPlan&&g.scene==="detail"&&g.detailIndex>0)g.detailIndex--;
    else {if(g.scene==="review")g.detailIndex=plan.activities.length-1;g.scene=journeyScenes[Math.max(0,journeyScenes.indexOf(g.scene)-1)];}
  } else if(a==="journey-next") {
    if(g.scene==="surprise") await loadAvailability();
    if(g.scene==="time") {
      const slots=hostPlan?[g.choice]:plan.timeOptions;
      if(!slots.length || slots.some(slot=>!slot.date||!slot.time||!futureSlot(slot,x.timeZone)||(hostPlan||x.timePolicy==="schedule")&&!slotAvailable(slot))) {$("#journey-error").textContent="选一个完整、还没到来的时间吧。";return;}
    }
    if(g.scene==="activity") {if(hostPlan?!g.choice.activity:!plan.activities.length)return;g.detailIndex=0;}
    if(hostPlan&&g.scene==="detail"&&detailChoices(plan.preferences.details[g.choice.activity]).length&&!g.choice.detail)return;
    if(!hostPlan&&g.scene==="detail"&&g.detailIndex<plan.activities.length-1)g.detailIndex++;
    else g.scene=journeyScenes[Math.min(journeyScenes.length-1,journeyScenes.indexOf(g.scene)+1)];
  } else if(a==="journey-choice"&&hostPlan) { if(el.dataset.field!=="time" || slotAvailable(plan.timeOptions[Number(el.dataset.index)]))selectArrangement(g.choice,plan,el.dataset.field,el.dataset.index); }
  else if(a==="journey-hint"&&!hostPlan) {const hint=sceneHints[Number(el.dataset.index)],values=plan.preferences.hints;plan.preferences.hints=values.includes(hint)?values.filter(v=>v!==hint):[...values,hint];}
  else if(a==="journey-activity") {
    const activity=el.dataset.activity;if(!sceneDetails[activity])return;
    if(hostPlan) {const index=plan.activities.indexOf(activity);if(index>=0)selectArrangement(g.choice,plan,"activity",index);}
    else plan.activities=plan.activities.includes(activity)?plan.activities.filter(v=>v!==activity):[...plan.activities,activity];
  } else if(a==="journey-detail") {
    const activity=hostPlan?g.choice.activity:plan.activities[g.detailIndex],detail=sceneDetails[activity].items[Number(el.dataset.index)]?.[1];if(!detail)return;
    if(hostPlan) {if(detailChoices(plan.preferences.details[activity]).includes(detail))g.choice.detail=detail;}
    else {const selected=detailChoices(plan.preferences.details[activity]);plan.preferences.details[activity]=selected.includes(detail)?selected.filter(v=>v!==detail):[...selected,detail];}
  } else if(a==="journey-detail-tab"&&!hostPlan) {const index=Number(el.dataset.index);if(index>=0&&index<plan.activities.length)g.detailIndex=index;}
  else if(["journey-add-time","journey-remove-time","journey-add-place","journey-remove-place"].includes(a)&&!hostPlan)editPlanCandidates(plan,a.slice(8),Number(el.dataset.index));
  else if(a==="journey-submit") {
    if(g.scene!=="review")return;
    if(hostPlan) await submitGuestChoice(x);
    else {const error=validatePlan(plan);if(error){$("#journey-error").textContent=error;return;}await updateRecord({type:"respond",version:g.version,proposal:guestProposal()});guestJourney=null;view="result";celebrate();}
  }
  render();
  if(["journey-yes","journey-next","journey-back","journey-submit","journey-accept"].includes(a))window.scrollTo({top:0,behavior:"instant"});
}

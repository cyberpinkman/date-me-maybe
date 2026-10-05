const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Model = require("../src/model.js");
const source = (name) => fs.readFileSync(path.join(__dirname, "../src", name + ".js"), "utf8");

function fixture({ guest = false, invitation, signedIn = true, search = "" } = {}) {
  let saved = invitation || Model.create({ id: "invitation-one", from: "小宇", to: "小鹿", message: "想见你", mode: "open" });
  const writes = [], storage = new Map(), nodes = new Map();
  const node = (value = "") => ({ value, textContent: "", innerHTML: "", focus() {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => ({ focus() {} }) });
  for (const selector of ["#root", "#toast-root", "#modal-root", "#journey-error", "#proposal-error", "#form-error", "#account-message"]) nodes.set(selector, node());
  const context = vm.createContext({
    document: { body: { dataset: {} }, querySelector: (s) => nodes.get(s) || null, querySelectorAll: () => [], addEventListener() {} },
    window: { scrollTo() {} }, location: { pathname: guest ? "/i/recipient-token" : "/", search, origin: "https://example.test" },
    history: { replaceState() {} },
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    crypto, URLSearchParams, setInterval() {}, setTimeout() {}, clearTimeout() {}, matchMedia: () => ({ matches: true }),
    fetch: async (url, options) => {
      const body = options.body && JSON.parse(options.body);
      if (body) writes.push({ url, body });
      if (url === "/api/config") return {ok:true,status:200,json:async()=>({emailOtpEnabled:true})};
      if (url === "/api/session") return { ok: true, status: 200, json: async () => ({ user: { id: "sender-one" } }) };
      if (url === "/api/invitations" && !body) return { ok: true, status: 200, json: async () => ({ invitations: [saved] }) };
      if (url === "/api/invitations" && body) saved = { ...Model.create(body.draft), shareUrl: "https://example.test/i/recipient-token" };
      if (url.endsWith("/actions")) saved = Model.transition(saved, { ...body, role: guest ? "guest" : "host" });
      return { ok: true, status: 200, json: async () => ({ invitation: saved }) };
    },
  });
  for (const name of ["model", "runaway", "journey", "api-client", "account", "card-export", "app"]) {
    vm.runInContext(name === "app" ? source(name).replace(/\nboot\(\);\s*$/, "") : source(name), context);
  }
  const run = (code) => vm.runInContext(code, context);
  const data = (code) => JSON.parse(run(`JSON.stringify(${code})`));
  run(`booting = false; appConfig.emailOtpEnabled = true; sessionUser = ${signedIn ? '{id:"sender-one"}' : 'null'}; invitations = [${JSON.stringify(saved)}]; currentId = invitations[0].id; role = ${JSON.stringify(guest ? "guest" : "host")}; view = ${JSON.stringify(guest ? "guest" : "host")};`);
  const act = (name, dataset = {}) => run(`action(${JSON.stringify(name)}, {tagName:"BUTTON", dataset:${JSON.stringify(dataset)}})`);
  return { run, data, act, writes, storage, nodes, node };
}
const schedule = { date: "2099-10-07", time: "18:30", place: "湖边咖啡店" };
const ranged = () => Model.transition(Model.create({ id: "range-one", from: "小宇", to: "小鹿", message: "想见你", mode: "open" }), {
  type: "respond", role: "guest", version: 1,
  proposal: { ...schedule, activities: ["吃点好吃的", "喝杯咖啡"], activity: "", preferences: { hints: ["有点暧昧"], details: { 吃点好吃的: ["火锅", "烤肉"], 喝杯咖啡: ["安静的小店", "有阳光的窗边"] } } },
});

test("creating after sign-in keeps the written invitation and sends no sender arrangement", async () => {
  const f = fixture({ signedIn: false });
  f.storage.set("opendater-creation-draft-v1", JSON.stringify({ draft: { from: "旧草稿昵称", to: "心里的人", tone: "gentle", message: "想和你见一面", mode: "fixed", options: [schedule], activity: "吃点好吃的", place: "旧地点", ownerId: "not-an-owner" }, step: 2 }));
  f.run("restoreCreationDraft(); view='create'");
  assert.equal(f.run("step"), 1);
  assert.equal(f.run("draft.mode"), "open");
  await f.act("create");
  assert.equal(f.run("view"), "account");
  assert.equal(f.writes.length, 0);
  await f.run("finishLogin()");
  assert.equal(f.run("view"), "create");
  assert.equal(f.run("step"), 1);
  await f.act("create");
  assert.equal(f.writes.length, 1);
  const payload = f.writes[0].body.draft;
  assert.deepEqual(Object.keys(payload).sort(), ["from", "to", "tone", "message", "mode", "timeZone"].sort());
  assert.equal(payload.from, "旧草稿昵称");
  assert.equal(payload.message, "想和你见一面");
  assert.equal(payload.mode, "open");
  assert.equal(f.run("view"), "ready");
});

test("seven recipient scenes retain the range and optional per-activity details until one final submission", async () => {
  const f = fixture({ guest: true });
  f.run("startGuestJourney(current())");
  assert.match(f.run("journeyView(current())"), /data-dodges="0"/);
  const scenes = [f.run("guestJourney.scene")];
  await f.act("journey-yes"); scenes.push(f.run("guestJourney.scene"));
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  assert.match(f.run("journeyView(current())"), /id="journey-date-0"/);
  f.run(`guestJourney.plan.timeOptions[0]=${JSON.stringify({ date: schedule.date, time: schedule.time })}`);
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  await f.act("journey-hint", { index: "0" });
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  await f.act("journey-activity", { activity: "吃点好吃的" });
  await f.act("journey-activity", { activity: "喝杯咖啡" });
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  await f.act("journey-detail", { index: "3" }); // food -> hotpot
  await f.act("journey-detail", { index: "1" }); // also barbecue
  assert.deepEqual(f.data('guestJourney.plan.preferences.details["吃点好吃的"]'), ["火锅", "烤肉"]);
  await f.act("journey-detail", { index: "3" });
  assert.deepEqual(f.data('guestJourney.plan.preferences.details["吃点好吃的"]'), ["烤肉"]);
  await f.act("journey-detail", { index: "3" });
  assert.match(f.run("journeyView(current())"), /data-action="journey-detail" data-index="1" aria-pressed="true"/);
  assert.match(f.run("journeyView(current())"), /data-action="journey-detail" data-index="3" aria-pressed="true"/);
  await f.act("journey-detail-tab", { index: "1" });
  await f.act("journey-detail", { index: "0" });
  await f.act("journey-detail", { index: "1" });
  assert.deepEqual(f.data('guestJourney.plan.preferences.details["喝杯咖啡"]'), ["安静的小店", "咖啡加甜品"]);
  await f.act("journey-detail-tab", { index: "0" });
  assert.deepEqual(f.data('guestJourney.plan.preferences.details["吃点好吃的"]'), ["烤肉", "火锅"]);
  await f.act("journey-next");
  assert.equal(f.run("guestJourney.detailIndex"), 1);
  await f.act("journey-detail", { index: "0" });
  await f.act("journey-detail", { index: "1" }); // coffee can remain unspecified
  assert.deepEqual(f.data('guestJourney.plan.preferences.details["喝杯咖啡"]'), []);
  assert.doesNotMatch(f.run("journeyView(current())"), /喝杯咖啡 ✓/);
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  assert.deepEqual(scenes, ["invite", "surprise", "time", "hints", "activity", "detail", "review"]);
  assert.equal(f.writes.length, 0);
  assert.match(f.run("journeyView(current())"), /id="journey-place-0"/);
  await f.act("journey-submit");
  assert.equal(f.writes.length, 0, "blank place cannot commit a response");
  assert.match(f.nodes.get("#journey-error").textContent, /地点/);
  await f.act("journey-back");
  assert.equal(f.run("guestJourney.detailIndex"), 1);
  assert.deepEqual(f.data('guestJourney.plan.preferences.details["吃点好吃的"]'), ["烤肉", "火锅"]);
  await f.act("journey-next");
  f.run(`guestJourney.plan.placeOptions[0]=${JSON.stringify(schedule.place)}`);
  await f.act("journey-submit");
  assert.equal(f.writes.length, 1);
  assert.match(f.writes[0].url, /^\/api\/guest\/recipient-token\/actions$/);
  const { proposal, type, role, ownerId } = f.writes[0].body;
  assert.equal(type, "respond");
  assert.equal(role, undefined); assert.equal(ownerId, undefined);
  assert.deepEqual(proposal.activities, ["吃点好吃的", "喝杯咖啡"]);
  assert.equal(proposal.activity, undefined);
  assert.deepEqual(proposal.preferences.details, { 吃点好吃的: ["烤肉", "火锅"], 喝杯咖啡: [] });
  assert.deepEqual(proposal.placeOptions, [schedule.place]);
  assert.equal(f.run("InviteModel.status(current())"), "host_review");
});

test("deselected activity details stay out of the response and old suggestions keep editable time/place", async () => {
  for (const mode of ["fixed", "flexible"]) {
    const x = Model.create({ id: mode, from: "A", to: "B", message: "想见你", mode, options: [schedule, { ...schedule, date: "2099-10-08" }], activity: "吃点好吃的", place: "原来的公园" });
    const f = fixture({ guest: true, invitation: x });
    f.run('startGuestJourney(current()); guestJourney.scene="time"');
    assert.match(f.run("journeyView(current())"), /id="journey-date-0"/);
    assert.equal(f.run("guestJourney.plan.timeOptions[0].date"), schedule.date);
    f.run('guestJourney.scene="activity"');
    await f.act("journey-activity", { activity: "吃点好吃的" });
    await f.act("journey-activity", { activity: "喝杯咖啡" });
    f.run('guestJourney.plan.preferences.details={"吃点好吃的":"火锅","喝杯咖啡":"安静的小店"}');
    await f.act("journey-activity", { activity: "吃点好吃的" });
    const p = f.data("guestProposal()");
    assert.deepEqual(p.activities, ["喝杯咖啡"]);
    assert.deepEqual(p.preferences.details, { 喝杯咖啡: ["安静的小店"] });
    f.run('guestJourney.scene="review"');
    assert.match(f.run("journeyView(current())"), /id="journey-place-0"[^>]*value="原来的公园"/);
  }
});

test("the sender finalizes one activity while every summary preserves all of its acceptable preferences", async () => {
  const f = fixture({ invitation: ranged() });
  assert.equal(f.run("selectedHostActivity(current())"), "");
  assert.match(f.run("resultActions(current())"), /data-action="finalize" disabled/);
  assert.match(f.run("hostActivityChoices(current())"), /火锅、烤肉/);
  assert.doesNotMatch(f.run("resultActions(current())"), /data-action="change"/);
  await f.act("change");
  assert.equal(f.run("modal"), null);
  for (const render of ["ticket", "listView", "invitationText", "cardRows"]) {
    const output = f.run(render === "listView" ? "listView()" : render === "cardRows" ? "JSON.stringify(cardRows(current()))" : `${render}(current())`);
    assert.match(output, /这些都愿意/);
    assert.match(output, /火锅、烤肉/); assert.match(output, /安静的小店、有阳光的窗边/);
  }
  await f.act("host-activity", { activity: "吃点好吃的" });
  assert.equal(f.writes.length, 0);
  await f.act("finalize");
  assert.equal(f.writes[0].body.type, "finalize");
  assert.deepEqual(f.writes[0].body.proposal, { activity: "吃点好吃的" });
  assert.equal(f.run("InviteModel.status(current())"), "confirmed");
  for (const render of ["ticket", "listView", "invitationText", "cardRows"]) {
    const output = f.run(render === "listView" ? "listView()" : render === "cardRows" ? "JSON.stringify(cardRows(current()))" : `${render}(current())`);
    assert.doesNotMatch(output, /这些都愿意|安静的小店|有阳光的窗边/);
    assert.match(output, /吃点好吃的.*火锅、烤肉/);
  }
});

test("the shared preference formatter reads previous scalar values and new arrays, including empty choices", () => {
  const f = fixture();
  for (const [value, expected] of [["火锅", "火锅"], [["火锅", "烤肉"], "火锅、烤肉"], ["", ""], [[], ""]]) {
    assert.equal(f.run(`activityDetail({preferences:{details:{"吃点好吃的":${JSON.stringify(value)}}}}, "吃点好吃的")`), expected);
  }
  assert.equal(f.run('activityDetail({activity:"吃点好吃的",preferences:{detail:"火锅"}}, "吃点好吃的")'), "火锅");
  assert.equal(f.run('activityDetail({activity:"吃点好吃的",preferences:{detail:"火锅"}}, "喝杯咖啡")'), "");
});

test("choice is scoped to invitation revision, and a revised finalized arrangement uses ordinary confirmation", async () => {
  const f = fixture({ invitation: ranged() });
  await f.act("host-activity", { activity: "喝杯咖啡" });
  f.run("current().version++");
  assert.equal(f.run("selectedHostActivity(current())"), "");
  f.run('current().proposal.activities=["喝杯咖啡"]; current().version++');
  assert.equal(f.run("selectedHostActivity(current())"), "喝杯咖啡");
  const confirmed = Model.transition(ranged(), { type: "finalize", role: "host", version: 2, proposal: { activity: "喝杯咖啡" } });
  const changed = Model.transition(confirmed, { type: "propose", role: "guest", version: confirmed.version, proposal: { date: "2099-10-08" } });
  const revised = fixture({ invitation: changed });
  const html = revised.run("resultActions(current())");
  assert.match(html, /data-action="confirm"/);
  assert.doesNotMatch(html, /data-action="finalize"|host-activity-choice/);
  assert.match(revised.run("resultCard(current())"), /见面的安排/);
  await revised.act("confirm");
  assert.equal(revised.writes[0].body.type, "confirm");
  assert.equal(revised.run("InviteModel.status(current())"), "confirmed");
});

test("only a confirmed arrangement exposes rescheduling and keeps its selected activity and detail", async () => {
  const pending = fixture({ invitation: ranged() });
  await pending.act("change");
  assert.equal(pending.run("modal"), null);
  const legacy = Model.create({id:"legacy-missing-place",mode:"fixed",from:"A",to:"B",message:"想见你",options:[schedule],place:"",activity:"吃点好吃的"});
  const details=fixture({invitation:Model.transition(legacy,{type:"confirm",role:"guest",version:1})});
  assert.match(details.run("resultActions(current())"),/data-action="change"/);
  await details.act("change"); assert.equal(details.run("modal.type"),"proposal");
  for (const guest of [false, true]) {
    const original = Model.transition(ranged(), {type:"finalize", role:"host", version:2, proposal:{activity:"吃点好吃的"}});
    const f = fixture({ guest, invitation: original });
    for (const [key,value] of Object.entries({date:"2099-10-09",time:"19:00",place:"新的集合点"})) f.nodes.set("#proposal-"+key, f.node(value));
    await f.act("change");
    await f.act("submit-proposal");
    assert.equal(f.writes.length,1);
    assert.equal(f.run("current().proposal.activity"),"吃点好吃的");
    assert.equal(f.run("current().proposal.preferences.detail"),"火锅、烤肉");
    assert.equal(f.run("InviteModel.status(current())"),guest?"host_review":"guest_review");
  }
});
const candidatePlan = (single=false) => ({
  timeOptions: [{date:"2099-10-07",time:"18:30"}, ...(!single?[{date:"2099-10-08",time:"19:00"}]:[])],
  placeOptions: ["湖边咖啡店",...(!single?["公园南门"]:[])],
  activities:["吃点好吃的",...(!single?["喝杯咖啡"]:[])],
  preferences:{hints:["有点暧昧"],details:{"吃点好吃的":["火锅",...(!single?["烤肉"]:[])],...(!single?{"喝杯咖啡":["安静的小店"]}:{})}},
});
const scopedInvitation = (mode,single=false) => {
  const x=Model.create({id:"scoped-"+mode,from:"A",to:"B",message:"想见你",mode,...(mode==="host"?{plan:candidatePlan(single)}:{})});
  return mode==="host"?x:Model.transition(x,{type:"respond",role:"guest",version:1,proposal:candidatePlan(single)});
};

test("host-mode creation retains its candidate draft across mode switches and login", async () => {
  const f=fixture({signedIn:false});
  f.run('view="create"; draft.from="A"; draft.to="B"');
  await f.act("creation-mode",{mode:"host"});
  f.run(`draft.plan=${JSON.stringify(candidatePlan())}`);
  await f.act("next"); assert.equal(f.run("step"),1);
  await f.act("next"); assert.equal(f.run("step"),2);
  await f.act("create"); assert.equal(f.run("view"),"account");
  assert.equal(f.writes.length,0);
  f.run("restoreCreationDraft()");
  assert.equal(f.run("draft.mode"),"host"); assert.equal(f.run("step"),2);
  assert.deepEqual(f.data("cleanPlan(draft.plan)"),candidatePlan());
  await f.run("finishLogin()");
  await f.act("creation-mode",{mode:"open"});
  assert.deepEqual(f.data("cleanPlan(draft.plan)"),candidatePlan());
  await f.act("creation-mode",{mode:"host"});
  await f.act("create");
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].body.draft.mode,"host");
  assert.deepEqual(f.writes[0].body.draft.plan,candidatePlan());
  assert.match(f.run("readyView()"),/公园南门/);
});

test("candidate editors cap each time/place list at three and never remove the final row", async () => {
  const f=fixture({guest:true}); f.run("startGuestJourney(current())");
  for(const kind of ["time","place"]) {
    for(let i=0;i<4;i++)await f.act("journey-add-"+kind);
    assert.equal(f.run(`guestJourney.plan.${kind}Options.length`),3);
    for(let i=0;i<4;i++)await f.act("journey-remove-"+kind,{index:"0"});
    assert.equal(f.run(`guestJourney.plan.${kind}Options.length`),1);
  }
});

test("the chooser finalizes a full candidate plan in either mode and exports only selected values", async () => {
  for(const mode of ["host","open"]) {
    const f=fixture({guest:mode==="host",invitation:scopedInvitation(mode)});
    if(mode==="host") {
      f.run('startGuestJourney(current()); guestJourney.scene="time"');
      assert.doesNotMatch(f.run("journeyView(current())"),/data-plan-input/);
      assert.match(f.run("journeyView(current())"),/data-action="journey-next" disabled/);
      await f.act("journey-choice",{field:"time",index:"1"});
      assert.doesNotMatch(f.run("journeyView(current())"),/data-action="journey-next" disabled/);
      await f.act("journey-activity",{activity:"吃点好吃的"});
      f.run('guestJourney.scene="detail"');
      assert.doesNotMatch(f.run("journeyView(current())"),/>日料</);
      await f.act("journey-detail",{index:"1"}); // barbecue
      await f.act("journey-activity",{activity:"喝杯咖啡"});
      assert.equal(f.run("guestJourney.choice.detail"),"安静的小店");
      await f.act("journey-activity",{activity:"吃点好吃的"});
      assert.equal(f.run("guestJourney.choice.detail"),"");
      await f.act("journey-detail",{index:"1"});
      f.run('guestJourney.scene="review"');
      assert.match(f.run("journeyView(current())"),/data-action="journey-submit" disabled/);
      await f.act("journey-choice",{field:"place",index:"0"});
      assert.doesNotMatch(f.run("journeyView(current())"),/data-action="journey-submit" disabled/);
      await f.act("journey-submit");
    } else {
      assert.match(f.run("resultActions(current())"),/data-action="finalize" disabled/);
      for(const [field,index] of [["time","1"],["place","0"],["activity","0"],["detail","1"]]) await f.act("plan-choice",{field,index});
      await f.act("finalize");
    }
    assert.equal(f.writes.length,1);
    assert.equal(f.writes[0].body.type,"finalize");
    assert.deepEqual(f.writes[0].body.proposal,{date:"2099-10-08",time:"19:00",place:"公园南门",activity:"吃点好吃的",detail:"烤肉"});
    assert.equal(f.run("InviteModel.status(current())"),"confirmed");
    for(const render of ["ticket","invitationText","cardRows"]) {
      const text=f.run(render==="cardRows"?"JSON.stringify(cardRows(current()))":`${render}(current())`);
      assert.match(text,/烤肉/); assert.match(text,/公园南门/);
      assert.doesNotMatch(text,/火锅|湖边咖啡店|18:30|安静的小店/);
    }
  }
});

test("singleton plans are accepted directly, and the creation link appears only after a recipient response", async () => {
  for(const mode of ["host","open"]) {
    const f=fixture({guest:mode==="host",invitation:scopedInvitation(mode,true)});
    if(mode==="host") {
      assert.doesNotMatch(f.run("guestView()"),/我也要发起邀约/);
      await f.act("journey-yes");
      assert.match(f.run("journeyView(current())"),/data-action="journey-accept"/);
      await f.act("journey-accept");
      assert.match(f.run("guestView()"),/href="\/\?create=new">我也要发起邀约/);
      assert.doesNotMatch(f.run("ticket(current())"),/我也要发起邀约/);
      assert.match(f.writes[0].url,/^\/api\/guest\//);
    } else {
      assert.match(f.run("resultActions(current())"),/data-action="confirm"/);
      assert.doesNotMatch(f.run("resultActions(current())"),/data-action="finalize"/);
      await f.act("confirm");
    }
    assert.equal(f.writes[0].body.type,"confirm");
    assert.equal(f.run("InviteModel.status(current())"),"confirmed");
  }
  const fresh=fixture({search:"?create=new"});
  fresh.storage.set("opendater-creation-draft-v1",JSON.stringify({draft:{from:"旧名字",to:"旧对象",message:"旧草稿",mode:"host",plan:candidatePlan()},step:2}));
  await fresh.run("boot()");
  assert.equal(fresh.run("guestToken"),null);
  assert.equal(fresh.run("draft.mode"),"open");
  assert.equal(fresh.run("step"),0);
  assert.notEqual(fresh.run("draft.from"),"旧名字");
  assert.equal(fresh.run("view"),"create");
});

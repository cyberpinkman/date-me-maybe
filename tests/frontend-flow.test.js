const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Model = require("../src/model.js");
const source = (name) => fs.readFileSync(path.join(__dirname, "../src", name + ".js"), "utf8");

function fixture({ guest = false, invitation, signedIn = true } = {}) {
  let saved = invitation || Model.create({ id: "invitation-one", from: "小宇", to: "小鹿", message: "想见你", mode: "open" });
  const writes = [], storage = new Map(), nodes = new Map();
  const node = (value = "") => ({ value, textContent: "", innerHTML: "", focus() {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => ({ focus() {} }) });
  for (const selector of ["#root", "#toast-root", "#modal-root", "#journey-error", "#proposal-error", "#form-error", "#account-message"]) nodes.set(selector, node());
  const context = vm.createContext({
    document: { body: { dataset: {} }, querySelector: (s) => nodes.get(s) || null, querySelectorAll: () => [], addEventListener() {} },
    window: { scrollTo() {} }, location: { pathname: guest ? "/i/recipient-token" : "/", search: "", origin: "https://example.test" },
    history: { replaceState() {} },
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    crypto, URLSearchParams, setInterval() {}, setTimeout() {}, clearTimeout() {}, matchMedia: () => ({ matches: true }),
    fetch: async (url, options) => {
      const body = options.body && JSON.parse(options.body);
      if (body) writes.push({ url, body });
      if (url === "/api/session") return { ok: true, status: 200, json: async () => ({ user: { id: "sender-one" } }) };
      if (url === "/api/invitations" && !body) return { ok: true, status: 200, json: async () => ({ invitations: [saved] }) };
      if (url === "/api/invitations" && body) saved = { ...Model.create(body.draft), shareUrl: "https://example.test/i/recipient-token" };
      if (url.endsWith("/actions")) saved = Model.transition(saved, { ...body, role: guest ? "guest" : "host" });
      return { ok: true, status: 200, json: async () => ({ invitation: saved }) };
    },
  });
  for (const name of ["model", "runaway", "journey", "api-client", "account", "app"]) {
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
  assert.match(f.run("journeyView(current())"), /id="journey-date"/);
  f.run(`guestJourney.time=${JSON.stringify({ date: schedule.date, time: schedule.time })}`);
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  await f.act("journey-hint", { index: "0" });
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  await f.act("journey-activity", { activity: "吃点好吃的" });
  await f.act("journey-activity", { activity: "喝杯咖啡" });
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  await f.act("journey-detail", { index: "3" }); // food -> hotpot
  await f.act("journey-detail", { index: "1" }); // also barbecue
  assert.deepEqual(f.data('guestJourney.details["吃点好吃的"]'), ["火锅", "烤肉"]);
  await f.act("journey-detail", { index: "3" });
  assert.deepEqual(f.data('guestJourney.details["吃点好吃的"]'), ["烤肉"]);
  await f.act("journey-detail", { index: "3" });
  assert.match(f.run("journeyView(current())"), /data-action="journey-detail" data-index="1" aria-pressed="true"/);
  assert.match(f.run("journeyView(current())"), /data-action="journey-detail" data-index="3" aria-pressed="true"/);
  await f.act("journey-detail-tab", { index: "1" });
  await f.act("journey-detail", { index: "0" });
  await f.act("journey-detail", { index: "1" });
  assert.deepEqual(f.data('guestJourney.details["喝杯咖啡"]'), ["安静的小店", "咖啡加甜品"]);
  await f.act("journey-detail-tab", { index: "0" });
  assert.deepEqual(f.data('guestJourney.details["吃点好吃的"]'), ["烤肉", "火锅"]);
  await f.act("journey-next");
  assert.equal(f.run("guestJourney.detailIndex"), 1);
  await f.act("journey-detail", { index: "0" });
  await f.act("journey-detail", { index: "1" }); // coffee can remain unspecified
  assert.deepEqual(f.data('guestJourney.details["喝杯咖啡"]'), []);
  assert.doesNotMatch(f.run("journeyView(current())"), /喝杯咖啡 ✓/);
  await f.act("journey-next"); scenes.push(f.run("guestJourney.scene"));
  assert.deepEqual(scenes, ["invite", "surprise", "time", "hints", "activity", "detail", "review"]);
  assert.equal(f.writes.length, 0);
  assert.match(f.run("journeyView(current())"), /id="journey-place"/);
  await f.act("journey-submit");
  assert.equal(f.writes.length, 0, "blank place cannot commit a response");
  assert.match(f.nodes.get("#journey-error").textContent, /地点/);
  await f.act("journey-back");
  assert.equal(f.run("guestJourney.detailIndex"), 1);
  assert.deepEqual(f.data('guestJourney.details["吃点好吃的"]'), ["烤肉", "火锅"]);
  await f.act("journey-next");
  f.run(`guestJourney.place=${JSON.stringify(schedule.place)}`);
  await f.act("journey-submit");
  assert.equal(f.writes.length, 1);
  assert.match(f.writes[0].url, /^\/api\/guest\/recipient-token\/actions$/);
  const { proposal, type, role, ownerId } = f.writes[0].body;
  assert.equal(type, "respond");
  assert.equal(role, undefined); assert.equal(ownerId, undefined);
  assert.deepEqual(proposal.activities, ["吃点好吃的", "喝杯咖啡"]);
  assert.equal(proposal.activity, "");
  assert.deepEqual(proposal.preferences.details, { 吃点好吃的: ["烤肉", "火锅"], 喝杯咖啡: [] });
  assert.equal(proposal.place, schedule.place);
  assert.equal(f.run("InviteModel.status(current())"), "host_review");
});

test("deselected activity details stay out of the response and old suggestions keep editable time/place", async () => {
  for (const mode of ["fixed", "flexible"]) {
    const x = Model.create({ id: mode, from: "A", to: "B", message: "想见你", mode, options: [schedule, { ...schedule, date: "2099-10-08" }], activity: "吃点好吃的", place: "原来的公园" });
    const f = fixture({ guest: true, invitation: x });
    f.run('startGuestJourney(current()); guestJourney.scene="time"');
    assert.match(f.run("journeyView(current())"), /journey-custom/);
    await f.act("journey-custom");
    assert.match(f.run("journeyView(current())"), /id="journey-date"/);
    f.run('guestJourney.scene="activity"');
    await f.act("journey-activity", { activity: "吃点好吃的" });
    await f.act("journey-activity", { activity: "喝杯咖啡" });
    f.run('guestJourney.details={"吃点好吃的":"火锅","喝杯咖啡":"安静的小店"}');
    await f.act("journey-activity", { activity: "吃点好吃的" });
    const p = f.data("guestProposal()");
    assert.deepEqual(p.activities, ["喝杯咖啡"]);
    assert.deepEqual(p.preferences.details, { 喝杯咖啡: ["安静的小店"] });
    f.run('guestJourney.scene="review"');
    assert.match(f.run("journeyView(current())"), /id="journey-place"[^>]*value="原来的公园"/);
  }
});

test("the sender finalizes one activity while every summary preserves all of its acceptable preferences", async () => {
  const f = fixture({ invitation: ranged() });
  assert.equal(f.run("selectedHostActivity(current())"), "");
  assert.match(f.run("resultActions(current())"), /data-action="finalize" disabled/);
  assert.match(f.run("hostActivityChoices(current())"), /火锅、烤肉/);
  await f.act("change");
  assert.match(f.nodes.get("#modal-root").innerHTML, /吃点好吃的 · 火锅、烤肉/);
  await f.act("close-modal");
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
  assert.match(revised.run("resultCard(current())"), /新的安排/);
  await revised.act("confirm");
  assert.equal(revised.writes[0].body.type, "confirm");
  assert.equal(revised.run("InviteModel.status(current())"), "confirmed");
});

test("schedule changes preserve the guest range; only a sender with a pending range must choose the final activity", async () => {
  for (const guest of [false, true]) {
    const f = fixture({ guest, invitation: ranged() });
    for (const [key, value] of Object.entries({ date: "2099-10-09", time: "19:00", place: "新的集合点" })) f.nodes.set("#proposal-" + key, f.node(value));
    f.run('modal={type:"proposal",version:current().version}');
    await f.act("submit-proposal");
    if (!guest) {
      assert.equal(f.writes.length, 0);
      assert.match(f.nodes.get("#proposal-error").textContent, /一起做的事/);
      f.nodes.set('[name="proposal-activity"]:checked', f.node("喝杯咖啡"));
      await f.act("submit-proposal");
    }
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0].body.proposal, { date: "2099-10-09", time: "19:00", place: "新的集合点", ...(guest ? {} : { activity: "喝杯咖啡" }) });
    assert.deepEqual(f.data("current().proposal.activities"), ["吃点好吃的", "喝杯咖啡"]);
    assert.equal(f.run("InviteModel.status(current())"), guest ? "host_review" : "guest_review");
  }
});

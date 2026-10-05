const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/model.js");
const sample = {
  mode: "fixed",
  from: "A",
  to: "B",
  place: "约好的咖啡店门口",
  activity: "喝杯咖啡",
  options: [
    { date: "2026-10-10", time: "15:00" },
    { date: "2026-10-11", time: "18:00" },
  ],
};
const change = (x, role, type, proposal) =>
  M.transition(x, { role, type, version: x.version, proposal });
test("fixed complete plan: guest consent confirms the same version", () => {
  const x = M.create(sample);
  assert.equal(M.status(x), "waiting");
  assert.equal(M.status(change(x, "guest", "confirm")), "confirmed");
});
test("candidate selection needs the other party and repeated proposer confirmation cannot supply it", () => {
  let x = M.create({ ...sample, mode: "flexible" });
  x = change(x, "guest", "propose", {
    ...sample.options[1],
    place: sample.place,
    activity: sample.activity,
  });
  assert.equal(M.status(x), "host_review");
  x = change(x, "guest", "confirm");
  assert.equal(M.status(x), "host_review");
  assert.equal(M.status(change(x, "host", "confirm")), "confirmed");
});
test("incomplete place never counts as an agreed appointment; completing it creates a new proposal", () => {
  let x = M.create({ ...sample, place: "" });
  x = change(x, "guest", "confirm");
  assert.equal(M.status(x), "details");
  x = change(x, "host", "propose", { ...x.proposal, place: "新的集合地点" });
  assert.equal(M.status(x), "guest_review");
  assert.equal(M.status(change(x, "guest", "confirm")), "confirmed");
});
test("amendments invalidate old approvals and stale confirmations are rejected", () => {
  let x = change(M.create(sample), "guest", "confirm");
  const oldVersion = x.version;
  x = change(x, "host", "propose", { ...x.proposal, time: "17:00" });
  assert.equal(M.status(x), "guest_review");
  assert.equal(x.approvals.guest, null);
  assert.throws(
    () =>
      M.transition(x, { type: "confirm", role: "guest", version: oldVersion }),
    /已经更新/,
  );
  assert.equal(M.status(change(x, "guest", "confirm")), "confirmed");
});
test("declined invitation is terminal", () => {
  const x = change(M.create(sample), "guest", "decline");
  assert.equal(M.status(x), "declined");
  assert.throws(() => change(x, "host", "confirm"), /结束/);
});
test("confirmation is idempotent and does not mutate the original", () => {
  const x = M.create(sample);
  const y = change(x, "guest", "confirm");
  const z = change(y, "guest", "confirm");
  assert.deepEqual(y, z);
  assert.equal(x.approvals.guest, null);
  assert.throws(() => change(x, "stranger", "confirm"), /身份/);
});

test("the final guest response saves preferences in a new version that still needs the host", () => {
  const original = M.create({ ...sample, activity: "吃点好吃的" });
  const preferences = { hints: ["你来定"], detail: "西餐" };
  const response = change(original, "guest", "respond", {
    ...original.proposal,
    preferences,
  });
  assert.deepEqual(response.proposal.preferences, preferences);
  assert.equal(response.version, original.version + 1);
  assert.deepEqual(response.approvals, { host: null, guest: response.version });
  assert.equal(M.status(response), "host_review");
  assert.equal(M.status(change(response, "host", "confirm")), "confirmed");
  assert.deepEqual(original.proposal.preferences, { hints: [], detail: "" });
  preferences.hints.push("想多待一会儿");
  assert.deepEqual(response.proposal.preferences.hints, ["你来定"]);
  assert.throws(
    () => change(original, "host", "respond", original.proposal),
    /只有接收者/,
  );
  assert.throws(
    () => change(response, "guest", "respond", response.proposal),
    /已经回应/,
  );
  assert.throws(
    () =>
      M.transition(response, {
        role: "guest",
        type: "respond",
        version: original.version,
        proposal: response.proposal,
      }),
    /已经更新/,
  );
  assert.throws(
    () =>
      change(
        change(original, "guest", "decline"),
        "guest",
        "respond",
        original.proposal,
      ),
    /结束/,
  );
});

test("amending any schedule field preserves the activity and response preferences", () => {
  const original = M.create({
    ...sample,
    activity: "吃点好吃的",
    preferences: { hints: ["你来定"], detail: "西餐" },
  });
  const accepted = change(original, "guest", "respond", original.proposal);
  assert.equal(M.status(accepted), "confirmed");
  for (const patch of [
    { date: "2026-10-12" },
    { time: "19:00" },
    { place: "公园门口" },
  ]) {
    const next = change(accepted, "host", "propose", patch);
    assert.deepEqual(next.proposal, { ...accepted.proposal, ...patch });
    assert.equal(next.approvals.guest, null);
    assert.equal(M.status(next), "guest_review");
  }
});

test("activity changes clear the previous detail unless a replacement detail was supplied", () => {
  const base = M.create({
    ...sample,
    activity: "吃点好吃的",
    preferences: { hints: ["你来定"], detail: "西餐" },
  });
  for (const patch of [
    { activity: "散个步" },
    { activity: "散个步", preferences: { hints: ["你来定"] } },
  ]) {
    const next = change(base, "guest", "respond", patch);
    assert.equal(next.proposal.preferences.detail, "");
    assert.deepEqual(next.proposal.preferences.hints, ["你来定"]);
  }
  const next = change(base, "guest", "respond", {
    activity: "散个步",
    preferences: { detail: "沿着江边慢慢走" },
  });
  assert.deepEqual(next.proposal.preferences, {
    hints: ["你来定"],
    detail: "沿着江边慢慢走",
  });
});

test("informal hints never reinterpret or mutate the agreed date and time", () => {
  const base = M.create(sample);
  const next = change(base, "guest", "respond", {
    preferences: { hints: ["夜一点也行", "你来定"] },
  });
  assert.equal(next.proposal.date, base.proposal.date);
  assert.equal(next.proposal.time, base.proposal.time);
  assert.deepEqual(
    next.proposal.preferences.hints,
    ["夜一点也行", "你来定"].sort(),
  );
  assert.deepEqual(base.proposal.preferences.hints, []);
  assert.equal(M.status(next), "host_review");
});

test("legacy proposals normalize optional preferences and confirm unchanged responses without a revision", () => {
  const legacy = M.create(sample);
  delete legacy.proposal.preferences;
  const next = change(legacy, "guest", "respond", { ...legacy.proposal });
  assert.equal(next.version, legacy.version);
  assert.deepEqual(next.proposal.preferences, { hints: [], detail: "" });
  assert.equal(M.status(next), "confirmed");
  assert.equal(next.history.length, 0);
  assert.equal("preferences" in legacy.proposal, false);
  const candidate = M.create({ ...sample, mode: "flexible" });
  const selected = change(candidate, "guest", "respond", sample.options[1]);
  assert.deepEqual(
    selected.proposal,
    M.normalizeProposal({
      ...sample.options[1],
      place: sample.place,
      activity: sample.activity,
    }),
  );
  assert.equal(M.status(selected), "host_review");
});

const rangeResponse = () => ({
  date: "2099-10-10", time: "18:30", place: "  美术馆门口  ",
  activities: ["吃点好吃的", "喝杯咖啡"], activity: "",
  preferences: {
    hints: ["轻松随意就好"],
    details: { "吃点好吃的": "西餐", "喝杯咖啡": "安静的小店" },
  },
});
const openResponse = () => change(M.create({ from: "A", to: "B", mode: "open" }), "guest", "respond", rangeResponse());
const failsWith = (callback, code) => assert.throws(callback, (error) => error instanceof M.RuleError && error.code === code);

test("range responses need a host selection for both open and legacy invitations", () => {
  const open = M.create({ ...sample, mode: "open" });
  assert.deepEqual(open.options, []);
  assert.equal(open.place, "");
  assert.equal(open.activity, "");
  assert.equal(open.proposal, null);
  assert.deepEqual(open.approvals, { host: null, guest: null });
  assert.equal(M.status(open), "waiting");
  for (const mode of ["open", "fixed", "flexible"]) {
    const original = M.create({ ...sample, mode });
    const proposal = rangeResponse();
    const response = change(original, "guest", "respond", proposal);
    assert.equal(response.version, original.version + 1, mode);
    assert.equal(response.proposal.place, "美术馆门口");
    assert.equal(response.proposal.activity, "");
    assert.equal(M.complete(response.proposal), false);
    assert.equal(M.status(response), "host_review");
    assert.deepEqual(response.approvals, { host: null, guest: response.version });
    assert.deepEqual(response.proposal.preferences.details, { "吃点好吃的": ["西餐"], "喝杯咖啡": ["安静的小店"] });
    for (const role of ["host", "guest"])
      failsWith(() => change(response, role, "confirm"), "ACTIVITY_SELECTION_REQUIRED");
    proposal.activities.push("散个步");
    proposal.preferences.details["吃点好吃的"] = "火锅";
    assert.equal(response.proposal.activities.length, 2);
    assert.deepEqual(response.proposal.preferences.details["吃点好吃的"], ["西餐"]);
  }
});

test("range consent requires a complete schedule and correctly attached preferences", () => {
  const original = M.create({ mode: "open" });
  const invalid = [
    [{ activities: [] }, "INVALID_INPUT"],
    [{ activities: "吃点好吃的" }, "INVALID_INPUT"],
    [{ date: "" }, "INVALID_INPUT"],
    [{ time: "" }, "INVALID_INPUT"],
    [{ place: "  " }, "INVALID_INPUT"],
    [{ activity: "吃点好吃的" }, "INVALID_ACTIVITY_SELECTION"],
    [{ preferences: { details: { "散个步": "公园慢慢走" } } }, "INVALID_INPUT"],
    [{ preferences: { details: { "吃点好吃的": 1 } } }, "INVALID_INPUT"],
  ];
  for (const [patch, code] of invalid)
    failsWith(() => change(original, "guest", "respond", { ...rangeResponse(), ...patch }), code);
  const proposal = rangeResponse();
  delete proposal.activities;
  failsWith(() => change(original, "guest", "respond", proposal), "INVALID_INPUT");
  const minimal = change(original, "guest", "respond", {
    date: "2099-10-10", time: "18:30", place: "美术馆门口", activities: ["散个步"],
  });
  assert.deepEqual(minimal.proposal.preferences, { hints: [], details: { "散个步": [] }, detail: "" });
  assert.deepEqual(M.normalizeProposal(minimal.proposal), minimal.proposal);
});

test("only a host subset selection at an unchanged schedule may inherit guest consent", () => {
  const response = openResponse();
  const original = JSON.parse(JSON.stringify(response));
  const finalized = change(response, "host", "finalize", { activity: "吃点好吃的" });
  assert.equal(finalized.version, response.version + 1);
  assert.equal(M.status(finalized), "confirmed");
  assert.equal(M.complete(finalized.proposal), true);
  assert.equal(finalized.proposal.activity, "吃点好吃的");
  assert.equal(finalized.proposal.preferences.detail, "西餐");
  assert.deepEqual(finalized.proposal.activities, response.proposal.activities);
  assert.deepEqual(finalized.proposal.preferences.details, response.proposal.preferences.details);
  for (const field of ["date", "time", "place"])
    assert.equal(finalized.proposal[field], response.proposal[field]);
  assert.deepEqual(finalized.approvals, { host: finalized.version, guest: finalized.version });
  assert.deepEqual(finalized.history.at(-1), {
    version: response.version, proposal: response.proposal, approvals: response.approvals,
  });
  assert.deepEqual(response, original);
  failsWith(() => change(response, "guest", "finalize", { activity: "吃点好吃的" }), "INVALID_ROLE");
  failsWith(() => change(response, "host", "finalize", { activity: "散个步" }), "INVALID_ACTIVITY_SELECTION");
  failsWith(() => change(finalized, "host", "finalize", { activity: "喝杯咖啡" }), "FINALIZATION_NOT_ALLOWED");
  for (const patch of [{ date: "2099-10-11" }, { time: "19:00" }, { place: "别处" }, { activities: ["吃点好吃的"] }, { preferences: {} }])
    failsWith(() => change(response, "host", "finalize", { activity: "吃点好吃的", ...patch }), "INVALID_INPUT");
  failsWith(() => change({ ...response, approvals: { host: null, guest: null } }, "host", "finalize", { activity: "吃点好吃的" }), "FINALIZATION_NOT_ALLOWED");
  failsWith(() => M.transition(finalized, { role: "host", type: "finalize", version: response.version, proposal: { activity: "吃点好吃的" } }), "STALE_VERSION");
  assert.deepEqual(change(finalized, "guest", "confirm"), finalized);
});

test("host amendments preserve guest scope and always require a fresh guest confirmation", () => {
  const response = openResponse();
  failsWith(() => change(response, "host", "propose", { time: "19:00" }), "ACTIVITY_SELECTION_REQUIRED");
  const finalized = change(response, "host", "finalize", { activity: "吃点好吃的" });
  for (const before of [response, finalized]) {
    for (const patch of [{ date: "2099-10-11" }, { time: "19:00" }, { place: "公园门口" }]) {
      const next = change(before, "host", "propose", { ...patch, activity: "吃点好吃的" });
      assert.equal(M.status(next), "guest_review");
      assert.equal(next.approvals.guest, null);
      assert.deepEqual(next.proposal.activities, before.proposal.activities);
      assert.deepEqual(next.proposal.preferences.details, before.proposal.preferences.details);
      assert.equal(next.proposal.preferences.detail, "西餐");
      failsWith(() => M.transition(next, { type: "confirm", role: "guest", version: before.version }), "STALE_VERSION");
      assert.equal(M.status(change(next, "guest", "confirm")), "confirmed");
    }
  }
  for (const patch of [
    { activities: ["吃点好吃的"] },
    { activities: ["吃点好吃的", "喝杯咖啡", "散个步"] },
    { preferences: { details: { "吃点好吃的": "火锅" } } },
    { preferences: { hints: [] } },
    { activity: "散个步" },
  ]) failsWith(() => change(finalized, "host", "propose", patch), "INVALID_ACTIVITY_SELECTION");
  const coffee = change(finalized, "host", "propose", { activity: "喝杯咖啡" });
  assert.equal(coffee.proposal.preferences.detail, "安静的小店");
  assert.equal(coffee.approvals.guest, null);
});

test("guest range edits reopen host selection while schedule edits preserve the selected activity", () => {
  const response = openResponse();
  const finalized = change(response, "host", "finalize", { activity: "吃点好吃的" });
  for (const patch of [
    { activities: ["喝杯咖啡"] },
    { activities: ["吃点好吃的", "喝杯咖啡", "散个步"] },
    { preferences: { details: { "吃点好吃的": "火锅" } } },
  ]) {
    const next = change(finalized, "guest", "propose", patch);
    assert.equal(next.proposal.activity, "");
    assert.equal(next.proposal.preferences.detail, "");
    assert.equal(next.approvals.host, null);
    assert.equal(M.status(next), "host_review");
    failsWith(() => change(next, "host", "confirm"), "ACTIVITY_SELECTION_REQUIRED");
    assert.equal(M.status(change(next, "host", "finalize", { activity: next.proposal.activities[0] })), "confirmed");
  }
  for (const patch of [{ date: "2099-10-11" }, { time: "19:00" }, { place: "公园门口" }]) {
    const next = change(finalized, "guest", "propose", patch);
    assert.equal(next.proposal.activity, "吃点好吃的");
    assert.deepEqual(next.proposal.preferences, finalized.proposal.preferences);
    assert.equal(next.approvals.host, null);
    assert.equal(M.status(next), "host_review");
    assert.equal(M.status(change(next, "host", "confirm")), "confirmed");
  }
  failsWith(() => change(response, "guest", "propose", { activity: "喝杯咖啡" }), "INVALID_ACTIVITY_SELECTION");
  failsWith(() => change(finalized, "guest", "propose", { activity: "喝杯咖啡" }), "INVALID_ACTIVITY_SELECTION");
  failsWith(() => change(finalized, "guest", "propose", { activity: "吃点好吃的", activities: ["吃点好吃的"] }), "INVALID_ACTIVITY_SELECTION");
});

test("activity details are independent normalized sets and finalizing preserves every choice", () => {
  const proposal = rangeResponse();
  proposal.preferences.details = {
    "吃点好吃的": ["西餐", " 日料 ", "西餐", "火锅"],
    "喝杯咖啡": ["安静的小店", "咖啡加甜品"],
  };
  const saved = JSON.parse(JSON.stringify(proposal));
  const response = change(M.create({ mode: "open" }), "guest", "respond", proposal);
  const details = {
    "吃点好吃的": ["西餐", "日料", "火锅"].sort(),
    "喝杯咖啡": ["安静的小店", "咖啡加甜品"].sort(),
  };
  assert.deepEqual(response.proposal.preferences.details, details);
  assert.equal(response.proposal.preferences.detail, "");
  assert.deepEqual(proposal, saved);
  for (const activity of proposal.activities) {
    const final = change(response, "host", "finalize", { activity });
    assert.equal(M.status(final), "confirmed");
    assert.deepEqual(final.proposal.preferences.details, details);
    assert.equal(final.proposal.preferences.detail, details[activity].join("、"));
    assert.deepEqual(M.normalizeProposal(final.proposal), final.proposal);
    assert.deepEqual(final.history.at(-1).proposal.preferences.details, details);
    assert.deepEqual(final.approvals, { host: final.version, guest: final.version });
  }
  proposal.preferences.details["吃点好吃的"].push("烤肉");
  assert.deepEqual(response.proposal.preferences.details, details);
  for (const invalid of [null, {}, 1, [1], [""], ["  "], Array(10).fill("西餐")])
    failsWith(() => M.normalizeProposal({ ...saved, preferences: { details: { "吃点好吃的": invalid } } }), "INVALID_INPUT");
  const nine = ["日料", "烤肉", "粤菜", "火锅", "烧烤", "西餐", "轻食", "甜品咖啡", "你来推荐"];
  assert.deepEqual(M.normalizeProposal({ ...saved, preferences: { details: { "吃点好吃的": nine } } }).preferences.details["吃点好吃的"], nine.slice().sort());
});

test("old scalar range details normalize without changing their consent or legacy single-choice shape", () => {
  const oldPending = openResponse();
  oldPending.proposal.preferences.details = { "吃点好吃的": "西餐", "喝杯咖啡": "" };
  const final = change(oldPending, "host", "finalize", { activity: "吃点好吃的" });
  assert.deepEqual(final.proposal.preferences.details, { "吃点好吃的": ["西餐"], "喝杯咖啡": [] });
  assert.equal(final.proposal.preferences.detail, "西餐");
  const oldFinal = JSON.parse(JSON.stringify(final));
  oldFinal.proposal.preferences.details = { "吃点好吃的": "西餐", "喝杯咖啡": "" };
  assert.deepEqual(M.normalizeProposal(oldFinal.proposal), final.proposal);
  for (const role of ["host", "guest"]) {
    const next = change(oldFinal, role, "propose", {
      time: "19:00", preferences: { details: { "吃点好吃的": ["西餐", "西餐"], "喝杯咖啡": [] } },
    });
    assert.equal(next.proposal.activity, "吃点好吃的");
    assert.equal(next.proposal.preferences.detail, "西餐");
    assert.deepEqual(next.proposal.preferences.details, final.proposal.preferences.details);
    assert.equal(next.approvals[role === "host" ? "guest" : "host"], null);
    assert.equal(M.status(change(next, role === "host" ? "guest" : "host", "confirm")), "confirmed");
  }
  const empty = M.normalizeProposal({ ...oldFinal.proposal, activity: "喝杯咖啡", preferences: { ...oldFinal.proposal.preferences, detail: "" } });
  assert.deepEqual(empty.preferences.details["喝杯咖啡"], []);
  assert.equal(empty.preferences.detail, "");
  failsWith(() => M.normalizeProposal({ ...oldFinal.proposal, preferences: { ...oldFinal.proposal.preferences, detail: "日料" } }), "INVALID_INPUT");
  const legacy = M.normalizeProposal({ ...sample.options[0], place: sample.place, activity: sample.activity, preferences: { detail: "安静的小店" } });
  assert.deepEqual(legacy.preferences, { hints: [], detail: "安静的小店" });
  assert.equal("activities" in legacy, false);
  assert.equal("details" in legacy.preferences, false);
});

test("detail-set membership is guest consent: host edits fail and guest edits reopen finalization", () => {
  const proposal = rangeResponse();
  proposal.preferences.details["吃点好吃的"] = ["日料", "西餐"];
  const response = change(M.create({ mode: "open" }), "guest", "respond", proposal);
  const final = change(response, "host", "finalize", { activity: "吃点好吃的" });
  for (const choices of [["日料"], ["日料", "西餐", "火锅"], []]) {
    const patch = { preferences: { details: { "吃点好吃的": choices } } };
    failsWith(() => change(final, "host", "propose", patch), "INVALID_ACTIVITY_SELECTION");
    const next = change(final, "guest", "propose", patch);
    assert.equal(next.proposal.activity, "");
    assert.equal(next.proposal.preferences.detail, "");
    assert.deepEqual(next.proposal.preferences.details["吃点好吃的"], choices.slice().sort());
    assert.deepEqual(next.proposal.preferences.details["喝杯咖啡"], final.proposal.preferences.details["喝杯咖啡"]);
    assert.deepEqual(next.approvals, { host: null, guest: next.version });
    failsWith(() => change(next, "host", "confirm"), "ACTIVITY_SELECTION_REQUIRED");
    const refinalized = change(next, "host", "finalize", { activity: "吃点好吃的" });
    assert.equal(M.status(refinalized), "confirmed");
    assert.equal(refinalized.proposal.preferences.detail, choices.slice().sort().join("、"));
  }
  for (const role of ["host", "guest"]) {
    const equivalent = change(final, role, "propose", { preferences: { details: { "吃点好吃的": [" 西餐 ", "日料", "西餐"] } } });
    assert.equal(equivalent.proposal.activity, "吃点好吃的");
    assert.deepEqual(equivalent.proposal.preferences, final.proposal.preferences);
  }
  failsWith(() => M.normalizeProposal({ ...final.proposal, preferences: { ...final.proposal.preferences, detail: "日料" } }), "INVALID_INPUT");
});

const fullPlan = () => ({
  timeOptions: [{ date: "2099-10-10", time: "18:30" }, { date: "2099-10-11", time: "15:00" }],
  placeOptions: ["美术馆门口", "公园南门"],
  activities: ["吃点好吃的", "喝杯咖啡"],
  preferences: { hints: ["轻松随意就好"], details: { "吃点好吃的": ["日料", "西餐"], "喝杯咖啡": ["安静的小店"] } },
});
const fullSelection = () => ({ date: "2099-10-10", time: "18:30", place: "美术馆门口", activity: "吃点好吃的", detail: "西餐" });
const offered = (mode, plan = fullPlan()) => mode === "host"
  ? M.create({ mode, from: "A", to: "B", plan })
  : change(M.create({ mode }), "guest", "respond", plan);

test("full scopes work in both directions and only singleton offers support direct acceptance", () => {
  const plan = fullPlan();
  plan.timeOptions = [plan.timeOptions[0]];
  plan.placeOptions = [plan.placeOptions[0]];
  plan.activities = ["吃点好吃的"];
  for (const details of [["西餐"], []]) {
    plan.preferences.details = { "吃点好吃的": details };
    for (const mode of ["host", "open"]) {
      const x = offered(mode, plan), owner = mode === "host" ? "host" : "guest", chooser = owner === "host" ? "guest" : "host";
      assert.equal(M.scopeOwner(x), owner);
      assert.equal(M.isFullRange(x.proposal), true);
      assert.equal(M.complete(x.proposal), true);
      assert.equal(x.proposal.preferences.detail, details[0] || "");
      assert.equal(M.status(x), mode === "host" ? "waiting" : "host_review");
      assert.equal(x.approvals[owner], x.version);
      assert.equal(x.approvals[chooser], null);
      assert.equal(x.responded, mode !== "host");
      assert.equal(M.status(change(x, owner, "confirm")), M.status(x));
      const accepted = change(x, chooser, "confirm");
      assert.equal(M.status(accepted), "confirmed");
      assert.equal(accepted.version, x.version);
      assert.equal(accepted.responded, true);
      assert.deepEqual(change(accepted, chooser, "confirm"), accepted);
    }
  }
  for (const mode of ["host", "open"]) {
    const x = offered(mode);
    assert.equal(M.complete(x.proposal), false);
    for (const role of ["host", "guest"])
      failsWith(() => change(x, role, "confirm"), "ACTIVITY_SELECTION_REQUIRED");
  }
});

test("full-scope finalization checks every dimension and inherits only the current author's consent", () => {
  for (const mode of ["host", "open"]) {
    const x = offered(mode), owner = M.scopeOwner(x), chooser = owner === "host" ? "guest" : "host";
    const before = JSON.parse(JSON.stringify(x));
    const final = change(x, chooser, "finalize", fullSelection());
    assert.equal(M.status(final), "confirmed");
    assert.equal(final.version, x.version + 1);
    assert.equal(final.proposal.preferences.detail, "西餐");
    assert.deepEqual(final.proposal.preferences.details, x.proposal.preferences.details);
    assert.deepEqual(final.proposal.timeOptions, x.proposal.timeOptions);
    assert.deepEqual(final.proposal.placeOptions, x.proposal.placeOptions);
    assert.deepEqual(final.approvals, { host: final.version, guest: final.version });
    assert.deepEqual(x, before);
    assert.deepEqual(final.history.at(-1).proposal, x.proposal);
    failsWith(() => change(x, owner, "finalize", fullSelection()), "INVALID_ROLE");
    failsWith(() => change(final, chooser, "finalize", fullSelection()), "FINALIZATION_NOT_ALLOWED");
    failsWith(() => change({ ...x, approvals: { host: null, guest: null } }, chooser, "finalize", fullSelection()), "FINALIZATION_NOT_ALLOWED");
    failsWith(() => M.transition(final, { role: chooser, type: "finalize", version: x.version, proposal: fullSelection() }), "STALE_VERSION");
    for (const patch of [
      { date: "2099-10-11" }, // A date and time from different slots are not an accepted pair.
      { time: "19:00" }, { place: "其他地点" }, { activity: "散个步" }, { detail: "火锅" },
    ]) failsWith(() => change(x, chooser, "finalize", { ...fullSelection(), ...patch }), "INVALID_ACTIVITY_SELECTION");
    for (const key of ["date", "time", "place", "activity", "detail"]) {
      const selection = fullSelection(); delete selection[key];
      failsWith(() => change(x, chooser, "finalize", selection), "ACTIVITY_SELECTION_REQUIRED");
    }
    for (const key of ["preferences", "timeOptions", "placeOptions", "activities", "scopeOwner"])
      failsWith(() => change(x, chooser, "finalize", { ...fullSelection(), [key]: [] }), "INVALID_INPUT");
    const coffee = change(x, chooser, "finalize", { ...fullSelection(), activity: "喝杯咖啡", detail: "安静的小店" });
    assert.equal(coffee.proposal.preferences.detail, "安静的小店");
  }
});

test("a new offer resets choices without granting authors the other person's decision", () => {
  for (const mode of ["host", "open"]) {
    const x = offered(mode), owner = M.scopeOwner(x), chooser = owner === "host" ? "guest" : "host";
    failsWith(() => change(x, chooser, "propose", { date: "2099-10-12", time: "19:00", place: "新地点" }), "FINALIZATION_NOT_ALLOWED");
    for (const patch of [
      { timeOptions: [{ date: "2099-10-12", time: "19:00" }] },
      { placeOptions: ["新地点"] },
      { activities: ["吃点好吃的"] },
      { preferences: { details: { "吃点好吃的": ["火锅"] } } },
    ]) {
      failsWith(() => change(x, chooser, "propose", patch), "INVALID_ACTIVITY_SELECTION");
      const next = change(x, owner, "propose", patch);
      assert.equal(next.approvals[chooser], null);
      assert.equal(next.approvals[owner], next.version);
      assert.equal(M.status(next), mode === "host" ? "waiting" : "host_review");
      assert.equal(next.responded, mode !== "host");
    }
    const final = change(x, chooser, "finalize", fullSelection());
    const reopened = change(final, owner, "propose", { preferences: { details: { "吃点好吃的": ["日料", "火锅"] } } });
    assert.equal(reopened.proposal.activity, "");
    assert.equal(reopened.proposal.preferences.detail, "");
    assert.equal(reopened.approvals[chooser], null);
    failsWith(() => change(reopened, chooser, "confirm"), "ACTIVITY_SELECTION_REQUIRED");
    assert.equal(M.status(change(reopened, chooser, "finalize", { ...fullSelection(), detail: "火锅" })), "confirmed");
  }
  failsWith(() => change(offered("host"), "guest", "respond", fullPlan()), "INVALID_ROLE");
  for (const patch of [{ date: "2099-10-10" }, { activity: "吃点好吃的" }, { scopeOwner: "guest" }])
    failsWith(() => M.create({ mode: "host", plan: { ...fullPlan(), ...patch } }), "INVALID_INPUT");
});

test("rescheduling a selected full plan keeps its activity and detail but needs the other person again", () => {
  for (const mode of ["host", "open"]) {
    const x = offered(mode), chooser = M.scopeOwner(x) === "host" ? "guest" : "host";
    const final = change(x, chooser, "finalize", fullSelection());
    for (const role of ["host", "guest"]) {
      const other = role === "host" ? "guest" : "host";
      const next = change(final, role, "propose", { date: "2099-10-12", time: "19:00", place: "新的见面地点" });
      assert.deepEqual(next.proposal.timeOptions, [{ date: "2099-10-12", time: "19:00" }]);
      assert.deepEqual(next.proposal.placeOptions, ["新的见面地点"]);
      assert.deepEqual(next.proposal.preferences, final.proposal.preferences);
      assert.equal(next.proposal.activity, final.proposal.activity);
      assert.equal(next.approvals[other], null);
      assert.equal(next.approvals[role], next.version);
      assert.equal(M.status(next), other === "host" ? "host_review" : "guest_review");
      failsWith(() => M.transition(next, { type: "confirm", role: other, version: final.version }), "STALE_VERSION");
      assert.equal(M.status(change(next, other, "confirm")), "confirmed");
      failsWith(() => change(final, role, "propose", { date: "2099-10-12", activity: "喝杯咖啡" }), "INVALID_ACTIVITY_SELECTION");
      failsWith(() => change(final, role, "propose", { preferences: { detail: "日料" } }), "INVALID_ACTIVITY_SELECTION");
    }
  }
});

test("full ranges normalize bounded sets, infer only singleton choices, and leave old range semantics intact", () => {
  const singleton = fullPlan();
  singleton.timeOptions = [singleton.timeOptions[0]];
  singleton.placeOptions = [singleton.placeOptions[0]];
  singleton.activities = ["喝杯咖啡"];
  singleton.preferences.details = { "喝杯咖啡": ["安静的小店"] };
  const full = offered("host", singleton);
  const accepted = change(full, "guest", "finalize", {});
  assert.equal(M.status(accepted), "confirmed");
  assert.deepEqual(M.normalizeProposal(accepted.proposal), accepted.proposal);
  for (const patch of [
    { timeOptions: [] }, { timeOptions: Array(4).fill(singleton.timeOptions[0]) },
    { timeOptions: [{ date: "2099-10-10" }] }, { placeOptions: [] }, { placeOptions: [" "] },
    { placeOptions: ["a", "b", "c", "d"] }, { activities: [] },
  ]) failsWith(() => offered("host", { ...fullPlan(), ...patch }), "INVALID_INPUT");
  const withoutPlaces = fullPlan(); delete withoutPlaces.placeOptions;
  failsWith(() => offered("host", withoutPlaces), "INVALID_INPUT");
  const legacy = openResponse();
  const oldFinal = change(legacy, "host", "finalize", { activity: "吃点好吃的" });
  assert.equal(M.isFullRange(oldFinal.proposal), false);
  assert.equal(oldFinal.proposal.preferences.detail, "西餐");
  failsWith(() => change(legacy, "guest", "finalize", { activity: "吃点好吃的" }), "INVALID_ROLE");
  failsWith(() => change(legacy, "host", "finalize", { activity: "吃点好吃的", detail: "西餐" }), "INVALID_INPUT");
});

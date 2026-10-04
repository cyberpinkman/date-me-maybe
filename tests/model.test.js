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

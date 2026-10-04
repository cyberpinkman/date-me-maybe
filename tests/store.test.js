const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/model.js");
const makeStore = require("../src/store.js");
const draft = {
  mode: "fixed",
  from: "A",
  to: "B",
  place: "A店",
  activity: "咖啡",
  options: [{ date: "2026-10-10", time: "15:00" }],
};
const clone = (x) => JSON.parse(JSON.stringify(x));
function shared() {
  let rows = [],
    queue = Promise.resolve();
  const io = {
    model,
    read: () => clone(rows),
    write: (x) => {
      rows = clone(x);
    },
    lock: (fn) => {
      const p = queue.then(fn);
      queue = p.catch(() => {});
      return p;
    },
  };
  return [makeStore(io), makeStore(io)];
}
test("two tabs reject a stale confirmation instead of overwriting a newer proposal", async () => {
  const [a, b] = shared();
  const initial = await a.create(draft);
  const old = b.all()[0];
  await a.transition(initial.id, {
    type: "propose",
    role: "host",
    version: initial.version,
    proposal: { ...initial.proposal, place: "B店" },
  });
  await assert.rejects(
    b.transition(old.id, {
      type: "confirm",
      role: "guest",
      version: old.version,
    }),
    /已经更新/,
  );
  const latest = b.all()[0];
  assert.equal(latest.version, 2);
  assert.equal(latest.proposal.place, "B店");
  assert.equal(model.status(latest), "guest_review");
});
test("concurrent independent invitation creation preserves both records", async () => {
  const [a, b] = shared();
  await Promise.all([a.create(draft), b.create({ ...draft, to: "C" })]);
  assert.equal(a.all().length, 2);
  assert.deepEqual(
    a.all().map((x) => x.to),
    ["B", "C"],
  );
});
test("racing edits based on one revision commit only one new proposal", async () => {
  const [a, b] = shared();
  const x = await a.create(draft);
  const result = await Promise.allSettled([
    a.transition(x.id, {
      type: "propose",
      version: 1,
      role: "host",
      proposal: { ...x.proposal, place: "B店" },
    }),
    b.transition(x.id, {
      type: "propose",
      version: 1,
      role: "guest",
      proposal: { ...x.proposal, place: "C店" },
    }),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(a.all()[0].version, 2);
});

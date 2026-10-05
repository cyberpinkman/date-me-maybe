const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Model = require("../src/model.js");
const source = (name) => fs.readFileSync(path.join(__dirname, "../src", name + ".js"), "utf8");

test("an incomplete successful response retains the mutation's idempotency key", async () => {
  const requests = [];
  const context = vm.createContext({
    crypto,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 201,
        json: async () => {
          if (requests.length === 1) throw new SyntaxError("Unexpected end of JSON input");
          return { invitation: { id: "already-created" } };
        },
      };
    },
  });
  vm.runInContext(source("api-client"), context);
  const submit = () => vm.runInContext('InviteAPI.mutate("/api/invitations", {draft:{from:"A",to:"B"}})', context);
  await assert.rejects(submit(), (error) => error.network === true);
  assert.equal((await submit()).invitation.id, "already-created");
  assert.equal(requests[0].requestId, requests[1].requestId);
});

async function senderFixture() {
  const invitation = Model.create({
    id: "09d88932-64c6-4cb1-a24a-b06aa6adffed", from: "A", to: "B", message: "想见你",
    mode: "fixed", options: [{ date: "2099-10-07", time: "18:30" }],
    activity: "吃点好吃的", place: "公园",
  });
  const storage = new Map();
  const nodes = new Map([
    ["#root", { innerHTML: "" }], ["#toast-root", { innerHTML: "" }],
    ["#account-message", { textContent: "" }],
    ["#proposal-date", { value: "2099-10-08" }],
    ["#proposal-time", { value: "18:30" }], ["#proposal-place", { value: "咖啡店" }],
  ]);
  const context = vm.createContext({
    document: { body: { dataset: {} }, querySelector: (s) => nodes.get(s) || null, querySelectorAll: () => [], addEventListener() {} },
    window: { scrollTo() {} }, location: { pathname: "/", search: "", origin: "http://localhost" },
    history: { replaceState() {} },
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    crypto, URLSearchParams, setInterval() {}, setTimeout() {}, clearTimeout() {},
    matchMedia: () => ({ matches: true }),
    fetch: async (url) => {
      const expired = url.endsWith("/actions");
      return { ok: !expired, status: expired ? 401 : 200, json: async () => {
        if (url === "/api/config") return { emailOtpEnabled: true };
        if (url === "/api/session") return { user: { id: "A" } };
        if (url === "/api/invitations") return { invitations: [invitation] };
        return expired ? { error: { code: "AUTH_REQUIRED", message: "请先登录" } } : {};
      } };
    },
  });
  for (const name of ["model", "runaway", "journey", "api-client", "account", "card-export", "schedule", "app"]) vm.runInContext(source(name), context);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  vm.runInContext(`
    draft.from = "未发送的心意";
    draft.message = "这份草稿要保留";
    step = 1;
    saveCreationDraft();
    currentId = "${invitation.id}";
    view = "host";
    modal = {type:"proposal", version:1};
    hostActivitySelection = {id:currentId, version:1, activity:"吃点好吃的"};
    loginEmail = "a@example.test";
    loginOtp = "123456";
    otpSent = true;
    mailboxEmails = [{email:loginEmail,otp:loginOtp}];
    calendarData = {busy:[{label:"私人的安排"}]}; calendarDraft = {timeZone:"Asia/Shanghai"};
    availabilityData = {slots:[{date:"2099-10-08",time:"18:30"}]}; availabilityInvitationId = currentId;
  `, context);
  return { context, storage };
}

test("logout and expired-session recovery clear identity-scoped state without losing the creation draft", async (t) => {
  for (const action of ["logout", "submit-proposal"]) {
    await t.test(action, async () => {
      const { context, storage } = await senderFixture();
      await vm.runInContext(`action(${JSON.stringify(action)}, {tagName:"BUTTON"})`, context);
      const state = JSON.parse(vm.runInContext(`JSON.stringify({sessionUser,invitations,currentId,modal,hostActivitySelection,guestJourney,loginEmail,loginOtp,otpSent,mailboxEmails,calendarData,calendarDraft,availabilityData,availabilityInvitationId,view,draft,step})`, context));
      for (const field of ["sessionUser", "currentId", "modal", "hostActivitySelection", "guestJourney", "mailboxEmails", "calendarData", "calendarDraft", "availabilityData", "availabilityInvitationId"]) assert.equal(state[field], null, field);
      assert.deepEqual(state.invitations, []);
      assert.equal(state.loginEmail, "");
      assert.equal(state.loginOtp, "");
      assert.equal(state.otpSent, false);
      assert.equal(state.view, action === "logout" ? "create" : "account");
      assert.equal(state.draft.message, "这份草稿要保留");
      assert.equal(state.step, 1);
      assert.equal(JSON.parse(storage.get("opendater-creation-draft-v1")).draft.message, "这份草稿要保留");
    });
  }
});

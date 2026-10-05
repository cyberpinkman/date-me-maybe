/* Sender accounts; recipient links never depend on an account. */
let appConfig = { googleEnabled: false, emailOtpEnabled: false, devMailbox: false },
  sessionUser = null,
  accountIntent = "list",
  loginEmail = "",
  loginOtp = "",
  otpSent = false,
  accountMessage = "",
  mailboxEmails = null;
const draftStorageKey = "opendater-creation-draft-v1";
function saveCreationDraft(intent = "create") {
  try {
    sessionStorage.setItem(draftStorageKey, JSON.stringify({ draft, step, intent }));
  } catch {}
}
function restoreCreationDraft() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftStorageKey) || "null");
    if (saved?.draft && typeof saved.draft === "object") {
      const restored = defaultDraft();
      for (const key of ["from", "to", "tone", "message"]) {
        if (typeof saved.draft[key] === "string") restored[key] = saved.draft[key];
      }
      restored.mode = saved.draft.mode === "host" ? "host" : "open";
      const plan = saved.draft.plan;
      if (plan && typeof plan === "object") {
        if(Array.isArray(plan.timeOptions) && plan.timeOptions.length) restored.plan.timeOptions=plan.timeOptions.slice(0,3).map(slot=>({date:typeof slot?.date==="string"?slot.date:"",time:typeof slot?.time==="string"?slot.time:""}));
        if(Array.isArray(plan.placeOptions) && plan.placeOptions.length) restored.plan.placeOptions=plan.placeOptions.slice(0,3).map(place=>typeof place==="string"?place:"");
        if(Array.isArray(plan.activities)) restored.plan.activities=[...new Set(plan.activities.filter(activity=>activities.some(item=>item[0]===activity)))];
        restored.plan.preferences.hints=Array.isArray(plan.preferences?.hints)?plan.preferences.hints.filter(hint=>sceneHints.includes(hint)):[];
        for(const activity of activities.map(item=>item[0])) restored.plan.preferences.details[activity]=detailChoices(plan.preferences?.details?.[activity]).filter(detail=>sceneDetails[activity].items.some(item=>item[1]===detail));
      }
      draft = restored;
      step = Math.max(0, Math.min(creationSteps().length-1, Number(saved.step) || 0));
      accountIntent = saved.intent === "list" ? "list" : "create";
      return true;
    }
  } catch {}
  return false;
}
// An account transition invalidates every identity-scoped view together.
// The creation draft belongs to this editing session and deliberately survives.
function resetSenderIdentity() {
  disposeCardExport(modal);
  sessionUser = null;
  invitations = [];
  currentId = null;
  modal = null;
  priorFocus = null;
  guestJourney = null;
  hostActivitySelection = null;
  role = "host";
  loginEmail = "";
  loginOtp = "";
  otpSent = false;
  accountMessage = "";
  mailboxEmails = null;
  accountIntent = "list";
}
function requireAccount(intent) {
  if (sessionUser) return true;
  accountIntent = intent;
  saveCreationDraft(intent);
  view = "account";
  accountMessage = "";
  return false;
}
function accountView() {
  return `<section class="account-wrap"><div class="account-card"><p class="eyebrow">KEEP YOUR LITTLE INVITATIONS</p><h1>${accountIntent === "create" ? "把这份心意，<br>好好收进你的账户。" : "你的每一份心意，<br>都在这里。"}</h1><p class="sub">登录后，把邀请发给心里的那个人。<br>TA 的回应，也会替你好好收着。</p>${appConfig.googleEnabled ? '<button class="btn wide google-button" data-action="login-google"><span class="google-letter" aria-hidden="true">G</span>使用 Google 继续</button>' : ""}${appConfig.googleEnabled && appConfig.emailOtpEnabled ? '<div class="account-divider">或者用邮箱</div>' : ""}${appConfig.emailOtpEnabled ? `<form id="email-login-form"><div class="field"><label class="label" for="login-email">邮箱地址</label><input id="login-email" type="email" autocomplete="email" maxlength="254" value="${esc(loginEmail)}" placeholder="you@example.com" required ${otpSent ? "readonly" : ""}></div>${otpSent ? `<div class="field"><label class="label" for="login-otp">邮件里的验证码</label><input id="login-otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" value="${esc(loginOtp)}" placeholder="6 位数字" required></div><button type="submit" class="btn primary wide">登录并继续 ${icon("arrow")}</button><div class="account-secondary"><button type="button" class="text-btn" data-action="otp-reset">换个邮箱</button><button type="button" class="text-btn" data-action="otp-resend">重新发送</button></div>` : `<button type="submit" class="btn primary wide">发送登录验证码 ${icon("arrow")}</button>`}</form>` : ""}${!appConfig.googleEnabled && !appConfig.emailOtpEnabled ? '<div class="note-box">暂时还不能登录，先把心意写好，稍后再来吧。</div>' : ""}<p id="account-message" class="account-message" role="status">${esc(accountMessage)}</p>${appConfig.devMailbox ? `<div class="dev-mailbox"><strong>本地验收模式</strong><p>验证码只进入本地测试邮件箱，不会发送真实邮件。可使用 a@example.test、c@example.test。</p><button class="text-btn" data-action="dev-mailbox">本地测试邮件箱</button>${mailboxEmails ? `<ul>${mailboxEmails.length ? mailboxEmails.slice(-8).reverse().map((m) => `<li><span>${esc(m.email)}</span><code>${esc(m.otp)}</code></li>`).join("") : "<li>还没有测试邮件</li>"}</ul>` : ""}</div>` : ""}<button class="text-btn account-back" data-action="home">${icon("back", 15)} 回去继续写邀请</button></div></section>`;
}
function bindAccount() {
  $("#login-email")?.addEventListener("input", (event) => { loginEmail = event.target.value; });
  $("#login-otp")?.addEventListener("input", (event) => { loginOtp = event.target.value; });
  $("#email-login-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    action(otpSent ? "login-otp" : "otp-send", event.submitter);
  });
}
async function finishLogin() {
  sessionUser = (await InviteAPI.get("/api/session")).user;
  if (!sessionUser) throw InviteAPI.userError("登录还没完成，请再试一次。");
  await refreshInvitations();
  otpSent = false;
  loginOtp = "";
  accountMessage = "";
  view = accountIntent === "create" ? "create" : "list";
  // Returning to the review step leaves sending as an explicit sender action.
  saveCreationDraft(accountIntent);
}
async function accountAction(actionName) {
  if (actionName === "login-google") {
    saveCreationDraft(accountIntent);
    const result = await InviteAPI.post("/api/auth/sign-in/social", {
      provider: "google", callbackURL: location.origin + "/?login=complete", disableRedirect: true,
    });
    if (!result.url) throw InviteAPI.userError("Google 登录暂时不可用，请稍后再试。");
    location.assign(result.url);
  } else if (actionName === "otp-send" || actionName === "otp-resend") {
    loginEmail = loginEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) throw InviteAPI.userError("请填写完整的邮箱地址。");
    await InviteAPI.post("/api/auth/email-otp/send-verification-otp", { email: loginEmail, type: "sign-in" });
    otpSent = true;
    accountMessage = appConfig.devMailbox ? "验证码已放入下方的本地测试邮件箱。" : "验证码已发出，请查看邮箱。";
    mailboxEmails = null;
  } else if (actionName === "otp-reset") {
    otpSent = false;
    loginOtp = "";
    accountMessage = "";
  } else if (actionName === "login-otp") {
    if (!/^\d{6}$/.test(loginOtp.trim())) throw InviteAPI.userError("请输入邮件里的 6 位验证码。");
    await InviteAPI.post("/api/auth/sign-in/email-otp", { email: loginEmail.trim(), otp: loginOtp.trim() });
    await finishLogin();
  } else if (actionName === "dev-mailbox") {
    mailboxEmails = (await InviteAPI.get("/api/dev/mailbox")).emails || [];
  } else if (actionName === "logout") {
    await InviteAPI.post("/api/auth/sign-out", {});
    resetSenderIdentity();
    view = "create";
    history.replaceState(null, "", "/");
  } else return false;
  return true;
}

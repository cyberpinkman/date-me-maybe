const InviteModel = (() => {
  class RuleError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "RuleError";
      this.code = code;
    }
  }
  const fail = (code, message) => { throw new RuleError(code, message); };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const provided = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined;
  const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const ranged = (proposal) => !!proposal && provided(proposal, "activities");
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // An activity range is the guest's consent, not a finalized arrangement.
  // Legacy proposals retain their shape. Each range detail belongs to its activity.
  function normalizeProposal(patch = {}, previous = {}) {
    patch = patch || {};
    previous = previous || {};
    if (!object(patch) || !object(previous))
      fail("INVALID_INPUT", "见面安排的格式不正确");
    const preferences = patch.preferences ?? {}, priorPreferences = previous.preferences ?? {};
    if (!object(preferences) || !object(priorPreferences))
      fail("INVALID_INPUT", "小暗示和场景偏好的格式不正确");
    const value = (key) => {
      const result = provided(patch, key) ? patch[key] : (previous[key] ?? "");
      if (typeof result !== "string") fail("INVALID_INPUT", "见面安排的格式不正确");
      return result.trim();
    };
    const hints = provided(preferences, "hints") ? preferences.hints : priorPreferences.hints || [];
    if (!Array.isArray(hints) || hints.some((hint) => typeof hint !== "string"))
      fail("INVALID_INPUT", "小暗示和场景偏好的格式不正确");
    const common = { date: value("date"), time: value("time"), place: value("place") };
    const normalizedHints = [...new Set(hints)].sort();
    if (!ranged(patch) && !ranged(previous)) {
      const activity = value("activity");
      const detail = provided(preferences, "detail") ? preferences.detail
        : activity !== (previous.activity ?? "") ? "" : priorPreferences.detail || "";
      if (typeof detail !== "string") fail("INVALID_INPUT", "小暗示和场景偏好的格式不正确");
      return { ...common, activity, preferences: { hints: normalizedHints, detail } };
    }
    const inputActivities = ranged(patch) ? patch.activities : previous.activities;
    if (!Array.isArray(inputActivities) || !inputActivities.length || inputActivities.length > 6 ||
        inputActivities.some((activity) => typeof activity !== "string" || !activity.trim()))
      fail("INVALID_INPUT", "请至少选一项可以一起做的事，最多选择六项");
    const activities = [...new Set(inputActivities.map((activity) => activity.trim()))].sort();
    const priorDetails = priorPreferences.details ??
      (previous.activity && priorPreferences.detail ? { [previous.activity]: priorPreferences.detail } : {});
    const patchDetails = preferences.details ?? {};
    if (!object(priorDetails) || !object(patchDetails) ||
        Object.values(priorDetails).some((detail) => typeof detail !== "string") ||
        Object.entries(patchDetails).some(([activity, detail]) => !activities.includes(activity) || typeof detail !== "string"))
      fail("INVALID_INPUT", "请把小安排填写在对应的活动里");
    const details = Object.fromEntries(activities.map((activity) => [
      activity, provided(patchDetails, activity) ? patchDetails[activity]
        : provided(priorDetails, activity) ? priorDetails[activity] : "",
    ]));
    // A legacy choice must not become the host's final choice for a new range.
    let activity = !provided(patch, "activity") && ranged(patch) && !ranged(previous) ? "" : value("activity");
    if (!provided(patch, "activity") && !activities.includes(activity)) activity = "";
    if (activity && !activities.includes(activity))
      fail("INVALID_ACTIVITY_SELECTION", "请从对方可以接受的活动里选择");
    if (provided(preferences, "detail")) {
      if (typeof preferences.detail !== "string" || (!activity && preferences.detail))
        fail("INVALID_INPUT", "请把小安排填写在对应的活动里");
      // The old field is a display alias, not an alternative way to change consent.
      if (activity && preferences.detail !== details[activity])
        fail("INVALID_INPUT", "小安排与所选活动不一致");
    }
    return {
      ...common, activities, activity,
      preferences: { hints: normalizedHints, details, detail: activity ? details[activity] : "" },
    };
  }
  const scheduleComplete = (p) => !!(p && [p.date, p.time, p.place].every(
    (value) => typeof value === "string" && !!value.trim(),
  ));
  const complete = (p) => scheduleComplete(p) && (!ranged(p) || (
    typeof p.activity === "string" && !!p.activity && Array.isArray(p.activities) && p.activities.includes(p.activity)
  ));
  function status(x) {
    if (x.closed) return "declined";
    if (!x.proposal) return "waiting";
    if (ranged(x.proposal) && !x.proposal.activity) return "host_review";
    const both = x.approvals.host === x.version && x.approvals.guest === x.version;
    if (both) return complete(x.proposal) ? "confirmed" : "details";
    if (x.responded) return x.approvals.host === x.version ? "guest_review" : "host_review";
    return "waiting";
  }
  function create(d) {
    const x = {
      ...clone(d), mode: d.mode || "open",
      id: d.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      version: 1, approvals: { host: null, guest: null }, responded: false, closed: false, history: [],
    };
    if (x.mode === "open") Object.assign(x, { options: [], activity: "", place: "" });
    x.proposal = x.mode === "fixed" ? normalizeProposal({
      ...d.options[0], place: d.place, activity: d.activity, preferences: d.preferences,
    }) : null;
    if (x.proposal) x.approvals.host = 1;
    return x;
  }
  function revise(x, proposal, role) {
    x.history.push({ version: x.version, proposal: x.proposal, approvals: x.approvals });
    x.version++;
    x.proposal = proposal;
    x.approvals = { host: null, guest: null };
    x.approvals[role] = x.version;
    x.responded = true;
  }
  function transition(original, event) {
    const x = clone(original);
    if (!["host", "guest"].includes(event.role)) fail("INVALID_ROLE", "请选择回应身份");
    if (event.version !== x.version) fail("STALE_VERSION", "安排已经更新，请查看最新安排后再确认");
    if (x.closed) fail("INVITATION_CLOSED", "这份邀请已经结束");
    if (event.type === "confirm") {
      if (!x.proposal) fail("MISSING_PROPOSAL", "请先选一个时间");
      if (ranged(x.proposal) && !x.proposal.activity)
        fail("ACTIVITY_SELECTION_REQUIRED", "先从对方可以接受的活动里敲定一项吧");
      x.approvals[event.role] = x.version;
      if (event.role === "guest") x.responded = true;
    } else if (event.type === "finalize") {
      if (event.role !== "host") fail("INVALID_ROLE", "只有发起人可以敲定最终活动");
      if (!object(event.proposal) || Object.keys(event.proposal).length !== 1 || !provided(event.proposal, "activity"))
        fail("INVALID_INPUT", "敲定活动时不能同时修改其他安排");
      if (!ranged(x.proposal) || x.proposal.activity || x.approvals.guest !== x.version)
        fail("FINALIZATION_NOT_ALLOWED", "请先等待对方提供可以接受的活动，再敲定安排");
      if (!scheduleComplete(x.proposal)) fail("INVALID_INPUT", "请先把日期、时间和地点填写完整");
      const proposal = normalizeProposal(event.proposal, x.proposal);
      if (!proposal.activity) fail("ACTIVITY_SELECTION_REQUIRED", "请选一项最终活动");
      revise(x, proposal, "host");
      // Only a subset choice at the unchanged schedule inherits range consent.
      x.approvals.guest = x.version;
    } else if (event.type === "propose" || event.type === "respond") {
      if (event.type === "respond") {
        if (event.role !== "guest") fail("INVALID_ROLE", "只有接收者可以提交邀请回应");
        if (x.responded) fail("ALREADY_RESPONDED", "这份邀请已经回应，请查看最新安排");
      }
      const previous = x.proposal || { place: x.place, activity: x.activity, preferences: x.preferences };
      const proposal = normalizeProposal(event.proposal, previous);
      if (!proposal.date || !proposal.time) fail("INVALID_INPUT", "请填写日期和时间");
      if (x.mode === "open" && !ranged(proposal)) fail("INVALID_INPUT", "请提供可以接受的活动范围");
      if (ranged(proposal)) {
        if (!scheduleComplete(proposal)) fail("INVALID_INPUT", "请把日期、时间和见面地点填写完整");
        if (event.type === "respond") {
          if (proposal.activity)
            fail("INVALID_ACTIVITY_SELECTION", "先选可以接受的活动，最终安排交给发起人敲定");
        } else if (event.role === "host") {
          const prior = ranged(previous) ? normalizeProposal(previous) : null;
          if (!prior || !same(proposal.activities, prior.activities) ||
              !same(proposal.preferences.details, prior.preferences.details) ||
              !same(proposal.preferences.hints, prior.preferences.hints))
            fail("INVALID_ACTIVITY_SELECTION", "请保留对方可以接受的活动和偏好");
          if (!proposal.activity || (!prior.activity && !provided(event.proposal || {}, "activity")))
            fail("ACTIVITY_SELECTION_REQUIRED", "修改安排时，也请从对方可以接受的活动里选一项");
        } else {
          const prior = ranged(previous) ? normalizeProposal(previous) : null;
          const rangeChanged = !prior || !same(proposal.activities, prior.activities) ||
            !same(proposal.preferences.details, prior.preferences.details);
          const explicitChoice = provided(event.proposal || {}, "activity") && !!event.proposal.activity;
          if (proposal.activity && ((rangeChanged && explicitChoice) || (!rangeChanged && proposal.activity !== prior?.activity)))
            fail("INVALID_ACTIVITY_SELECTION", "最终活动交给发起人敲定，你可以调整活动范围");
          if (rangeChanged) {
            proposal.activity = "";
            proposal.preferences.detail = "";
          }
        }
      }
      if (event.type === "respond" && !ranged(proposal) && x.proposal &&
          same(proposal, normalizeProposal(x.proposal))) {
        x.proposal = proposal;
        x.approvals.guest = x.version;
        x.responded = true;
      } else revise(x, proposal, event.role);
    } else if (event.type === "decline") {
      if (event.role !== "guest") fail("INVALID_ROLE", "只有接收者可以回复婉拒");
      x.closed = true;
      x.responded = true;
    } else fail("INVALID_INPUT", "未知操作");
    return x;
  }
  return { create, transition, status, complete, normalizeProposal, RuleError };
})();
if (typeof module !== "undefined") module.exports = InviteModel;

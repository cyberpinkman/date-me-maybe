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
  const isFullRange = (proposal) => !!proposal &&
    (provided(proposal, "timeOptions") || provided(proposal, "placeOptions"));
  const scopeOwner = (invitation) => invitation.mode === "host" ? "host" : "guest";
  const opposite = (role) => role === "host" ? "guest" : "host";
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const detailChoices = (value) => {
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    if (!Array.isArray(value) || value.length > 9 ||
        value.some((detail) => typeof detail !== "string" || !detail.trim()))
      fail("INVALID_INPUT", "每项活动最多选九个小安排，也可以先留空");
    return [...new Set(value.map((detail) => detail.trim()))].sort();
  };

  function normalizeFullRange(patch, previous, hints) {
    const input = (key) => provided(patch, key) ? patch[key] : previous[key];
    const text = (value) => {
      if (typeof value !== "string") fail("INVALID_INPUT", "请检查见面安排的填写内容");
      return value.trim();
    };
    const times = input("timeOptions"), places = input("placeOptions"), choices = input("activities");
    if (!Array.isArray(times) || !times.length || times.length > 3 ||
        !Array.isArray(places) || !places.length || places.length > 3 ||
        !Array.isArray(choices) || !choices.length || choices.length > 6)
      fail("INVALID_INPUT", "请提供一到三个时间和地点，并选好愿意一起做的事");
    const timeOptions = [...new Map(times.map((slot) => {
      if (!object(slot)) fail("INVALID_INPUT", "请填写完整的候选日期和时间");
      const date = text(slot.date), time = text(slot.time);
      if (!date || !time) fail("INVALID_INPUT", "请填写完整的候选日期和时间");
      return [date + "T" + time, { date, time }];
    })).values()].sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : 0));
    const strings = (values) => {
      const result = [...new Set(values.map(text))].sort();
      if (result.includes("")) fail("INVALID_INPUT", "候选安排还没填写完整");
      return result;
    };
    const placeOptions = strings(places), activities = strings(choices);
    const prefs = patch.preferences ?? {}, priorPrefs = previous.preferences ?? {};
    const priorDetails = priorPrefs.details ?? {}, nextDetails = prefs.details ?? {};
    if (!object(priorDetails) || !object(nextDetails) || Object.keys(nextDetails).some((key) => !activities.includes(key)))
      fail("INVALID_INPUT", "请把小安排填写在对应的活动里");
    const details = Object.fromEntries(activities.map((activity) => [activity, detailChoices(
      provided(nextDetails, activity) ? nextDetails[activity] : provided(priorDetails, activity) ? priorDetails[activity] : [],
    )]));
    const selected = (key) => text(input(key) ?? "");
    let date = selected("date"), time = selected("time"), place = selected("place"), activity = selected("activity");
    if (timeOptions.length === 1) {
      date ||= timeOptions[0].date;
      time ||= timeOptions[0].time;
    }
    if (placeOptions.length === 1) place ||= placeOptions[0];
    if (activities.length === 1) activity ||= activities[0];
    if ((date || time) && !timeOptions.some((slot) => slot.date === date && slot.time === time))
      fail("INVALID_ACTIVITY_SELECTION", "请选一组对方提供的日期和时间");
    if ((place && !placeOptions.includes(place)) || (activity && !activities.includes(activity)))
      fail("INVALID_ACTIVITY_SELECTION", "请从对方提供的安排里选择");
    let detail = text(provided(prefs, "detail") ? prefs.detail : activity === previous.activity ? priorPrefs.detail ?? "" : "");
    if (activity && details[activity].length === 1) detail ||= details[activity][0];
    if ((!activity && detail) || (activity && detail && !details[activity].includes(detail)))
      fail("INVALID_ACTIVITY_SELECTION", "请从这项活动的偏好里选择");
    return { timeOptions, placeOptions, activities, date, time, place, activity,
      preferences: { hints, details, detail } };
  }

  // Authors supply candidate ranges; only singleton candidates imply a choice.
  function normalizeOffer(patch, previous = {}) {
    if (!object(patch) || Object.keys(patch).some((key) => !["timeOptions", "placeOptions", "activities", "preferences", "date", "time", "place", "activity"].includes(key)) ||
        ["date", "time", "place", "activity"].some((key) => provided(patch, key) && patch[key] !== "") ||
        (patch.preferences && provided(patch.preferences, "detail") && patch.preferences.detail !== ""))
      fail("INVALID_INPUT", "先提供候选安排，把最终选择留给对方");
    return normalizeProposal({ ...patch, date: "", time: "", place: "", activity: "",
      preferences: { ...patch.preferences, detail: "" } }, previous);
  }

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
    if (isFullRange(patch) || isFullRange(previous)) return normalizeFullRange(patch, previous, normalizedHints);
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
        Object.keys(patchDetails).some((activity) => !activities.includes(activity)))
      fail("INVALID_INPUT", "请把小安排填写在对应的活动里");
    for (const detail of Object.values(priorDetails)) detailChoices(detail);
    const details = Object.fromEntries(activities.map((activity) => [
      activity, detailChoices(provided(patchDetails, activity) ? patchDetails[activity]
        : provided(priorDetails, activity) ? priorDetails[activity] : []),
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
      if (activity && preferences.detail !== details[activity].join("、"))
        fail("INVALID_INPUT", "小安排与所选活动不一致");
    }
    return {
      ...common, activities, activity,
      preferences: { hints: normalizedHints, details, detail: activity ? details[activity].join("、") : "" },
    };
  }
  const scheduleComplete = (p) => !!(p && [p.date, p.time, p.place].every(
    (value) => typeof value === "string" && !!value.trim(),
  ));
  const complete = (p) => {
    if (!scheduleComplete(p)) return false;
    if (!ranged(p)) return true;
    if (!p.activity || !Array.isArray(p.activities) || !p.activities.includes(p.activity)) return false;
    if (!isFullRange(p)) return true;
    if (!Array.isArray(p.timeOptions) || !p.timeOptions.some((slot) => slot.date === p.date && slot.time === p.time) ||
        !Array.isArray(p.placeOptions) || !p.placeOptions.includes(p.place)) return false;
    const choices = p.preferences?.details?.[p.activity], detail = p.preferences?.detail;
    return Array.isArray(choices) && (choices.length ? choices.includes(detail) : detail === "");
  };
  function status(x) {
    if (x.closed) return "declined";
    if (!x.proposal) return "waiting";
    if (isFullRange(x.proposal)) {
      if (x.mode === "host" && !x.responded) return "waiting";
      if (x.approvals.host === x.version && x.approvals.guest === x.version && complete(x.proposal)) return "confirmed";
      return x.approvals.host === x.version ? "guest_review" : "host_review";
    }
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
    if (x.mode === "host") {
      if (!isFullRange(d.plan)) fail("INVALID_INPUT", "先把想邀请对方的候选安排填好吧");
      Object.assign(x, { options: [], activity: "", place: "" });
      x.proposal = normalizeOffer(d.plan);
      delete x.plan;
    } else x.proposal = x.mode === "fixed" ? normalizeProposal({
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
  function fullRangeTransition(x, event) {
    const owner = scopeOwner(x), chooser = opposite(owner), prior = x.proposal, respondedBefore = x.responded;
    if (event.type === "respond") {
      if (event.role !== "guest" || event.role !== owner)
        fail("INVALID_ROLE", "请从对方提供的候选安排里选择");
      if (x.responded) fail("ALREADY_RESPONDED", "这份邀请已经回应，请查看最新安排");
      const proposal = normalizeOffer(event.proposal);
      if (!isFullRange(proposal)) fail("INVALID_INPUT", "请把候选时间、地点和活动填写完整");
      revise(x, proposal, owner);
    } else if (event.type === "confirm") {
      if (!complete(prior)) fail("ACTIVITY_SELECTION_REQUIRED", "先把时间、地点和小安排都选好吧");
      x.approvals[event.role] = x.version;
      if (event.role === "guest") x.responded = true;
    } else if (event.type === "finalize") {
      if (event.role !== chooser) fail("INVALID_ROLE", "这份安排等对方来敲定");
      if (!isFullRange(prior) || x.approvals[owner] !== x.version || x.approvals[chooser] === x.version)
        fail("FINALIZATION_NOT_ALLOWED", "请先查看对方最新提供的候选安排");
      if (!object(event.proposal) || Object.keys(event.proposal).some((key) => !["date", "time", "place", "activity", "detail"].includes(key)))
        fail("INVALID_INPUT", "敲定时只需选择对方提供的安排");
      const choose = (key, candidates) => {
        if (provided(event.proposal, key)) return event.proposal[key];
        if (candidates.length === 1) return candidates[0];
        fail("ACTIVITY_SELECTION_REQUIRED", "先把时间、地点和小安排都选好吧");
      };
      const date = choose("date", prior.timeOptions.map((slot) => slot.date));
      const time = choose("time", prior.timeOptions.map((slot) => slot.time));
      const place = choose("place", prior.placeOptions), activity = choose("activity", prior.activities);
      if (typeof activity !== "string" || !prior.activities.includes(activity.trim()))
        fail("INVALID_ACTIVITY_SELECTION", "请从对方提供的活动里选择");
      const details = prior.preferences.details[activity.trim()];
      const detail = choose("detail", details.length ? details : [""]);
      const proposal = normalizeProposal({ date, time, place, activity, preferences: { detail } }, prior);
      if (!complete(proposal)) fail("ACTIVITY_SELECTION_REQUIRED", "先把时间、地点和小安排都选好吧");
      revise(x, proposal, chooser);
      x.approvals[owner] = x.version;
    } else if (event.type === "propose") {
      const patch = event.proposal;
      if (!object(patch) || !isFullRange(prior)) fail("INVALID_INPUT", "请先查看当前的完整安排");
      const changesScope = ["timeOptions", "placeOptions", "activities"].some((key) => provided(patch, key)) ||
        (patch.preferences && ["hints", "details"].some((key) => provided(patch.preferences, key)));
      if (changesScope) {
        if (event.role !== owner) fail("INVALID_ACTIVITY_SELECTION", "请保留对方提供的候选范围和偏好");
        revise(x, normalizeOffer(patch, prior), owner);
      } else {
        if (!complete(prior) || (event.role !== owner && status(x) !== "confirmed"))
          fail("FINALIZATION_NOT_ALLOWED", "先一起敲定这次见面，再商量新的时间或地点");
        if (Object.keys(patch).some((key) => !["date", "time", "place", "activity", "preferences"].includes(key)) ||
            (provided(patch, "activity") && patch.activity !== prior.activity) ||
            (patch.preferences && provided(patch.preferences, "detail") && patch.preferences.detail !== prior.preferences.detail))
          fail("INVALID_ACTIVITY_SELECTION", "改期时会保留已经选好的活动和偏好");
        const date = provided(patch, "date") ? patch.date : prior.date;
        const time = provided(patch, "time") ? patch.time : prior.time;
        const place = provided(patch, "place") ? patch.place : prior.place;
        const proposal = normalizeProposal({ date, time, place, timeOptions: [{ date, time }], placeOptions: [place],
          activity: prior.activity, preferences: { detail: prior.preferences.detail } }, prior);
        revise(x, proposal, event.role);
      }
    } else fail("INVALID_INPUT", "未知操作");
    if (x.mode === "host" && event.role === "host") x.responded = respondedBefore;
    return x;
  }
  function transition(original, event) {
    const x = clone(original);
    if (!["host", "guest"].includes(event.role)) fail("INVALID_ROLE", "请选择回应身份");
    if (event.version !== x.version) fail("STALE_VERSION", "安排已经更新，请查看最新安排后再确认");
    if (x.closed) fail("INVITATION_CLOSED", "这份邀请已经结束");
    if (event.type !== "decline" && (isFullRange(x.proposal) || isFullRange(event.proposal) || x.mode === "host"))
      return fullRangeTransition(x, event);
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
  return { create, transition, status, complete, normalizeProposal, scopeOwner, isFullRange, RuleError };
})();
if (typeof module !== "undefined") module.exports = InviteModel;

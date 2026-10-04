const InviteModel = (() => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const provided = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key) &&
    object[key] !== undefined;
  // Every proposal consumer uses this boundary: changing one arrangement field
  // preserves unrelated choices, while details belong to their activity.
  function normalizeProposal(patch = {}, previous = {}) {
    patch = patch || {};
    previous = previous || {};
    const preferences = patch.preferences || {},
      priorPreferences = previous.preferences || {};
    const value = (key) =>
      provided(patch, key) ? patch[key] : (previous[key] ?? "");
    const activity = value("activity");
    const hints = provided(preferences, "hints")
      ? preferences.hints
      : priorPreferences.hints || [];
    const detail = provided(preferences, "detail")
      ? preferences.detail
      : activity !== (previous.activity ?? "")
        ? ""
        : priorPreferences.detail || "";
    if (
      !Array.isArray(hints) ||
      hints.some((hint) => typeof hint !== "string") ||
      typeof detail !== "string"
    ) {
      throw new Error("小暗示和场景偏好的格式不正确");
    }
    return {
      date: value("date"),
      time: value("time"),
      place: value("place"),
      activity,
      preferences: { hints: [...new Set(hints)].sort(), detail },
    };
  }
  const complete = (p) =>
    !!(p && p.date && p.time && p.place && p.place.trim());
  function status(x) {
    if (x.closed) return "declined";
    if (!x.proposal) return "waiting";
    const both =
      x.approvals.host === x.version && x.approvals.guest === x.version;
    if (both) return complete(x.proposal) ? "confirmed" : "details";
    if (x.responded)
      return x.approvals.host === x.version ? "guest_review" : "host_review";
    return "waiting";
  }
  function create(d) {
    const x = {
      ...clone(d),
      id:
        d.id ||
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now())),
      version: 1,
      approvals: { host: null, guest: null },
      responded: false,
      closed: false,
      history: [],
    };
    x.proposal =
      d.mode === "fixed"
        ? normalizeProposal({
            ...d.options[0],
            place: d.place,
            activity: d.activity,
            preferences: d.preferences,
          })
        : null;
    if (x.proposal) x.approvals.host = 1;
    return x;
  }
  function transition(original, event) {
    const x = clone(original);
    if (!["host", "guest"].includes(event.role))
      throw new Error("请选择回应身份");
    if (event.version !== x.version)
      throw new Error("安排已经更新，请查看最新安排后再确认");
    if (x.closed) throw new Error("这份邀请已经结束");
    if (event.type === "confirm") {
      if (!x.proposal) throw new Error("请先选一个时间");
      x.approvals[event.role] = x.version;
      if (event.role === "guest") x.responded = true;
    } else if (event.type === "propose" || event.type === "respond") {
      if (event.type === "respond") {
        if (event.role !== "guest")
          throw new Error("只有接收者可以提交邀请回应");
        if (x.responded) throw new Error("这份邀请已经回应，请查看最新安排");
      }
      const previous = x.proposal || {
        place: x.place,
        activity: x.activity,
        preferences: x.preferences,
      };
      const proposal = normalizeProposal(event.proposal, previous);
      if (!proposal.date || !proposal.time) throw new Error("请填写日期和时间");
      if (
        event.type === "respond" &&
        x.proposal &&
        JSON.stringify(proposal) ===
          JSON.stringify(normalizeProposal(x.proposal))
      ) {
        x.proposal = proposal;
        x.approvals.guest = x.version;
        x.responded = true;
      } else {
        x.history.push({
          version: x.version,
          proposal: x.proposal,
          approvals: x.approvals,
        });
        x.version++;
        x.proposal = proposal;
        x.approvals = { host: null, guest: null };
        x.approvals[event.role] = x.version;
        x.responded = true;
      }
    } else if (event.type === "decline") {
      if (event.role !== "guest") throw new Error("只有接收者可以回复婉拒");
      x.closed = true;
      x.responded = true;
    } else throw new Error("未知操作");
    return x;
  }
  return { create, transition, status, complete, normalizeProposal };
})();
if (typeof module !== "undefined") module.exports = InviteModel;

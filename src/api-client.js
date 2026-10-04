/* The server owns identity, invitation routing, and versions. */
const InviteAPI = (() => {
  const pending = new Map();
  const userError = (message) => Object.assign(new Error(message), { userSafe: true });
  const authMessages = {
    INVALID_OTP: "验证码好像不对，再看一眼邮件吧。",
    OTP_EXPIRED: "验证码已经过期，重新发送一封吧。",
    TOO_MANY_ATTEMPTS: "试的次数有点多，重新发送验证码再试吧。",
    INVALID_EMAIL: "检查一下邮箱地址有没有写错吧。",
    VALIDATION_ERROR: "检查一下邮箱和验证码，再试一次吧。",
    EMAIL_NOT_VERIFIED: "先完成邮箱验证，就能继续啦。",
    SESSION_EXPIRED: "好久不见，重新登录就能继续啦。",
    SESSION_NOT_FRESH: "重新登录一下，就能继续啦。",
    INVALID_TOKEN: "这次登录还没完成，重新试一次吧。",
    TOKEN_EXPIRED: "这次登录等得有点久，重新试一次吧。",
    PROVIDER_NOT_FOUND: "这个登录方式暂时用不了，稍后再试试吧。",
    TOO_MANY_REQUESTS: "操作有点快，稍等一会儿再试吧。",
    RATE_LIMITED: "操作有点快，稍等一会儿再试吧。",
  };
  function responseMessage(path, status, payload) {
    if (path.startsWith("/api/auth/")) {
      const code = payload?.error?.code || payload?.code;
      return authMessages[code] || (status === 429
        ? "操作有点快，稍等一会儿再试吧。"
        : status >= 500 ? "暂时还不能登录，稍后再试试吧。" : "登录还没完成，请再试一次。");
    }
    return typeof payload?.error?.message === "string"
      ? payload.error.message : "暂时没能完成，稍后再试试吧。";
  }
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
      });
    } catch {
      const error = userError("网络好像开小差了，稍等一下，再试一次吧。");
      error.network = true;
      throw error;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      if (response.ok) {
        // Headers can arrive before a committed mutation's body is interrupted.
        // Its outcome is still unknown, so preserve the retry's idempotency key.
        const error = userError("刚才没能收到回应，你的选择还在，再试一次吧。");
        error.network = true;
        throw error;
      }
      payload = {};
    }
    if (!response.ok) {
      const error = userError(responseMessage(path, response.status, payload));
      error.status = response.status;
      error.code = payload?.error?.code || payload?.code;
      throw error;
    }
    return payload;
  }
  async function mutate(path, body) {
    const key = path + JSON.stringify(body);
    const requestId = pending.get(key) || crypto.randomUUID();
    pending.set(key, requestId);
    try {
      const result = await request(path, {
        method: "POST", body: JSON.stringify({ ...body, requestId }),
      });
      pending.delete(key);
      return result;
    } catch (error) {
      // A lost response may already have committed. The next intentional retry
      // uses the same idempotency key; validation/conflict errors start afresh.
      if (error.status && error.status < 500) pending.delete(key);
      throw error;
    }
  }
  return {
    userError,
    message: (error) => error?.userSafe ? error.message : "刚才没能完成，稍后再试试吧。",
    get: (path) => request(path),
    post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body) }),
    mutate,
  };
})();

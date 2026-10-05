const MAX_DEV_MESSAGES = 100;
const OTP_LIFETIME_MS = 5 * 60 * 1000;
const OTP_TYPES = new Set(['sign-in', 'email-verification', 'forget-password', 'change-email']);

/** The development mailbox never sends network requests or accepts real addresses. */
export function createMailer(config, { fetchImpl = fetch } = {}) {
  let inbox = [];
  const prune = () => { inbox = inbox.filter(message => Date.now() - Date.parse(message.createdAt) < OTP_LIFETIME_MS).slice(-MAX_DEV_MESSAGES); };
  return {
    async sendOTP({ email, otp, type, audience }) {
      const recipient = String(email || '').trim().toLowerCase();
      if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient) || !/^\d{6}$/.test(otp) || !OTP_TYPES.has(type)) {
        throw new Error('Invalid verification email parameters.');
      }
      if (config.devMailbox) {
        // Defend this boundary as well as loadConfig: callers may inject config in tests.
        const appURL = new URL(config.origin);
        if (config.isProduction || !['localhost', '127.0.0.1', '[::1]'].includes(appURL.hostname) || !recipient.endsWith('.test')) {
          throw new Error('The local test mailbox accepts only .test addresses on a loopback development server.');
        }
        inbox.push({ email: recipient, otp, type, createdAt: new Date().toISOString() });
        prune();
        return;
      }
      if (!config.resendApiKey || !config.emailFrom) throw new Error('Email sign-in is not configured.');
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          from: config.emailFrom,
          to: [recipient],
          subject: audience === 'admin' ? '见一面 · 运营后台登录验证码' : '见一面 · 你的登录验证码',
          text: audience === 'admin' ? `你在「见一面运营后台」的登录验证码是：${otp}\n\n5 分钟内有效。请勿向他人透露验证码。如果不是你本人请求，请忽略这封邮件。` : `你在「见一面」的登录验证码是：${otp}\n\n5 分钟内输入，就能继续准备你的邀请。\n请勿向他人透露验证码。如果不是你本人请求，请忽略这封邮件。`,
        }),
      });
      if (!response.ok) throw new Error(`Email delivery failed (provider status ${response.status}).`);
      let payload;
      try { payload = await response.json(); } catch { throw new Error('Email provider returned an invalid response.'); }
      if (!payload || typeof payload.id !== 'string' || !payload.id) throw new Error('Email provider did not confirm acceptance.');
    },
    getInbox() {
      prune();
      return config.devMailbox ? inbox.map(message => ({ ...message })) : [];
    },
  };
}

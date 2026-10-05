import express from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createAuth } from './auth.mjs';
import { createInvitationService } from './invitations.mjs';
import { ApiError } from './errors.mjs';
import { digest } from './crypto.mjs';
import { resolveClientIp } from './client-ip.mjs';
import { fields, isUuid } from './validation.mjs';

const loopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

export function createApplication({ pool, config, mailer }) {
  const app = express(), auth = createAuth({ pool, config, mailer }), service = createInvitationService({ pool, config });
  app.disable('x-powered-by');
  // Resolve only the trusted platform header at our shared boundary; Express
  // must not independently trust arbitrary forwarding headers.
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    req.clientIp = resolveClientIp(req);
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Request-Id': req.requestId });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (config.devMailbox && !loopback(req.socket.remoteAddress)) return next(new ApiError(403, 'LOCAL_ONLY', '本地验收环境仅允许本机访问。'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('origin') !== config.origin || req.get('sec-fetch-site') === 'cross-site') return next(new ApiError(403, 'INVALID_ORIGIN', '这次没能完成，重新打开页面再试试吧。'));
      if (!req.is('application/json')) return next(new ApiError(415, 'JSON_REQUIRED', '这次没能完成，重新打开页面再试试吧。'));
    }
    next();
  });
  // Cap the raw JSON before Better Auth reads it, including chunked bodies.
  // Its pinned Node adapter forwards an already-consumed string body unchanged.
  app.all('/api/auth/*splat', express.text({ type: 'application/json', limit: '32kb' }), (req, res) => {
    req.headers['x-auth-client-ip'] = req.clientIp;
    return toNodeHandler(auth)(req, res);
  });
  app.use(express.json({ limit: '32kb' }));
  async function requireOwner(req, res, next) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user || !session.user.emailVerified) return next(new ApiError(401, 'AUTH_REQUIRED', '请先登录，再查看或创建你的邀约。'));
    req.ownerId = session.user.id;
    next();
  }
  async function rateLimit(key, max, seconds = 60) {
    const result = await pool.query(`INSERT INTO app_rate_limits(key_hash,window_start,count) VALUES($1,now(),1)
      ON CONFLICT(key_hash) DO UPDATE SET
        count=CASE WHEN app_rate_limits.window_start <= now()-($2 * interval '1 second') THEN 1 ELSE app_rate_limits.count+1 END,
        window_start=CASE WHEN app_rate_limits.window_start <= now()-($2 * interval '1 second') THEN now() ELSE app_rate_limits.window_start END RETURNING count`, [digest(key), seconds]);
    if (result.rows[0].count > max) throw new ApiError(429, 'RATE_LIMITED', '操作有点快，请稍后再试。');
  }
  app.get('/api/config', (req, res) => res.json({ googleEnabled: Boolean(config.googleClientId), emailOtpEnabled: Boolean(config.resendApiKey || config.devMailbox), devMailbox: config.devMailbox, appOrigin: config.origin }));
  app.get('/api/session', async (req, res) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    res.json({ user: session?.user?.emailVerified ? { id: session.user.id, email: session.user.email, name: session.user.name } : null });
  });
  app.get('/api/health', async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  if (config.devMailbox) app.get('/api/dev/mailbox', (req, res) => res.json({ emails: mailer.getInbox() }));

  app.get('/api/schedule', requireOwner, async (req, res) => res.json(await service.calendar(req.ownerId)));
  app.post('/api/schedule', requireOwner, async (req, res) => {
    await rateLimit(`schedule:${req.ownerId}`, 120);
    fields(req.body, ['schedule']);
    await service.scheduling.saveSchedule(req.ownerId, req.body.schedule);
    res.json(await service.calendar(req.ownerId));
  });
  app.post('/api/schedule/busy', requireOwner, async (req, res) => {
    await rateLimit(`schedule:${req.ownerId}`, 120);
    await service.scheduling.addBusy(req.ownerId, req.body);
    res.status(201).json(await service.calendar(req.ownerId));
  });
  app.post('/api/schedule/busy/:id/remove', requireOwner, async (req, res) => {
    await rateLimit(`schedule:${req.ownerId}`, 120);
    fields(req.body, []);
    if (!isUuid(req.params.id)) throw new ApiError(404, 'BUSY_NOT_FOUND', '这段忙碌时间已经不在日程里了。');
    await service.scheduling.removeBusy(req.ownerId, req.params.id);
    res.json(await service.calendar(req.ownerId));
  });

  app.get('/api/invitations', requireOwner, async (req, res) => res.json({ invitations: await service.list(req.ownerId) }));
  app.post('/api/invitations', requireOwner, async (req, res) => {
    await rateLimit(`create:${req.ownerId}`, 30, 3600);
    res.status(201).json({ invitation: await service.create(req.ownerId, req.body) });
  });
  app.get('/api/invitations/:id', requireOwner, async (req, res) => res.json({ invitation: await service.read({ ownerId: req.ownerId, id: req.params.id }) }));
  app.get('/api/invitations/:id/availability', requireOwner, async (req, res) => res.json(await service.availability({ ownerId: req.ownerId, id: req.params.id })));
  app.post('/api/invitations/:id/actions', requireOwner, async (req, res) => {
    await rateLimit(`host-action:${req.ownerId}`, 120);
    res.json({ invitation: await service.transition({ ownerId: req.ownerId, id: req.params.id }, req.body) });
  });
  app.get('/api/guest/:token', async (req, res) => {
    await rateLimit(`guest-read:${req.clientIp}`, 600);
    res.json({ invitation: await service.read({ token: req.params.token }) });
  });
  app.post('/api/guest/:token/actions', async (req, res) => {
    await rateLimit(`guest-action:${req.clientIp}`, 120);
    res.json({ invitation: await service.transition({ token: req.params.token }, req.body) });
  });
  app.get('/api/guest/:token/availability', async (req, res) => {
    await rateLimit(`guest-availability:${req.clientIp}`, 120);
    res.json(await service.availability({ token: req.params.token }));
  });
  app.post('/api/guest/:token/bind', requireOwner, async (req, res) => {
    await rateLimit(`guest-bind:${req.ownerId}`, 30);
    res.json({ invitation: await service.bindGuest(req.params.token, req.ownerId, req.body) });
  });
  app.use('/api', (req, res, next) => next(new ApiError(404, 'NOT_FOUND', '暂时打不开这里，请检查链接后再试。')));
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  app.use(express.static(dist, { index: 'index.html', maxAge: 0 }));
  app.get('/i/:token', (req, res) => res.sendFile('index.html', { root: dist }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') error = new ApiError(413, 'BODY_TOO_LARGE', '内容有点长，写短一点再试吧。');
    else if (error.type === 'entity.parse.failed') error = new ApiError(400, 'INVALID_JSON', '这次没能完成，重新打开页面再试试吧。');
    const expected = error instanceof ApiError;
    if (!expected) console.error(JSON.stringify({ requestId: req.requestId, error: error.name, code: error.code || 'INTERNAL', message: 'Request failed; no input or credentials logged.' }));
    if (error.status === 429) res.set('Retry-After', '60');
    res.status(expected ? error.status : 500).json({ error: { code: expected ? error.code : 'INTERNAL_ERROR', message: expected ? error.message : '暂时无法完成，请稍后再试。' }, requestId: req.requestId });
  });
  return { app, auth, service };
}

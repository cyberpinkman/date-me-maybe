import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import test from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

// This suite only runs against the explicitly supplied, isolated PostgreSQL
// instance. It never falls back to DATABASE_URL or resets an existing database.
function assertIsolatedDatabase(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Use a PostgreSQL TEST_DATABASE_URL');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'The integration database must be local');
  assert.ok(['55439', '65500'].includes(url.port), 'Only the isolated test PostgreSQL ports 55439 or 65500 are allowed; port 5432 is never accessed');
  assert.equal(decodeURIComponent(url.pathname), '/date_me_maybe_test', 'The integration database must be named date_me_maybe_test');
  return url;
}

async function freeHttpPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function clientFor(origin, initialCookie = '') {
  const cookies = new Map(initialCookie.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator), part.slice(separator + 1)];
  }));
  const cookie = () => [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  async function request(path, { method = 'GET', body, requestOrigin = origin } = {}) {
    const headers = { Accept: 'application/json' };
    if (cookie()) headers.Cookie = cookie();
    if (method !== 'GET') {
      headers.Origin = requestOrigin;
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(new URL(path, origin), {
      method, headers, redirect: 'manual',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const separator = pair.indexOf('=');
      const key = pair.slice(0, separator), value = pair.slice(separator + 1);
      const expired = attributes.some(attribute => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
      if (expired || !value) cookies.delete(key);
      else cookies.set(key, value);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { assert.fail(`${method} ${path} returned non-JSON (${response.status}): ${text.slice(0, 240)}`); }
    }
    return { status: response.status, body: data };
  }
  return {
    request, cookie,
    get: path => request(path),
    post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body }),
  };
}

function succeeds(response, message) {
  assert.ok(response.status >= 200 && response.status < 300, `${message}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

function fails(response, status, message) {
  assert.equal(response.status, status, `${message}: ${JSON.stringify(response.body)}`);
  assert.equal(typeof response.body?.error?.code, 'string', `${message}: structured error code`);
  assert.equal(typeof response.body?.error?.message, 'string', `${message}: structured error message`);
}

function futureDate(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assertPublicInvitation(invitation, privateValues = []) {
  assert.ok(invitation && typeof invitation.id === 'string');
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/^(ownerId|ownerEmail|email|shareUrl|shareToken|tokenHash|secret)$/i.test(key), `Guest response must not expose ${key}`);
      inspect(child);
    }
  };
  inspect(invitation);
  const serialized = JSON.stringify(invitation);
  for (const value of privateValues.filter(Boolean)) assert.ok(!serialized.includes(value), `Guest response leaked a private owner value`);
}

test('PostgreSQL + HTTP: authentication, invitation ownership, guest capabilities and atomic mutations', {
  skip: !databaseUrl && 'Set TEST_DATABASE_URL to the isolated date_me_maybe_test database on port 55439 or 65500',
  timeout: 120_000,
}, async t => {
  const dbUrl = assertIsolatedDatabase(databaseUrl);
  // Dynamic imports keep the opt-in suite skippable without a configured server.
  const [{ Pool }, { createApplication }, { migrateDatabase }, { loadConfig }, { createMailer }] = await Promise.all([
    import('pg'), import('../server/app.mjs'), import('../server/db.mjs'),
    import('../server/config.mjs'), import('../server/mail.mjs'),
  ]);
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5_000 });
  let server;
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    await pool.end();
  });
  const actualDatabase = (await pool.query('SELECT current_database() AS name, inet_server_port() AS port')).rows[0];
  assert.equal(actualDatabase.name, 'date_me_maybe_test');
  assert.equal(Number(actualDatabase.port), Number(dbUrl.port));
  const port = await freeHttpPort();
  const origin = `http://127.0.0.1:${port}`;
  const config = loadConfig({
    DATABASE_URL: databaseUrl, APP_ORIGIN: origin, PORT: String(port), NODE_ENV: 'test', DEV_MAILBOX: '1',
    AUTH_SECRET: 'integration-auth-secret-only-000000000000000000000000',
    SHARE_TOKEN_SECRET: 'integration-share-secret-only-00000000000000000000000',
  });
  const mailer = createMailer(config);
  const application = createApplication({ config, pool, mailer });
  await migrateDatabase({ pool, auth: application.auth });
  await new Promise((resolve, reject) => {
    server = application.app.listen(port, '127.0.0.1', resolve);
    server.once('error', reject);
  });

  const anonymous = clientFor(origin), a = clientFor(origin), c = clientFor(origin);
  const b = clientFor(origin), d = clientFor(origin);
  const draftA = {
    from: 'A', to: 'B', tone: 'playful', message: '想认真约你见一面。', mode: 'fixed',
    options: [{ date: futureDate(7), time: '18:30' }], activity: '吃点好吃的', place: 'A 的见面地点',
  };
  const draftC = { ...draftA, from: 'C', to: 'D', place: 'C 的见面地点' };
  let userA, userC, baselineA, baselineC, invitationA, invitationC, tokenB, tokenD, createAResponse;
  const createARequest = { draft: draftA, requestId: randomUUID() };
  const ownerPath = id => `/api/invitations/${encodeURIComponent(id)}`;
  const guestPath = token => `/api/guest/${encodeURIComponent(token)}`;
  const getOwner = async (client, id) => succeeds(await client.get(ownerPath(id)), 'read owner invitation').invitation;

  await t.test('public configuration is explicit and unauthenticated owner routes return 401', async () => {
    const publicConfig = succeeds(await anonymous.get('/api/config'), 'public configuration');
    assert.equal(publicConfig.googleEnabled, false);
    assert.equal(publicConfig.emailOtpEnabled, true);
    assert.equal(publicConfig.devMailbox, true);
    assert.equal(publicConfig.appOrigin, origin);
    assert.equal(succeeds(await anonymous.get('/api/session'), 'anonymous session').user, null);
    fails(await anonymous.get('/api/invitations'), 401, 'anonymous list');
    fails(await anonymous.post('/api/invitations', { draft: draftA, requestId: randomUUID() }), 401, 'anonymous create');
  });

  await t.test('real OTP login establishes separate sessions; incorrect and replayed OTPs fail', async () => {
    async function signIn(client, email, checkBadAndReplay = false) {
      const before = mailer.getInbox().length;
      succeeds(await client.post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }), 'send verification OTP');
      const mail = mailer.getInbox().slice(before).filter(item => item.email === email && item.type === 'sign-in').at(-1);
      assert.ok(mail?.otp, `Real OTP mail for ${email} must reach the local mailbox`);
      if (checkBadAndReplay) {
        const wrongOtp = `${mail.otp[0] === '0' ? '1' : '0'}${mail.otp.slice(1)}`;
        const rejected = await client.post('/api/auth/sign-in/email-otp', { email, otp: wrongOtp });
        assert.ok(rejected.status >= 400 && rejected.status < 500, 'An incorrect OTP must not sign in');
        assert.equal(succeeds(await client.get('/api/session'), 'session after wrong OTP').user, null);
      }
      succeeds(await client.post('/api/auth/sign-in/email-otp', { email, otp: mail.otp }), 'sign in with delivered OTP');
      const user = succeeds(await client.get('/api/session'), 'authenticated session').user;
      assert.equal(user?.email, email);
      assert.ok(client.cookie(), 'Real Better Auth sign-in must set a session cookie');
      if (checkBadAndReplay) {
        const replayClient = clientFor(origin);
        const replay = await replayClient.post('/api/auth/sign-in/email-otp', { email, otp: mail.otp });
        assert.ok(replay.status >= 400 && replay.status < 500, 'Consumed OTP must not be reusable');
        assert.equal(succeeds(await replayClient.get('/api/session'), 'session after OTP replay').user, null);
      }
      return user;
    }
    // Two deliveries total; stay below the three-per-IP-per-minute mail limit.
    userA = await signIn(a, 'a@example.test', true);
    userC = await signIn(c, 'c@example.test');
    assert.notEqual(userA.id, userC.id);
    baselineA = succeeds(await a.get('/api/invitations'), 'A baseline list').invitations.map(invitation => invitation.id);
    baselineC = succeeds(await c.get('/api/invitations'), 'C baseline list').invitations.map(invitation => invitation.id);
  });
  assert.ok(userA && userC, 'Both real sign-ins are prerequisites for invitation integration checks');

  await t.test('A and C create invitations with distinct anonymous capabilities', async () => {
    createAResponse = await a.post('/api/invitations', createARequest);
    invitationA = succeeds(createAResponse, 'A creates invitation').invitation;
    invitationC = succeeds(await c.post('/api/invitations', { draft: draftC, requestId: randomUUID() }), 'C creates invitation').invitation;
    for (const invitation of [invitationA, invitationC]) {
      assert.equal(typeof invitation.id, 'string');
      assert.ok(Number.isFinite(Date.parse(invitation.createdAt)), 'createdAt is an ISO timestamp');
      assert.ok(Number.isFinite(Date.parse(invitation.updatedAt)), 'updatedAt is an ISO timestamp');
      const url = new URL(invitation.shareUrl);
      assert.equal(url.origin, origin);
      assert.match(url.pathname, /^\/i\/[A-Za-z0-9_-]{43}$/);
    }
    tokenB = new URL(invitationA.shareUrl).pathname.split('/').at(-1);
    tokenD = new URL(invitationC.shareUrl).pathname.split('/').at(-1);
    assert.notEqual(tokenB, tokenD);
    assert.notEqual(invitationA.id, invitationC.id);
    const [forB, forD] = await Promise.all([b.get(guestPath(tokenB)), d.get(guestPath(tokenD))]);
    assert.equal(succeeds(forB, 'B opens invitation').invitation.to, 'B');
    assert.equal(succeeds(forD, 'D opens invitation').invitation.to, 'D');
    for (const response of [forB, forD]) assertPublicInvitation(response.body.invitation, [userA.id, userC.id, userA.email, userC.email]);
    assert.equal(succeeds(await b.get('/api/session'), 'B stays anonymous').user, null);
    assert.equal(succeeds(await d.get('/api/session'), 'D stays anonymous').user, null);
  });
  assert.ok(invitationA && invitationC && tokenB && tokenD, 'Created invitations are prerequisites for mutation checks');

  await t.test('creation retries return the original response and conflicting request reuse is rejected', async () => {
    const replay = await a.post('/api/invitations', createARequest);
    succeeds(replay, 'same create request retry');
    assert.deepEqual(replay.body, createAResponse.body);
    const conflict = await a.post('/api/invitations', { ...createARequest, draft: { ...draftA, message: '不同的请求内容' } });
    fails(conflict, 409, 'same create request key with a different payload');
    assert.equal(succeeds(await a.get('/api/invitations'), 'A list after retry').invitations.length, baselineA.length + 1);
  });

  await t.test('owner boundaries, invalid capabilities and forged principals cannot mutate an invitation', async () => {
    const beforeA = await getOwner(a, invitationA.id), beforeC = await getOwner(c, invitationC.id);
    for (const [client, foreign] of [[a, invitationC], [c, invitationA]]) {
      fails(await client.get(ownerPath(foreign.id)), 404, 'foreign owner read');
      fails(await client.post(`${ownerPath(foreign.id)}/actions`, {
        type: 'propose', version: foreign.version, proposal: { place: '越权修改' }, requestId: randomUUID(),
      }), 404, 'foreign owner mutation');
    }
    fails(await anonymous.get(ownerPath(invitationA.id)), 401, 'anonymous owner read');
    const invalidToken = randomBytes(32).toString('base64url');
    fails(await anonymous.get(guestPath(invalidToken)), 404, 'invalid capability read');
    fails(await anonymous.post(`${guestPath(invalidToken)}/actions`, {
      type: 'respond', version: 1, proposal: invitationA.proposal, requestId: randomUUID(),
    }), 404, 'invalid capability mutation');
    for (const forged of [{ role: 'host' }, { ownerId: userC.id }]) {
      fails(await a.post('/api/invitations', { draft: draftA, requestId: randomUUID(), ...forged }), 422, 'forged create principal');
      fails(await a.post(`${ownerPath(invitationA.id)}/actions`, {
        type: 'propose', version: beforeA.version, proposal: { place: '伪造身份修改' }, requestId: randomUUID(), ...forged,
      }), 422, 'forged owner action principal');
      fails(await b.post(`${guestPath(tokenB)}/actions`, {
        type: 'respond', version: beforeA.version, proposal: beforeA.proposal, requestId: randomUUID(), ...forged,
      }), 422, 'forged guest action principal');
    }
    assert.deepEqual(await getOwner(a, invitationA.id), beforeA);
    assert.deepEqual(await getOwner(c, invitationC.id), beforeC);
    assert.equal(succeeds(await a.get('/api/invitations'), 'no forged invitations created').invitations.length, baselineA.length + 1);
  });

  await t.test('cross-origin mutations are rejected for authenticated owners and anonymous guests', async () => {
    const before = await getOwner(a, invitationA.id);
    fails(await a.post('/api/invitations', { draft: draftA, requestId: randomUUID() }, { requestOrigin: 'https://untrusted.example.test' }), 403, 'cross-origin owner create');
    fails(await b.post(`${guestPath(tokenB)}/actions`, {
      type: 'respond', version: before.version, proposal: before.proposal, requestId: randomUUID(),
    }, { requestOrigin: 'https://untrusted.example.test' }), 403, 'cross-origin guest response');
    assert.deepEqual(await getOwner(a, invitationA.id), before);
  });

  await t.test('B and D can respond concurrently while each owner only receives their own invitation', async () => {
    const [responseB, responseD] = await Promise.all([
      b.post(`${guestPath(tokenB)}/actions`, {
        type: 'respond', version: invitationA.version, requestId: randomUUID(),
        proposal: { ...invitationA.proposal, preferences: { hints: ['想多待一会儿'], detail: '西餐' } },
      }),
      d.post(`${guestPath(tokenD)}/actions`, {
        type: 'respond', version: invitationC.version, requestId: randomUUID(),
        proposal: { ...invitationC.proposal, preferences: { hints: ['轻松随意就好'], detail: '日料' } },
      }),
    ]);
    const fromB = succeeds(responseB, 'B responds').invitation, fromD = succeeds(responseD, 'D responds').invitation;
    assertPublicInvitation(fromB, [userA.id, userA.email]);
    assertPublicInvitation(fromD, [userC.id, userC.email]);
    assert.equal(fromB.approvals.host, null);
    assert.equal(fromB.approvals.guest, fromB.version);
    assert.equal(fromD.approvals.host, null);
    assert.equal(fromD.approvals.guest, fromD.version);
    const [listA, listC] = await Promise.all([a.get('/api/invitations'), c.get('/api/invitations')]);
    const aInvitations = succeeds(listA, 'A list').invitations, cInvitations = succeeds(listC, 'C list').invitations;
    assert.deepEqual(aInvitations.map(invitation => invitation.id).sort(), [...baselineA, invitationA.id].sort());
    assert.deepEqual(cInvitations.map(invitation => invitation.id).sort(), [...baselineC, invitationC.id].sort());
    assert.equal(aInvitations.find(invitation => invitation.id === invitationA.id).proposal.preferences.detail, '西餐');
    assert.equal(cInvitations.find(invitation => invitation.id === invitationC.id).proposal.preferences.detail, '日料');
    assert.ok(!aInvitations.some(invitation => invitation.id === invitationC.id));
    assert.ok(!cInvitations.some(invitation => invitation.id === invitationA.id));
    const approvedA = succeeds(await a.post(`${ownerPath(invitationA.id)}/actions`, {
      type: 'confirm', version: fromB.version, requestId: randomUUID(),
    }), 'A confirms B choice').invitation;
    const approvedC = succeeds(await c.post(`${ownerPath(invitationC.id)}/actions`, {
      type: 'confirm', version: fromD.version, requestId: randomUUID(),
    }), 'C confirms D choice').invitation;
    for (const approved of [approvedA, approvedC]) assert.deepEqual(approved.approvals, { host: approved.version, guest: approved.version });
  });

  await t.test('two changes to one version commit exactly once and stale confirmations fail', async () => {
    const before = await getOwner(a, invitationA.id);
    const updates = await Promise.all(['并发地点一', '并发地点二'].map(place => a.post(`${ownerPath(invitationA.id)}/actions`, {
      type: 'propose', version: before.version, proposal: { place }, requestId: randomUUID(),
    })));
    const successful = updates.filter(response => response.status >= 200 && response.status < 300);
    const rejected = updates.filter(response => response.status === 409);
    assert.equal(successful.length, 1, JSON.stringify(updates));
    assert.equal(rejected.length, 1, JSON.stringify(updates));
    fails(rejected[0], 409, 'concurrent losing update');
    const after = await getOwner(a, invitationA.id);
    assert.equal(after.version, before.version + 1);
    assert.ok(['并发地点一', '并发地点二'].includes(after.proposal.place));
    assert.deepEqual(after.proposal.preferences, before.proposal.preferences);
    assert.equal(after.approvals.guest, null);
    fails(await b.post(`${guestPath(tokenB)}/actions`, {
      type: 'confirm', version: before.version, requestId: randomUUID(),
    }), 409, 'stale guest confirmation');
    assert.deepEqual(await getOwner(a, invitationA.id), after);
    const confirmed = succeeds(await b.post(`${guestPath(tokenB)}/actions`, {
      type: 'confirm', version: after.version, requestId: randomUUID(),
    }), 'guest confirms current version').invitation;
    assertPublicInvitation(confirmed, [userA.id, userA.email]);
    assert.deepEqual(confirmed.approvals, { host: after.version, guest: after.version });
  });

  await t.test('mutation retries return the first response without another version and reject changed payloads', async () => {
    const before = await getOwner(a, invitationA.id);
    const action = { type: 'propose', version: before.version, proposal: { time: '19:15' }, requestId: randomUUID() };
    const first = await a.post(`${ownerPath(invitationA.id)}/actions`, action);
    succeeds(first, 'first proposal');
    const replay = await a.post(`${ownerPath(invitationA.id)}/actions`, action);
    succeeds(replay, 'same proposal retry despite its now-old version');
    assert.deepEqual(replay.body, first.body);
    fails(await a.post(`${ownerPath(invitationA.id)}/actions`, { ...action, proposal: { time: '19:45' } }), 409, 'idempotency key conflict');
    const after = await getOwner(a, invitationA.id);
    assert.equal(after.version, before.version + 1);
    assert.equal(after.proposal.time, '19:15');
    assert.deepEqual(after.proposal.preferences, before.proposal.preferences);
    const guestAction = { type: 'confirm', version: after.version, requestId: randomUUID() };
    const guestFirst = await b.post(`${guestPath(tokenB)}/actions`, guestAction);
    succeeds(guestFirst, 'first guest confirmation');
    const guestReplay = await b.post(`${guestPath(tokenB)}/actions`, guestAction);
    succeeds(guestReplay, 'guest retry');
    assert.deepEqual(guestReplay.body, guestFirst.body);
    fails(await b.post(`${guestPath(tokenB)}/actions`, { ...guestAction, type: 'propose', proposal: { place: '重用请求的不同内容' } }), 409, 'guest idempotency conflict');
    assert.equal((await getOwner(a, invitationA.id)).version, after.version);
  });

  await t.test('replaying an earlier action after a later commit returns its original response snapshot', async () => {
    const before = await getOwner(a, invitationA.id);
    const firstAction = { type: 'propose', version: before.version, proposal: { time: '19:20' }, requestId: randomUUID() };
    const first = await a.post(`${ownerPath(invitationA.id)}/actions`, firstAction);
    const firstInvitation = succeeds(first, 'first snapshot-producing proposal').invitation;
    // Make the two real database commits distinguishable at JSON timestamp precision.
    await new Promise(resolve => setTimeout(resolve, 10));
    const later = succeeds(await a.post(`${ownerPath(invitationA.id)}/actions`, {
      type: 'propose', version: firstInvitation.version, proposal: { time: '19:50' }, requestId: randomUUID(),
    }), 'later proposal advances the invitation').invitation;
    assert.equal(later.version, firstInvitation.version + 1);
    assert.notEqual(later.updatedAt, firstInvitation.updatedAt);
    const latestBeforeReplay = await getOwner(a, invitationA.id);
    const replay = await a.post(`${ownerPath(invitationA.id)}/actions`, firstAction);
    succeeds(replay, 'replay earlier request after a newer commit');
    assert.equal(replay.body.invitation.updatedAt, firstInvitation.updatedAt, 'An idempotent response must retain its original timestamp, not current-row metadata');
    assert.deepEqual(replay, first, 'Idempotency replays the entire first HTTP response snapshot');
    assert.deepEqual(await getOwner(a, invitationA.id), latestBeforeReplay, 'Replaying history must neither change nor roll back the latest stored invitation');
  });

  await t.test('sign-out invalidates both the browser cookie and the server session while C remains signed in', async () => {
    const oldCookie = a.cookie();
    succeeds(await a.post('/api/auth/sign-out', {}), 'A signs out');
    assert.equal(succeeds(await a.get('/api/session'), 'A session after sign-out').user, null);
    fails(await a.get('/api/invitations'), 401, 'signed-out owner list');
    fails(await a.post('/api/invitations', { draft: draftA, requestId: randomUUID() }), 401, 'signed-out owner creation');
    const replayedSession = clientFor(origin, oldCookie);
    assert.equal(succeeds(await replayedSession.get('/api/session'), 'old cookie replay after sign-out').user, null);
    fails(await replayedSession.get('/api/invitations'), 401, 'invalidated old cookie cannot list invitations');
    assert.equal(succeeds(await c.get('/api/session'), 'C unaffected session').user.email, 'c@example.test');
    succeeds(await c.post('/api/auth/sign-out', {}), 'C signs out');
  });
});

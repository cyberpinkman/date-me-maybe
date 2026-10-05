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
  assert.ok(['55439', '65500'].includes(url.port), 'Only the isolated host ports 55439 or 65500 are allowed; host port 5432 is never accessed');
  // pg permits these query parameters to override the URL's host and port.
  assert.ok(!url.searchParams.has('host') && !url.searchParams.has('port'), 'TEST_DATABASE_URL must not override its host or port through query parameters');
  assert.equal(decodeURIComponent(url.pathname), '/date_me_maybe_test', 'The integration database must be named date_me_maybe_test');
  return url;
}

function assertConnectedDatabase(actualDatabase) {
  assert.equal(actualDatabase.name, 'date_me_maybe_test', 'The connected database must be the dedicated integration test database');
}

test('integration database guard only permits explicit local test destinations', () => {
  for (const hostname of ['127.0.0.1', 'localhost']) {
    for (const port of ['55439', '65500']) {
      assert.doesNotThrow(() => assertIsolatedDatabase(`postgres://test@${hostname}:${port}/date_me_maybe_test`));
    }
  }
  for (const value of [
    'https://127.0.0.1:65500/date_me_maybe_test',
    'postgres://test@example.invalid:65500/date_me_maybe_test',
    'postgres://test@127.0.0.1:5432/date_me_maybe_test',
    'postgres://test@127.0.0.1/date_me_maybe_test',
    'postgres://test@127.0.0.1:65500/date_me_maybe',
    'postgres://test@127.0.0.1:65500/date_me_maybe_test?host=example.invalid',
    'postgres://test@127.0.0.1:65500/date_me_maybe_test?port=5432',
  ]) assert.throws(() => assertIsolatedDatabase(value));
});

test('connected database identity is independent of an internal port behind a mapping', () => {
  assertIsolatedDatabase('postgres://test@127.0.0.1:65500/date_me_maybe_test');
  for (const port of [5432, 65500]) {
    assert.doesNotThrow(() => assertConnectedDatabase({ name: 'date_me_maybe_test', port }));
  }
  assert.throws(() => assertConnectedDatabase({ name: 'another_database', port: 65500 }));
});

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

async function updateFixtureState(pool, id, state) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('opendater.calendar_writer', 'v1', true)");
    await client.query('UPDATE invitations SET state=$1 WHERE id=$2', [state, id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
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
  assertIsolatedDatabase(databaseUrl);
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
  // The URL guard owns the client destination. PostgreSQL may listen on a
  // different internal port (for example CI's host 65500 -> container 5432).
  const actualDatabase = (await pool.query('SELECT current_database() AS name')).rows[0];
  assertConnectedDatabase(actualDatabase);
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
  const runId = randomUUID();
  const emailA = `a-${runId}@example.test`, emailC = `c-${runId}@example.test`;
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
    userA = await signIn(a, emailA, true);
    userC = await signIn(c, emailC);
    t.after(async () => {
      const cleanup = new Pool({ connectionString: databaseUrl });
      try { await cleanup.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[userA.id, userC.id]]); }
      finally { await cleanup.end(); }
    });
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

  await t.test('legacy invitations and persisted scalar details remain readable and can finalize into detail sets', async () => {
    const legacy = succeeds(await c.post('/api/invitations', { draft: { ...draftC, options: [{ date: futureDate(8), time: '18:30' }] }, requestId: randomUUID() }), 'create legacy invitation').invitation;
    const token = new URL(legacy.shareUrl).pathname.split('/').at(-1);
    const response = succeeds(await d.post(`${guestPath(token)}/actions`, {
      type: 'respond', version: legacy.version, requestId: randomUUID(),
      proposal: { date: futureDate(8), time: '18:30', place: '河边入口', activity: '', activities: ['散个步'], preferences: { hints: [], details: { '散个步': '沿着河边走' } } },
    }), 'new guest flow responds to legacy invitation').invitation;
    assert.equal(response.mode, 'fixed');
    assert.deepEqual(response.proposal.activities, ['散个步']);
    assert.deepEqual(response.proposal.preferences.details, { '散个步': ['沿着河边走'] }, 'An old client scalar is accepted and persisted as a set');
    assert.equal(response.proposal.activity, '', 'Even a one-item range requires the host to finalize');
    assert.equal(response.approvals.host, null);
    fails(await c.post(`${ownerPath(legacy.id)}/actions`, { type: 'confirm', version: response.version, requestId: randomUUID() }), 422, 'legacy invitation cannot bypass activity selection');

    // Reproduce the JSONB representation already stored by v0.3, scoped to
    // this new fixture. Reading must remain compatible without a migration.
    const oldState = (await pool.query('SELECT state FROM invitations WHERE id=$1', [legacy.id])).rows[0].state;
    oldState.proposal.preferences.details['散个步'] = '沿着河边走';
    await updateFixtureState(pool, legacy.id, oldState);
    assert.equal((await getOwner(c, legacy.id)).proposal.preferences.details['散个步'], '沿着河边走');
    assert.equal(succeeds(await d.get(guestPath(token)), 'read persisted scalar as guest').invitation.proposal.preferences.details['散个步'], '沿着河边走');
    const finalize = { type: 'finalize', version: response.version, requestId: randomUUID(), proposal: { activity: '散个步' } };
    const finalResponse = await c.post(`${ownerPath(legacy.id)}/actions`, finalize);
    const final = succeeds(finalResponse, 'finalize an old persisted scalar snapshot').invitation;
    assert.deepEqual(final.proposal.preferences.details, { '散个步': ['沿着河边走'] });
    assert.equal(final.proposal.preferences.detail, '沿着河边走');
    assert.deepEqual(final.approvals, { host: final.version, guest: final.version });
    assert.deepEqual(await getOwner(c, legacy.id), final, 'The canonical set survives a separate database read');
    assert.deepEqual(await c.post(`${ownerPath(legacy.id)}/actions`, finalize), finalResponse, 'An old snapshot finalization replays its full canonical response');
  });

  await t.test('open invitations enforce guest scope and atomically finalize one accepted activity', async () => {
    const draft = { from: 'A', to: 'B', tone: 'playful', message: '具体怎么见面，想听听你的。', mode: 'open', timeZone: 'Asia/Shanghai' };
    fails(await a.post('/api/invitations', { draft: { ...draft, activity: '喝杯咖啡' }, requestId: randomUUID() }), 422, 'open draft cannot preset an arrangement');
    const created = succeeds(await a.post('/api/invitations', { draft, requestId: randomUUID() }), 'create open invitation').invitation;
    assert.equal(created.mode, 'open');
    assert.deepEqual(created.options, []);
    assert.equal(created.proposal, null);
    const token = new URL(created.shareUrl).pathname.split('/').at(-1);
    const hostActions = `${ownerPath(created.id)}/actions`, guestActions = `${guestPath(token)}/actions`;
    const proposal = {
      date: futureDate(9), time: '18:30', place: '  咖啡店门口  ', activity: '',
      activities: ['喝杯咖啡', '吃点好吃的', '喝杯咖啡'],
      preferences: { hints: ['想多待一会儿'], details: { '喝杯咖啡': ['有阳光的窗边', ' 安静的小店 ', '安静的小店'], '吃点好吃的': ['西餐', '日料'] } },
    };
    const expectedDetails = { '喝杯咖啡': ['安静的小店', '有阳光的窗边'], '吃点好吃的': ['日料', '西餐'] };
    const respond = patch => ({ type: 'respond', version: created.version, requestId: randomUUID(), proposal: { ...proposal, ...patch } });
    for (const patch of [
      { place: '' }, { date: '2000-01-01' }, { activities: [] },
      { activities: ['不在列表的活动'] }, { activity: '喝杯咖啡' },
      { preferences: { hints: [], details: { '散个步': '公园慢慢走' } } },
      { preferences: { hints: [], details: { '喝杯咖啡': ['安静的小店', '火锅'] } } },
      { preferences: { hints: [], details: { '喝杯咖啡': ['安静的小店', ''] } } },
      { preferences: { hints: [], details: { '喝杯咖啡': Array(10).fill('安静的小店') } } },
    ]) fails(await b.post(guestActions, respond(patch)), 422, 'invalid guest arrangement');
    assert.deepEqual(await getOwner(a, created.id), created, 'Invalid arrangements do not advance state');

    const guest = succeeds(await b.post(guestActions, respond({})), 'guest submits accepted activities').invitation;
    assertPublicInvitation(guest, [userA.id, userA.email]);
    assert.equal(guest.proposal.place, '咖啡店门口');
    assert.deepEqual(new Set(guest.proposal.activities), new Set(['喝杯咖啡', '吃点好吃的']));
    assert.equal(guest.proposal.activities.length, 2);
    assert.equal(guest.proposal.activity, '');
    assert.deepEqual(guest.proposal.preferences.details, expectedDetails);
    assert.equal(guest.proposal.preferences.detail, '');
    assert.deepEqual((await getOwner(a, created.id)).proposal.preferences.details, expectedDetails, 'Sets survive owner reads');
    assert.deepEqual(succeeds(await b.get(guestPath(token)), 'read guest detail sets').invitation.proposal.preferences.details, expectedDetails, 'Sets survive anonymous reads');
    assert.deepEqual((await pool.query('SELECT state FROM invitations WHERE id=$1', [created.id])).rows[0].state.proposal.preferences.details, expectedDetails, 'The database stores canonical arrays, not flattened labels');
    assert.deepEqual(guest.approvals, { host: null, guest: guest.version });
    const selection = activity => ({ type: 'finalize', version: guest.version, requestId: randomUUID(), proposal: { activity } });
    const shortcut = await a.post(hostActions, { type: 'confirm', version: guest.version, requestId: randomUUID() });
    fails(shortcut, 422, 'ordinary confirm cannot finalize an unresolved range');
    assert.equal(shortcut.body.error.code, 'ACTIVITY_SELECTION_REQUIRED');
    fails(await b.post(guestActions, selection('喝杯咖啡')), 422, 'guest cannot finalize');
    fails(await c.post(hostActions, selection('喝杯咖啡')), 404, 'another owner cannot finalize');
    fails(await a.post(hostActions, selection('散个步')), 422, 'host cannot select outside the guest range');
    fails(await a.post(hostActions, { ...selection('喝杯咖啡'), proposal: { activity: '喝杯咖啡', place: '换个地点' } }), 422, 'finalize cannot change other fields');
    fails(await a.post(hostActions, { ...selection('喝杯咖啡'), proposal: { activity: '喝杯咖啡', preferences: { details: { '喝杯咖啡': ['咖啡加甜品'] } } } }), 422, 'finalize cannot alter accepted details');
    for (const patch of [
      { place: '新地点' },
      { activity: '喝杯咖啡', activities: ['喝杯咖啡', '散个步'] },
      { activity: '喝杯咖啡', preferences: { details: { '喝杯咖啡': ['安静的小店'], '吃点好吃的': expectedDetails['吃点好吃的'] } } },
      { activity: '喝杯咖啡', preferences: { details: { '喝杯咖啡': [...expectedDetails['喝杯咖啡'], '咖啡加甜品'], '吃点好吃的': expectedDetails['吃点好吃的'] } } },
    ]) fails(await a.post(hostActions, { type: 'propose', version: guest.version, requestId: randomUUID(), proposal: patch }), 422, 'host proposal must honor the guest range');
    assert.equal((await getOwner(a, created.id)).version, guest.version);

    const selections = ['喝杯咖啡', '吃点好吃的'].map(selection);
    const results = await Promise.all(selections.map(event => a.post(hostActions, event)));
    const winningIndex = results.findIndex(response => response.status === 200);
    assert.ok(winningIndex >= 0);
    assert.equal(results.filter(response => response.status === 200).length, 1);
    assert.equal(results.filter(response => response.status === 409).length, 1);
    const finalResponse = results[winningIndex];
    const final = finalResponse.body.invitation;
    assert.equal(final.version, guest.version + 1);
    assert.equal(final.proposal.activity, selections[winningIndex].proposal.activity);
    assert.deepEqual(final.proposal.preferences.details, guest.proposal.preferences.details);
    assert.equal(final.proposal.preferences.detail, expectedDetails[final.proposal.activity].join('、'), 'The display alias preserves all preferences for the selected activity');
    assert.deepEqual((await getOwner(a, created.id)).proposal, final.proposal);
    assert.deepEqual(succeeds(await b.get(guestPath(token)), 'read finalized guest detail sets').invitation.proposal, final.proposal);
    assert.deepEqual(final.approvals, { host: final.version, guest: final.version });
    fails(await b.post(guestActions, { type: 'confirm', version: guest.version, requestId: randomUUID() }), 409, 'old guest version cannot confirm a newer plan');
    fails(await a.post(hostActions, { ...selections[winningIndex], proposal: { activity: selections[1 - winningIndex].proposal.activity } }), 409, 'finalization request id cannot select another activity');

    const revised = succeeds(await b.post(guestActions, {
      type: 'propose', version: final.version, requestId: randomUUID(),
      proposal: { activities: ['散个步'], activity: '', preferences: { details: { '散个步': [] } } },
    }), 'guest may revise their own activity range').invitation;
    assert.equal(revised.proposal.activity, '');
    assert.deepEqual(revised.proposal.preferences.details, { '散个步': [] }, 'Skipping a preference is an empty set');
    assert.equal(revised.approvals.host, null);
    assert.deepEqual(await a.post(hostActions, selections[winningIndex]), finalResponse, 'Finalization retries retain their first response after later changes');
    assert.deepEqual(await getOwner(a, created.id), { ...revised, shareUrl: created.shareUrl });

    const changed = succeeds(await a.post(hostActions, {
      type: 'propose', version: revised.version, requestId: randomUUID(),
      proposal: { activity: '散个步', time: '20:15', place: '河边入口' },
    }), 'host may choose an allowed activity while proposing a different arrangement').invitation;
    assert.deepEqual(changed.proposal.activities, ['散个步']);
    assert.equal(changed.proposal.preferences.detail, '');
    assert.equal(changed.approvals.host, changed.version);
    assert.equal(changed.approvals.guest, null, 'A changed time or place needs guest approval');
    const agreed = succeeds(await b.post(guestActions, { type: 'confirm', version: changed.version, requestId: randomUUID() }), 'guest accepts the revised selected plan').invitation;
    assert.deepEqual(agreed.approvals, { host: agreed.version, guest: agreed.version });
  });

  await t.test('full scopes delegate final time, place, activity and detail to the opposite role in either mode', async () => {
    const plan = {
      timeOptions: [{ date: futureDate(10), time: '18:30' }, { date: futureDate(11), time: '20:00' }],
      placeOptions: ['公园南门', '咖啡店门口'], activities: ['吃点好吃的', '喝杯咖啡'],
      preferences: { hints: ['轻松随意就好'], details: { '吃点好吃的': ['日料', '火锅'], '喝杯咖啡': ['安静的小店', '有阳光的窗边'] } },
    };
    for (const mode of ['host', 'open']) {
      const offset = mode === 'host' ? 0 : 5;
      plan.timeOptions = [{ date: futureDate(10 + offset), time: '18:30' }, { date: futureDate(11 + offset), time: '20:00' }];
      const draft = { from: 'A', to: 'B', tone: 'playful', message: '一起敲定每一个小安排。', mode, timeZone: 'Asia/Shanghai', ...(mode === 'host' ? { plan } : {}) };
      const created = succeeds(await a.post('/api/invitations', { draft, requestId: randomUUID() }), `create ${mode} scope invitation`).invitation;
      const token = new URL(created.shareUrl).pathname.split('/').at(-1);
      const hostActions = `${ownerPath(created.id)}/actions`, guestActions = `${guestPath(token)}/actions`;
      const owner = mode === 'host' ? { client: a, path: hostActions, role: 'host' } : { client: b, path: guestActions, role: 'guest' };
      const chooser = mode === 'host' ? { client: b, path: guestActions, role: 'guest' } : { client: a, path: hostActions, role: 'host' };
      let offered = created;
      if (mode === 'open') offered = succeeds(await b.post(guestActions, { type: 'respond', version: created.version, requestId: randomUUID(), proposal: plan }), 'guest offers a full scope').invitation;
      else fails(await b.post(guestActions, { type: 'respond', version: created.version, requestId: randomUUID(), proposal: plan }), 422, 'host-mode guest cannot replace the host scope');
      assert.deepEqual(offered.proposal.timeOptions, plan.timeOptions);
      assert.equal(offered.proposal.date, '');
      assert.equal(offered.proposal.place, '');
      assert.equal(offered.proposal.activity, '');
      assert.deepEqual(offered.approvals, { host: owner.role === 'host' ? offered.version : null, guest: owner.role === 'guest' ? offered.version : null });
      const selected = { ...plan.timeOptions[1], place: '公园南门', activity: '吃点好吃的', detail: '火锅' };
      const finalize = patch => ({ type: 'finalize', version: offered.version, requestId: randomUUID(), proposal: { ...selected, ...patch } });
      const before = await getOwner(a, created.id);
      for (const patch of [
        { date: plan.timeOptions[0].date }, // Date and time must belong to the same offered pair.
        { place: '没提供过的地方' }, { activity: '散个步' },
        { detail: '安静的小店' }, { detail: '日料、火锅' }, { detail: '' },
        { scopeOwner: chooser.role }, { preferences: { details: { '吃点好吃的': ['火锅'] } } },
      ]) fails(await chooser.client.post(chooser.path, finalize(patch)), 422, `${mode}: choice must stay inside every scope dimension`);
      fails(await chooser.client.post(chooser.path, { type: 'finalize', version: offered.version, requestId: randomUUID(), proposal: { activity: '吃点好吃的' } }), 422, 'Ambiguous omitted choices cannot be auto-filled');
      fails(await owner.client.post(owner.path, finalize({})), 422, 'The scope author cannot act as the opposite chooser');
      fails(await c.post(hostActions, finalize({})), 404, 'An unrelated account cannot choose');
      fails(await chooser.client.post(chooser.path, { type: 'confirm', version: offered.version, requestId: randomUUID() }), 422, 'Confirm cannot skip unresolved dimensions');
      fails(await chooser.client.post(chooser.path, { type: 'propose', version: offered.version, requestId: randomUUID(), proposal: { place: '没提供过的地方' } }), 409, 'Pending chooser cannot bypass the offered scope through rescheduling');
      assert.deepEqual(await getOwner(a, created.id), before, 'Rejected selections neither advance the version nor change consent');

      const action = finalize({});
      const finalResponse = await chooser.client.post(chooser.path, action);
      const final = succeeds(finalResponse, `${mode}: opposite role selects the final arrangement`).invitation;
      assert.deepEqual(final.proposal.timeOptions, offered.proposal.timeOptions);
      assert.deepEqual(final.proposal.placeOptions, offered.proposal.placeOptions);
      assert.deepEqual(final.proposal.preferences.details, offered.proposal.preferences.details);
      assert.equal(final.proposal.preferences.detail, '火锅', 'A new full scope chooses one concrete preference, not the old joined alias');
      assert.deepEqual([final.proposal.date, final.proposal.time, final.proposal.place, final.proposal.activity], [selected.date, selected.time, selected.place, selected.activity]);
      assert.deepEqual(final.approvals, { host: final.version, guest: final.version });
      const guestView = succeeds(await b.get(guestPath(token)), 'read selected scope anonymously').invitation;
      assertPublicInvitation(guestView, [userA.id, userA.email]);
      assert.deepEqual(guestView.proposal, (await getOwner(a, created.id)).proposal);
      assert.deepEqual(await chooser.client.post(chooser.path, action), finalResponse, 'Finalization replay returns its original complete snapshot');

      const rescheduled = succeeds(await a.post(hostActions, {
        type: 'propose', version: final.version, requestId: randomUUID(), proposal: { date: futureDate(12 + offset), time: '19:15', place: '新集合点' },
      }), 'An agreed plan may be rescheduled for fresh consent').invitation;
      assert.deepEqual(rescheduled.proposal.timeOptions, [{ date: futureDate(12 + offset), time: '19:15' }]);
      assert.deepEqual(rescheduled.proposal.placeOptions, ['新集合点']);
      assert.equal(rescheduled.proposal.preferences.detail, '火锅');
      assert.deepEqual(rescheduled.approvals, { host: rescheduled.version, guest: null });
      assert.deepEqual(await chooser.client.post(chooser.path, action), finalResponse, 'An earlier choice replay cannot roll back a later proposed schedule');
      const reconfirmed = succeeds(await b.post(guestActions, { type: 'confirm', version: rescheduled.version, requestId: randomUUID() }), 'The other person confirms the revised time and place').invitation;
      assert.deepEqual(reconfirmed.approvals, { host: reconfirmed.version, guest: reconfirmed.version });
    }
  });

  await t.test('unique full scopes allow opposite confirmation and retained expired alternatives do not block a future choice', async () => {
    const unique = {
      timeOptions: [{ date: futureDate(13), time: '18:30' }], placeOptions: ['公园南门'], activities: ['散个步'],
      preferences: { hints: [], details: { '散个步': [] } },
    };
    for (const mode of ['host', 'open']) {
      unique.timeOptions = [{ date: futureDate(mode === 'host' ? 13 : 18), time: '18:30' }];
      const created = succeeds(await a.post('/api/invitations', { draft: { from: 'A', to: 'B', tone: 'playful', message: '这次就这样见吧。', mode, ...(mode === 'host' ? { plan: unique } : {}) }, requestId: randomUUID() }), 'create unique scope').invitation;
      const token = new URL(created.shareUrl).pathname.split('/').at(-1);
      const guestActions = `${guestPath(token)}/actions`, hostActions = `${ownerPath(created.id)}/actions`;
      const offered = mode === 'host' ? created : succeeds(await b.post(guestActions, { type: 'respond', version: created.version, requestId: randomUUID(), proposal: unique }), 'guest offers unique choices').invitation;
      assert.equal(offered.proposal.date, unique.timeOptions[0].date);
      assert.equal(offered.proposal.activity, '散个步');
      assert.equal(offered.proposal.preferences.detail, '');
      const chooser = mode === 'host' ? b : a, path = mode === 'host' ? guestActions : hostActions;
      const confirmed = succeeds(await chooser.post(path, { type: 'confirm', version: offered.version, requestId: randomUUID() }), 'The other person may confirm all unique choices').invitation;
      assert.deepEqual(confirmed.approvals, { host: confirmed.version, guest: confirmed.version });
    }

    const plan = { ...unique, timeOptions: [{ date: futureDate(19), time: '18:30' }, { date: futureDate(20), time: '20:00' }] };
    const created = succeeds(await a.post('/api/invitations', { draft: { from: 'A', to: 'B', tone: 'playful', message: '挑个仍方便的时间吧。', mode: 'host', plan }, requestId: randomUUID() }), 'create expiring candidate fixture').invitation;
    const token = new URL(created.shareUrl).pathname.split('/').at(-1);
    // Simulate time passing for one stored alternative, without changing the
    // public contract or any unrelated row in the isolated test database.
    const state = (await pool.query('SELECT state FROM invitations WHERE id=$1', [created.id])).rows[0].state;
    state.proposal.timeOptions[0].date = '2000-01-01';
    await updateFixtureState(pool, created.id, state);
    const final = succeeds(await b.post(`${guestPath(token)}/actions`, { type: 'finalize', version: created.version, requestId: randomUUID(), proposal: { ...plan.timeOptions[1] } }), 'Select a future slot while retaining an expired unchosen alternative').invitation;
    assert.equal(final.proposal.date, plan.timeOptions[1].date);
    assert.equal(final.proposal.timeOptions[0].date, '2000-01-01', 'The originally offered range remains intact');
    assert.deepEqual(final.approvals, { host: final.version, guest: final.version });
  });

  await t.test('calendar HTTP contract keeps guests anonymous and shares confirmed occupancy across roles', async () => {
    fails(await anonymous.get('/api/schedule'), 401, 'A personal calendar requires an account');
    fails(await anonymous.post('/api/schedule', { schedule: {} }), 401, 'An anonymous request cannot replace a calendar');
    const schedule = {
      timeZone: 'Asia/Shanghai',
      weekly: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, [{ start: '18:00', end: '23:00' }]])),
      overrides: { [futureDate(25)]: [] },
    };
    succeeds(await a.post('/api/schedule', { schedule }), 'Save weekly hours and a date-specific day off');
    const ownCalendar = succeeds(await a.get('/api/schedule'), 'Read private calendar');
    assert.equal(ownCalendar.schedule.configured, true);
    assert.deepEqual(ownCalendar.schedule.overrides, schedule.overrides);
    assert.equal(succeeds(await c.get('/api/schedule'), 'C has independent settings').schedule.configured, false);

    const draft = { from: 'A', to: 'B', tone: 'playful', message: '选个空闲的晚上见吧。', mode: 'open', timeZone: 'Asia/Shanghai', timePolicy: 'schedule', durationMinutes: 120 };
    const created = succeeds(await a.post('/api/invitations', { draft, requestId: randomUUID() }), 'Create a calendar invitation').invitation;
    const token = new URL(created.shareUrl).pathname.split('/').at(-1);
    const guestActions = `${guestPath(token)}/actions`, hostActions = `${ownerPath(created.id)}/actions`;
    const availability = succeeds(await b.get(`${guestPath(token)}/availability`), 'Guest can read available times without signing in');
    assert.equal(availability.durationMinutes, 120);
    assert.equal(availability.timeZone, 'Asia/Shanghai');
    assert.ok(availability.slots.some(slot => slot.date === futureDate(21) && slot.time === '19:00'));
    assert.ok(!availability.slots.some(slot => slot.date === futureDate(25)), 'A date override closes that day');
    assert.ok(!availability.slots.some(slot => slot.time === '21:30'), 'A two-hour date must fit completely');
    assert.ok(!JSON.stringify(availability).includes(userA.id));
    assert.ok(!JSON.stringify(availability).includes(userA.email));
    fails(await c.get(`${ownerPath(created.id)}/availability`), 404, 'Foreign account cannot inspect owner route');
    const plan = { timeOptions: [{ date: futureDate(21), time: '19:00' }, { date: futureDate(22), time: '19:00' }], placeOptions: ['公园门口'], activities: ['散个步'], preferences: { hints: [], details: { '散个步': [] } } };
    fails(await b.post(guestActions, { type: 'respond', version: created.version, requestId: randomUUID(), proposal: { ...plan, timeOptions: [{ date: futureDate(25), time: '19:00' }] } }), 409, 'A forged response cannot bypass closed hours');
    const pending = succeeds(await b.post(guestActions, { type: 'respond', version: created.version, requestId: randomUUID(), proposal: plan }), 'Submit two candidate times').invitation;
    assert.equal(pending.booking, null, 'Candidate ranges reserve no time');
    assert.equal(succeeds(await b.get('/api/session'), 'Guest remains anonymous').user, null);
    fails(await b.post(`${guestPath(token)}/bind`, {}), 401, 'Binding alone requires an account');
    fails(await a.post(`${guestPath(token)}/bind`, {}), 422, 'Host preview cannot bind the host as their own guest');
    assert.equal(succeeds(await c.get(guestPath(token)), 'A signed-in guest reading the link').invitation.calendarBound, false, 'Reading a link never silently binds an account');
    const bound = succeeds(await c.post(`${guestPath(token)}/bind`, {}), 'C explicitly joins their calendar').invitation;
    assert.equal(bound.calendarBound, true);
    assert.equal(bound.booking, null);

    const parallel = succeeds(await a.post('/api/invitations', { draft, requestId: randomUUID() }), 'Another pending invite may offer the same candidates').invitation;
    const parallelToken = new URL(parallel.shareUrl).pathname.split('/').at(-1);
    const parallelPending = succeeds(await d.post(`${guestPath(parallelToken)}/actions`, { type: 'respond', version: parallel.version, requestId: randomUUID(), proposal: plan }), 'Second guest selects overlapping candidates').invitation;
    const final = succeeds(await a.post(hostActions, { type: 'finalize', version: pending.version, requestId: randomUUID(), proposal: { ...plan.timeOptions[0] } }), 'Owner confirms one candidate').invitation;
    assert.ok(final.booking?.start && final.booking?.end);
    assert.equal(Date.parse(final.booking.end) - Date.parse(final.booking.start), 120 * 60_000);
    const receivedCalendar = succeeds(await c.get('/api/schedule'), 'Bound received invite appears on guest calendar');
    const received = receivedCalendar.bookings.find(item => item.invitationId === final.id);
    assert.equal(received?.role, 'guest');
    assert.equal(received.guestUrl, created.shareUrl);
    fails(await a.post(`${ownerPath(parallel.id)}/actions`, { type: 'finalize', version: parallelPending.version, requestId: randomUUID(), proposal: { ...plan.timeOptions[0] } }), 409, 'A stale candidate cannot double-book the host');
    assert.equal((await getOwner(a, parallel.id)).version, parallelPending.version, 'Failed confirmation leaves consent unchanged');
    const remaining = succeeds(await d.get(`${guestPath(parallelToken)}/availability`), 'Availability reflects a different invite confirmation');
    assert.equal(remaining.candidateSlots[0].available, false);
    assert.equal(remaining.candidateSlots[1].available, true);
    const busy = { date: plan.timeOptions[0].date, time: '20:00', durationMinutes: 60, label: '自己留一点时间', requestId: randomUUID() };
    fails(await c.post('/api/schedule/busy', busy), 409, 'Received bookings also block the bound account');

    const change = succeeds(await a.post(hostActions, { type: 'propose', version: final.version, requestId: randomUUID(), proposal: { date: futureDate(23), time: '19:00', place: '新集合点' } }), 'Propose another date').invitation;
    assert.deepEqual(change.booking, final.booking, 'A pending reschedule retains the confirmed slot');
    const changed = succeeds(await b.post(guestActions, { type: 'confirm', version: change.version, requestId: randomUUID() }), 'Anonymous counterpart accepts the changed date').invitation;
    assert.equal(changed.booking.date, futureDate(23));
    assert.notEqual(changed.booking.start, final.booking.start);
    const cancellation = { type: 'cancel', version: changed.version, requestId: randomUUID() };
    const cancelledResponse = await a.post(hostActions, cancellation);
    const cancelled = succeeds(cancelledResponse, 'Cancel an accepted invitation from management').invitation;
    assert.equal(cancelled.closed, 'cancelled');
    assert.equal(cancelled.booking, null);
    assert.deepEqual(await a.post(hostActions, cancellation), cancelledResponse, 'Cancellation replay is idempotent');
    assert.ok(!succeeds(await c.get('/api/schedule'), 'Cancelled invite releases both calendars').bookings.some(item => item.invitationId === final.id));
    const withBusy = succeeds(await c.post('/api/schedule/busy', busy), 'A released slot accepts a manual busy interval');
    const manual = withBusy.busy.find(item => item.label === busy.label);
    assert.ok(manual?.id);
    fails(await a.post(`/api/schedule/busy/${manual.id}/remove`, {}), 404, 'Another owner cannot remove a busy interval');
    succeeds(await c.post(`/api/schedule/busy/${manual.id}/remove`, {}), 'Remove own manual busy interval');
    const retriedBusy = succeeds(await c.post('/api/schedule/busy', busy), 'A lost-response retry does not recreate a removed busy interval');
    assert.ok(!retriedBusy.busy.some(item => item.id === manual.id));
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
    assert.equal(succeeds(await c.get('/api/session'), 'C unaffected session').user.email, emailC);
    succeeds(await c.post('/api/auth/sign-out', {}), 'C signs out');
  });
});

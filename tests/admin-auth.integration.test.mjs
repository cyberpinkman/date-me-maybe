import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

function isolatedDatabase(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.ok(['55439', '65500'].includes(url.port));
  assert.equal(decodeURIComponent(url.pathname), '/date_me_maybe_test');
  assert.ok(!url.searchParams.has('host') && !url.searchParams.has('port'));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// Connect to a single local listener while preserving the real Host/Origin
// boundary. This does not depend on localhost resolving to IPv4 instead of IPv6.
function clientFor(transportOrigin, logicalOrigin, initialCookie = '') {
  const cookies = new Map(initialCookie.split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const split = value.indexOf('=');
    return [value.slice(0, split), value.slice(split + 1)];
  }));
  const cookie = () => [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await new Promise((resolve, reject) => {
      const request = httpRequest(new URL(path, transportOrigin), {
        method,
        headers: {
          Accept: 'application/json', Host: new URL(logicalOrigin).host,
          ...(cookie() ? { Cookie: cookie() } : {}),
          ...(method !== 'GET' ? { Origin: logicalOrigin, 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(name, item);
          }
          resolve({ status: response.statusCode, headers, text: Buffer.concat(chunks).toString('utf8') });
        });
      });
      request.on('error', reject);
      request.setTimeout(15_000, () => request.destroy(new Error('Test request timed out')));
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const setCookies = response.headers.getSetCookie();
    for (const line of setCookies) {
      const [pair, ...attributes] = line.split(';');
      const split = pair.indexOf('='), key = pair.slice(0, split), value = pair.slice(split + 1);
      if (!value || attributes.some(attribute => /^\s*max-age\s*=\s*0\s*$/i.test(attribute))) cookies.delete(key);
      else cookies.set(key, value);
    }
    const text = response.text;
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, body: data, headers: response.headers, setCookies };
  }
  return { request, cookie, get: (path, options) => request(path, options), post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body }) };
}

function success(response, context) {
  assert.ok(response.status >= 200 && response.status < 300, `${context}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

function denied(response, statuses, context) {
  assert.ok(statuses.includes(response.status), `${context}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  assert.equal(response.headers.get('cache-control'), 'no-store', `${context}: private responses cannot be cached`);
}

test('PostgreSQL + HTTP: admin audience, verified allowlist and host boundary', {
  skip: !databaseUrl && 'Set TEST_DATABASE_URL to the isolated local date_me_maybe_test database',
  timeout: 90_000,
}, async t => {
  isolatedDatabase(databaseUrl);
  const [{ Pool }, { createApplication }, { migrateDatabase }, { loadConfig }, { createMailer }] = await Promise.all([
    import('pg'), import('../server/app.mjs'), import('../server/db.mjs'), import('../server/config.mjs'), import('../server/mail.mjs'),
  ]);
  const base = new Pool({ connectionString: databaseUrl });
  assert.equal((await base.query('SELECT current_database() AS name')).rows[0].name, 'date_me_maybe_test');
  const schema = `admin_auth_${randomUUID().replaceAll('-', '')}`;
  await base.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
  await base.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 5, connectionTimeoutMillis: 5_000 });
  let server, userId;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.end();
    await base.query(`DROP SCHEMA ${schema} CASCADE`);
    await base.end();
  });
  // An independent ledger ensures the shared runner applies this fresh schema,
  // even when a previous integration suite created public.app_migrations.
  await pool.query('CREATE TABLE app_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const port = await freePort(), origin = `http://127.0.0.1:${port}`, adminOrigin = `http://localhost:${port}`;
  const runId = randomUUID(), adminEmail = `admin-${runId}@example.test`, otherEmail = `other-${runId}@example.test`;
  const config = loadConfig({
    DATABASE_URL: databaseUrl, APP_ORIGIN: origin, ADMIN_ORIGIN: adminOrigin, ADMIN_EMAILS: adminEmail,
    NODE_ENV: 'test', DEV_MAILBOX: '1', PORT: String(port),
    AUTH_SECRET: 'admin-integration-auth-secret-only-0123456789abcdef',
    SHARE_TOKEN_SECRET: 'admin-integration-share-secret-only-0123456789abcdef',
  });
  const mailer = createMailer(config), application = createApplication({ pool, config, mailer });
  await migrateDatabase({ pool, auth: application.auth });
  await new Promise((resolve, reject) => { server = application.app.listen(port, '127.0.0.1', resolve); server.once('error', reject); });
  const main = clientFor(origin, origin), admin = clientFor(origin, adminOrigin), anonymous = clientFor(origin, adminOrigin);
  const authPath = '/api/admin/auth', protectedPaths = ['/api/admin/overview', '/api/admin/users', `/api/admin/users/${randomUUID()}`, '/api/admin/invitations', `/api/admin/invitations/${randomUUID()}`];
  let mainCode, adminCode;

  await t.test('every data route requires an admin session and the configured Host cannot be spoofed with forwarding headers', async () => {
    assert.equal(success(await anonymous.get('/api/admin/session'), 'anonymous admin session').user, null);
    for (const path of protectedPaths) denied(await anonymous.get(path), [401], `anonymous ${path}`);
    for (const path of ['/api/admin/session', ...protectedPaths]) {
      denied(await main.get(path, { headers: { 'X-Forwarded-Host': new URL(adminOrigin).host } }), [404, 403], `main host ${path}`);
    }
    const mixedCase = await main.get('/api/ADMIN/session');
    assert.ok([403, 404].includes(mixedCase.status), 'Express path matching must not bypass the admin host gate through mixed case');
    const before = mailer.getInbox().length;
    denied(await main.post(`${authPath}/email-otp/send-verification-otp`, { email: adminEmail, type: 'sign-in' }, { headers: { Origin: adminOrigin, 'X-Forwarded-Host': new URL(adminOrigin).host } }), [404, 403], 'forwarded host cannot unlock admin auth');
    denied(await anonymous.post(`${authPath}/email-otp/send-verification-otp`, { email: adminEmail, type: 'sign-in' }, { headers: { Origin: origin } }), [403], 'main origin cannot initiate admin authentication');
    assert.equal(mailer.getInbox().length, before);
  });

  await t.test('unlisted email and unsupported auth endpoints cannot send codes, create accounts or reveal credentials', async () => {
    const before = mailer.getInbox().length;
    denied(await anonymous.post(`${authPath}/email-otp/send-verification-otp`, { email: otherEmail, type: 'sign-in' }), [403], 'unlisted OTP delivery');
    denied(await anonymous.post(`${authPath}/sign-in/email-otp`, { email: otherEmail, otp: '123456' }), [403], 'unlisted sign-in');
    for (const path of ['/sign-up/email', '/sign-in/social', '/email-otp/check-verification-otp', '/email-otp/create-verification-otp', '/email-otp/get-verification-otp', '/list-sessions', '/change-email']) {
      denied(await anonymous.post(authPath + path, { email: adminEmail, type: 'sign-in' }), [404, 403], `unsupported auth endpoint ${path}`);
    }
    assert.equal(mailer.getInbox().length, before);
    assert.equal((await pool.query('SELECT id FROM "user" WHERE email=$1', [otherEmail])).rowCount, 0);
  });

  await t.test('main and admin OTP challenges are independent and admin codes can only establish one session', async () => {
    success(await main.post('/api/auth/email-otp/send-verification-otp', { email: adminEmail, type: 'sign-in' }), 'main OTP delivery');
    mainCode = mailer.getInbox().filter(item => item.email === adminEmail).at(-1).otp;
    denied(await admin.post(`${authPath}/sign-in/email-otp`, { email: adminEmail, otp: mainCode }), [400, 401], 'main code must not authenticate admin');
    success(await admin.post(`${authPath}/email-otp/send-verification-otp`, { email: adminEmail.toUpperCase(), type: 'sign-in' }), 'admin OTP delivery');
    adminCode = mailer.getInbox().filter(item => item.email === adminEmail).at(-1).otp;
    success(await main.post('/api/auth/sign-in/email-otp', { email: adminEmail, otp: mainCode }), 'admin challenge must not replace the main challenge');
    userId = success(await main.get('/api/session'), 'main verified session').user.id;
    const signedIn = await admin.post(`${authPath}/sign-in/email-otp`, { email: adminEmail, otp: adminCode });
    success(signedIn, 'admin sign-in');
    const sessionCookie = signedIn.setCookies.find(line => line.startsWith('opendater-admin.session_token='));
    assert.ok(sessionCookie, 'admin uses its own cookie name');
    assert.match(sessionCookie, /; HttpOnly/i);
    assert.match(sessionCookie, /; SameSite=Lax/i);
    assert.doesNotMatch(sessionCookie, /; Domain=/i, 'admin cookies must stay host-only');
    const session = success(await admin.get('/api/admin/session'), 'admin verified session');
    assert.equal(session.user.email, adminEmail);
    assert.equal(session.user.id, userId, 'main and admin share the account, not credentials');
    denied(await anonymous.post(`${authPath}/sign-in/email-otp`, { email: adminEmail, otp: adminCode }), [400, 401], 'consumed code cannot be replayed');
    success(await admin.get('/api/admin/overview'), 'authorized overview');
    success(await admin.get('/api/admin/users'), 'authorized users');
    success(await admin.get('/api/admin/invitations'), 'authorized invitations');
  });

  await t.test('session tokens remain audience-bound even when a caller renames cookies', async () => {
    const mainAsAdmin = clientFor(origin, adminOrigin, main.cookie().replaceAll('opendater.', 'opendater-admin.'));
    const adminAsMain = clientFor(origin, origin, admin.cookie().replaceAll('opendater-admin.', 'opendater.'));
    assert.equal(success(await mainAsAdmin.get('/api/admin/session'), 'renamed main session').user, null);
    denied(await mainAsAdmin.get('/api/admin/overview'), [401], 'main session cannot authorize admin');
    assert.equal(success(await adminAsMain.get('/api/session'), 'renamed admin session').user, null);
    const crossOrigin = await admin.post(`${authPath}/sign-out`, {}, { headers: { Origin: origin } });
    denied(crossOrigin, [403], 'main origin cannot terminate admin session');
    assert.equal(success(await admin.get('/api/admin/session'), 'admin session survives cross-origin request').user.email, adminEmail);
  });

  await t.test('every request rechecks current verified identity and allowlist, including existing sessions', async () => {
    await pool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1', [userId]);
    try {
      for (const path of protectedPaths) denied(await admin.get(path), [401, 403], `unverified user ${path}`);
      assert.equal(success(await admin.get('/api/admin/session'), 'unverified session').user, null);
    } finally { await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [userId]); }
    await pool.query('UPDATE "user" SET email=$1 WHERE id=$2', [otherEmail, userId]);
    try {
      for (const path of protectedPaths) denied(await admin.get(path), [403], `allowlist revoked ${path}`);
      denied(await admin.get('/api/admin/session'), [403], 'unlisted session');
      denied(await admin.get(`${authPath}/get-session`), [404], 'raw auth session is not exposed');
    } finally { await pool.query('UPDATE "user" SET email=$1 WHERE id=$2', [adminEmail, userId]); }
    assert.equal(success(await admin.get('/api/admin/session'), 'restored verified identity').user.email, adminEmail);
  });

  await t.test('admin logout revokes its server session without ending the main app session', async () => {
    const staleCookie = clientFor(origin, adminOrigin, admin.cookie());
    success(await admin.post(`${authPath}/sign-out`, {}), 'admin logout');
    assert.equal(success(await staleCookie.get('/api/admin/session'), 'replayed logged-out cookie').user, null);
    denied(await staleCookie.get('/api/admin/overview'), [401], 'logged-out credential');
    assert.equal(success(await main.get('/api/session'), 'main session remains valid').user.email, adminEmail);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createApplication } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';

function post(origin, path, body, chunked = false, requestOrigin = origin) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: requestOrigin, 'Content-Type': 'application/json' };
    if (chunked) headers['Transfer-Encoding'] = 'chunked';
    else headers['Content-Length'] = Buffer.byteLength(body);
    const request = httpRequest(new URL(path, origin), { method: 'POST', headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const isJSON = response.headers['content-type']?.includes('application/json');
          resolve({ status: response.statusCode, body: text && isJSON ? JSON.parse(text) : text || null });
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(10_000, () => request.destroy(new Error('Local auth boundary request timed out.')));
    if (chunked) {
      for (let offset = 0; offset < body.length; offset += 8192) request.write(body.slice(offset, offset + 8192));
      request.end();
    } else request.end(body);
  });
}

test('auth HTTP boundary caps all request bodies and exposes only direct OTP sign-in', async t => {
  // Better Auth's built-in memory adapter keeps transport tests independent of
  // PostgreSQL. The separate integration suite tests the actual persistent adapter.
  const config = loadConfig({
    DATABASE_URL: 'postgresql://unused@127.0.0.1/unused',
    AUTH_SECRET: randomBytes(32).toString('hex'), DEV_MAILBOX: '1',
    GOOGLE_CLIENT_ID: 'local-boundary-test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'local-boundary-client-secret',
  });
  let emailCalls = 0;
  const { app, auth } = createApplication({ pool: undefined, config, mailer: { sendOTP: async () => { emailCalls++; throw new Error('Transport tests must not send OTPs.'); } } });
  await auth.$context;
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(emailCalls, 0, 'Boundary tests never send OTPs');
  });
  // The origin gate must use the configured origin even though the test listener
  // uses an ephemeral transport port.
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (path, value, chunked = false) => post(origin, path, value, chunked, config.origin);

  const oversized = JSON.stringify({ email: 'boundary@example.test', otp: '000000', padding: 'x'.repeat(64 * 1024) });
  for (const chunked of [false, true]) await t.test(`${chunked ? 'chunked' : 'Content-Length'} auth body over 32KB is rejected before authentication`, async () => {
    const response = await send('/api/auth/sign-in/email-otp', oversized, chunked);
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'BODY_TOO_LARGE');
  });
  await t.test('standalone OTP check is unavailable', async () => {
    const response = await send('/api/auth/email-otp/check-verification-otp', JSON.stringify({ email: 'boundary@example.test', type: 'sign-in', otp: '000000' }));
    assert.equal(response.status, 404);
  });
  await t.test('small OTP and Google requests still reach Better Auth', async () => {
    const otp = await send('/api/auth/sign-in/email-otp', JSON.stringify({ email: 'boundary@example.test', otp: '000000' }));
    assert.equal(otp.status, 400);
    assert.equal(otp.body.code, 'INVALID_OTP');
    const google = await send('/api/auth/sign-in/social', JSON.stringify({ provider: 'google', callbackURL: config.origin, disableRedirect: true }));
    assert.equal(google.status, 200);
    const destination = new URL(google.body.url);
    assert.equal(destination.origin, 'https://accounts.google.com');
    assert.equal(destination.searchParams.get('redirect_uri'), `${config.origin}/api/auth/callback/google`);
  });
});

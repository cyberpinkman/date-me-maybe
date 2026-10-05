import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.mjs';
import { createMailer } from '../server/mail.mjs';

const base = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test', AUTH_SECRET: 'local-auth-test-secret-0123456789-abcdef' };
const production = { ...base, NODE_ENV: 'production', APP_ORIGIN: 'https://opendater.com', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret' };

test('production config fails closed for missing or unsafe deployment inputs', () => {
  const invalid = [
    { APP_ORIGIN: '' }, { APP_ORIGIN: 'http://opendater.com' }, { APP_ORIGIN: 'https://opendater.com/path' },
    { AUTH_SECRET: '' }, { AUTH_SECRET: 'short' }, { AUTH_SECRET: 'change-me-before-production-0123456789' },
    { SHARE_TOKEN_SECRET: 'short' }, { DEV_MAILBOX: '1' },
    { GOOGLE_CLIENT_SECRET: '' }, { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' },
    { DATABASE_URL: 'sqlite:local.db' }, { PORT: '30.1' },
  ];
  for (const patch of invalid) assert.throws(() => loadConfig({ ...production, ...patch }), undefined, JSON.stringify(Object.keys(patch)));
  assert.equal(loadConfig(production).origin, 'https://opendater.com');
});

test('local mailbox is explicit, restricted to loopback and Resend requires a sender', () => {
  assert.equal(loadConfig(base).devMailbox, false);
  const config = loadConfig({ ...base, DEV_MAILBOX: '1' });
  assert.equal(config.origin, 'http://127.0.0.1:3010');
  assert.equal(config.shareSecret, config.secret);
  assert.throws(() => loadConfig({ ...base, DEV_MAILBOX: '1', APP_ORIGIN: 'https://preview.example.com' }));
  assert.throws(() => loadConfig({ ...base, RESEND_API_KEY: 'test-key' }));
  assert.throws(() => loadConfig({ ...base, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'sender@example.com\r\nCc: other@example.com' }));
  assert.equal(loadConfig({ ...base, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'OpenDater <login@opendater.com>' }).emailFrom, 'OpenDater <login@opendater.com>');
});

test('development mailbox refuses real recipients, bounds storage and returns copies without network', async () => {
  const mailer = createMailer(loadConfig({ ...base, DEV_MAILBOX: '1' }), { fetchImpl: () => assert.fail('development mailbox attempted delivery') });
  await assert.rejects(mailer.sendOTP({ email: 'person@example.com', otp: '123456', type: 'sign-in' }));
  for (let i = 0; i < 101; i++) await mailer.sendOTP({ email: `person${i}@example.test`, otp: '123456', type: 'sign-in' });
  const inbox = mailer.getInbox();
  assert.equal(inbox.length, 100);
  assert.equal(inbox[0].email, 'person1@example.test');
  inbox[0].otp = '000000';
  assert.equal(mailer.getInbox()[0].otp, '123456');
});

test('Resend delivery requires an accepted response and does not expose provider error payloads', async () => {
  const config = loadConfig({ ...base, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'login@opendater.com' });
  let delivery;
  const mailer = createMailer(config, { fetchImpl: async (url, request) => {
    delivery = { url, request };
    return new Response(JSON.stringify({ id: 'accepted-message' }), { status: 200 });
  } });
  await mailer.sendOTP({ email: 'Person@example.com', otp: '123456', type: 'sign-in' });
  assert.equal(delivery.url, 'https://api.resend.com/emails');
  assert.deepEqual(JSON.parse(delivery.request.body).to, ['person@example.com']);
  assert.deepEqual(mailer.getInbox(), []);
  for (const response of [new Response('do not disclose 123456', { status: 429 }), new Response('{}', { status: 200 })]) {
    const failing = createMailer(config, { fetchImpl: async () => response });
    await assert.rejects(failing.sendOTP({ email: 'person@example.com', otp: '123456', type: 'sign-in' }), error => !error.message.includes('123456'));
  }
});

test('operations config is opt-in, email-gated and uses a separate explicit origin', () => {
  assert.equal(loadConfig(base).adminOrigin, '');
  assert.deepEqual(loadConfig(base).adminEmails, []);
  const valid = { ...production, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'login@opendater.com', ADMIN_ORIGIN: 'https://admin.opendater.com', ADMIN_EMAILS: 'Admin@example.com, admin@example.com' };
  const config = loadConfig(valid);
  assert.deepEqual(config.adminEmails, ['admin@example.com']);
  for (const patch of [{ ADMIN_ORIGIN: '' }, { ADMIN_EMAILS: '' }, { ADMIN_EMAILS: 'invalid' }, { ADMIN_ORIGIN: 'https://opendater.com' }, { ADMIN_ORIGIN: 'https://admin.opendater.com/path' }, { ADMIN_ORIGIN: 'http://admin.opendater.com' }, { ADMIN_ORIGIN: 'https://admin.opendater.com/' }, { RESEND_API_KEY: '' }]) {
    assert.throws(() => loadConfig({ ...valid, ...patch }));
  }
  assert.equal(loadConfig({ ...base, DEV_MAILBOX: '1', ADMIN_ORIGIN: 'http://localhost:3010', ADMIN_EMAILS: 'admin@example.test' }).adminOrigin, 'http://localhost:3010');
  assert.throws(() => loadConfig({ ...base, DEV_MAILBOX: '1', ADMIN_ORIGIN: 'http://admin.example.com', ADMIN_EMAILS: 'admin@example.test' }));
});

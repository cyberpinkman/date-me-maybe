import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIp, UNKNOWN_CLIENT_IP } from '../server/client-ip.mjs';

const request = (headers = {}, remoteAddress = '192.0.2.10') => ({ headers, socket: { remoteAddress } });

test('local client identity always comes from the socket despite forged forwarding headers', () => {
  const spoofed = request({
    'x-vercel-forwarded-for': '203.0.113.40',
    'x-forwarded-for': '203.0.113.41',
    'x-real-ip': '203.0.113.42',
    'x-auth-client-ip': '203.0.113.43',
    vercel: '1',
  });
  for (const env of [{}, { VERCEL: '0' }, { VERCEL: 'true' }]) {
    assert.equal(resolveClientIp(spoofed, env), '192.0.2.10');
  }
  assert.equal(resolveClientIp(request({}, '::ffff:127.0.0.1'), {}), '::ffff:127.0.0.1');
});

test('Vercel uses its single validated platform IP, independent of socket or other headers', () => {
  for (const [input, expected] of [
    ['203.0.113.18', '203.0.113.18'],
    ['2001:DB8::8', '2001:db8::8'],
    [' 203.0.113.19 ', '203.0.113.19'],
  ]) {
    const incoming = request({
      'x-vercel-forwarded-for': input,
      'x-forwarded-for': '198.51.100.20',
      'x-auth-client-ip': '198.51.100.21',
    });
    assert.equal(resolveClientIp(incoming, { VERCEL: '1' }), expected);
  }
});

test('missing or malformed Vercel platform IPs share a conservative bucket without fallback', () => {
  for (const value of [undefined, '', 'unknown', 'example.com', '999.1.1.1',
    '203.0.113.10, 203.0.113.11', '203.0.113.10:1234', '[2001:db8::1]',
    'fe80::1%eth0', ['203.0.113.10'], null]) {
    const incoming = request({
      'x-vercel-forwarded-for': value,
      'x-forwarded-for': '203.0.113.12',
      'x-auth-client-ip': '203.0.113.13',
    });
    assert.equal(resolveClientIp(incoming, { VERCEL: '1' }), UNKNOWN_CLIENT_IP);
  }
  assert.equal(UNKNOWN_CLIENT_IP, '0.0.0.0');
});

test('missing or malformed local sockets also cannot use caller-provided identity', () => {
  for (const remoteAddress of [null, '', 'unknown']) {
    assert.equal(resolveClientIp(request({ 'x-vercel-forwarded-for': '203.0.113.10' }, remoteAddress), {}), UNKNOWN_CLIENT_IP);
  }
  assert.equal(resolveClientIp({ headers: { 'x-forwarded-for': '203.0.113.10' } }, {}), UNKNOWN_CLIENT_IP);
});

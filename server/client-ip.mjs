import { isIP } from 'node:net';

// An invalid/missing address shares one conservative rate-limit bucket. Keep a
// valid IP value so the application and Better Auth receive the same decision.
export const UNKNOWN_CLIENT_IP = '0.0.0.0';

export function resolveClientIp(request, env = process.env) {
  // Only the server's deployment environment can opt into the Vercel contract.
  // No request header can enable it, and no other forwarding header is a fallback.
  const candidate = env.VERCEL === '1'
    ? request.headers?.['x-vercel-forwarded-for']
    : request.socket?.remoteAddress;
  if (typeof candidate !== 'string') return UNKNOWN_CLIENT_IP;
  const value = candidate.trim();
  // A public client address has neither a proxy chain nor a local IPv6 zone id.
  if (!isIP(value) || value.includes('%')) return UNKNOWN_CLIENT_IP;
  return value.toLowerCase();
}

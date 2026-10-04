const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function requiredSecret(value, name, isProduction) {
  if (!value || value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  if (isProduction && (/^(.)\1+$/.test(value) || /change[-_ ]?me|replace[-_ ]?me|example|your[-_ ]?secret|better-auth-secret/i.test(value))) {
    throw new Error(`${name} must be a randomly generated production secret, not an example value.`);
  }
  return value;
}

/** Validate deployment boundaries before opening a database or accepting requests. */
export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const read = name => typeof env[name] === 'string' ? env[name].trim() : '';
  const databaseUrl = read('DATABASE_URL');
  let database;
  try { database = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');

  let appURL;
  try { appURL = new URL(read('APP_ORIGIN') || (!isProduction ? 'http://127.0.0.1:3010' : '')); }
  catch { throw new Error('APP_ORIGIN must be an absolute HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(appURL.protocol) || appURL.username || appURL.password || appURL.pathname !== '/' || appURL.search || appURL.hash) {
    throw new Error('APP_ORIGIN must contain only an HTTP(S) origin, without credentials, a path, query, or fragment.');
  }
  if (isProduction && appURL.protocol !== 'https:') throw new Error('APP_ORIGIN must use HTTPS in production.');
  const origin = appURL.origin;
  const secret = requiredSecret(read('AUTH_SECRET'), 'AUTH_SECRET', isProduction);
  const shareSecret = requiredSecret(read('SHARE_TOKEN_SECRET') || secret, 'SHARE_TOKEN_SECRET', isProduction);

  const googleClientId = read('GOOGLE_CLIENT_ID');
  const googleClientSecret = read('GOOGLE_CLIENT_SECRET');
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) throw new Error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  const resendApiKey = read('RESEND_API_KEY');
  const emailFrom = read('EMAIL_FROM');
  if (resendApiKey && (!emailFrom || /[\r\n]/.test(emailFrom) || !/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(emailFrom) && !/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(emailFrom))) {
    throw new Error('EMAIL_FROM must be a verified sender email address when RESEND_API_KEY is set.');
  }
  const devMailbox = read('DEV_MAILBOX') === '1';
  if (devMailbox && (isProduction || !LOOPBACK_HOSTS.has(appURL.hostname))) {
    throw new Error('DEV_MAILBOX is available only in non-production on a loopback APP_ORIGIN.');
  }
  if (isProduction && !googleClientId && !resendApiKey) throw new Error('Production requires Google OAuth or Resend email sign-in.');

  const portString = read('PORT') || '3010';
  const port = Number(portString);
  if (!/^\d+$/.test(portString) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  return Object.freeze({ databaseUrl, origin, secret, shareSecret, googleClientId, googleClientSecret, resendApiKey, emailFrom, devMailbox, port, isProduction });
}

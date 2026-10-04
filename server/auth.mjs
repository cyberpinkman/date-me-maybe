import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';

export function createAuth({ pool, config, mailer }) {
  const emailEnabled = Boolean(config.resendApiKey || config.devMailbox);
  const secureCookies = config.isProduction || new URL(config.origin).protocol === 'https:';
  return betterAuth({
    appName: '见一面 · Date Me Maybe',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    database: pool,
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: false },
    socialProviders: config.googleClientId ? {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        // The provider defaults are only openid, email, profile. No Gmail access.
        accessType: 'online',
        includeGrantedScopes: false,
        prompt: 'select_account',
      },
    } : {},
    plugins: emailEnabled ? [emailOTP({
      sendVerificationOTP: data => mailer.sendOTP(data),
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 5,
      storeOTP: 'hashed',
      resendStrategy: 'rotate',
      sendVerificationOnSignUp: false,
      rateLimit: { window: 60, max: 3 },
    })] : [],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      accountLinking: { enabled: false, disableImplicitLinking: true, allowDifferentEmails: false },
    },
    advanced: {
      cookiePrefix: 'opendater',
      useSecureCookies: secureCookies,
      defaultCookieAttributes: { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/' },
      // The HTTP adapter must overwrite this header from its trusted client IP.
      ipAddress: { ipAddressHeaders: ['x-auth-client-ip'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 60, max: 10 },
        '/sign-in/social': { window: 60, max: 10 },
      },
    },
    // This application supports passwordless sign-in only.
    disabledPaths: [
      // Direct sign-in consumes a code atomically; no standalone OTP oracle.
      '/email-otp/check-verification-otp',
      '/sign-up/email', '/sign-in/email', '/request-password-reset', '/reset-password',
      '/email-otp/request-password-reset', '/forget-password/email-otp', '/email-otp/reset-password',
      '/change-password', '/set-password', '/change-email', '/link-social', '/unlink-account',
    ],
  });
}

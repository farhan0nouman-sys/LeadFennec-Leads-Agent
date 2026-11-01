import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  createPrismaClient,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import { FakeTransactionalMailProvider } from '@lead-fennec-ai/integrations';
import {
  acceptedResponseSchema,
  authErrorResponseSchema,
  AUTH_ROUTES,
  CSRF_HEADER_NAME,
  emailVerifiedResponseSchema,
  passwordResetResponseSchema,
  SESSION_COOKIE_NAME,
  sessionResponseSchema,
  type AuthErrorCode,
} from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { parseSetCookie } from 'cookie';
import { Logger } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { PRISMA_CLIENT } from '../database/database.module.js';
import { apiEnvSchema } from '../env.js';
import { TRANSACTIONAL_MAIL } from '../mail/mail.module.js';
import { sha256Hex } from './auth-crypto.js';
import { AuthTasks } from './auth-tasks.js';
import {
  AUTH_CLOCK,
  AUTH_POLICY,
  DEFAULT_AUTH_POLICY,
  type AuthPolicy,
} from './auth.policy.js';

// Every auth flow end to end: the real Nest app on a loopback port, real PostgreSQL (its own
// migrated schema), the fake mail provider and a controllable clock. Runs only when
// TEST_DATABASE_URL is set; otherwise it is reported as skipped, never as passed.
const WEB = 'https://app.lead-fennec.test';
const env = apiEnvSchema.parse({
  APP_ENV: 'test',
  // Never dialled: the test injects its own Prisma Client.
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused_test',
  REDIS_URL: 'redis://127.0.0.1:1/15',
  WEB_APP_URL: WEB,
});

const PASSWORD = 'correct horse battery staple';
const OTHER_PASSWORD = 'tr0ub4dor & three more words';

type LogLine = Record<string, unknown>;
const lines: LogLine[] = [];
const logger = createLogger({
  app: 'api',
  level: 'debug',
  destination: new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as LogLine);
      }
      callback();
    },
  }),
});

/** Every secret value seen in the tests; none may ever appear in a log line. */
const secrets = new Set<string>([PASSWORD, OTHER_PASSWORD]);

interface Harness {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly mail: FakeTransactionalMailProvider;
  readonly tasks: AuthTasks;
  readonly prisma: PrismaClient;
}

const db = new MigratedSchema('tauth');
let now = new Date('2026-11-02T09:00:00.000Z');
const advance = (seconds: number) => {
  now = new Date(now.getTime() + seconds * 1000);
};

async function startApi(policy: Partial<AuthPolicy> = {}): Promise<Harness> {
  const prisma = createPrismaClient({
    databaseUrl: db.databaseUrl,
    schema: db.name,
    maxConnections: 1,
  });
  const mail = new FakeTransactionalMailProvider();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env, logger)],
  })
    .overrideProvider(PRISMA_CLIENT)
    .useValue(prisma)
    .overrideProvider(TRANSACTIONAL_MAIL)
    .useValue(mail)
    .overrideProvider(AUTH_CLOCK)
    .useValue(() => new Date(now.getTime()))
    .overrideProvider(AUTH_POLICY)
    .useValue({
      ...DEFAULT_AUTH_POLICY,
      ipRequestsPerMinute: 10_000,
      ...policy,
    })
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app, baseUrl, mail, tasks: app.get(AuthTasks), prisma };
}

interface CallOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly cookie?: string | undefined;
  readonly csrf?: string;
  /** Browser-like headers of the web app; false for a non-browser client. */
  readonly browser?: false | { origin?: string; site?: string };
}

async function call(api: Harness, path: string, options: CallOptions = {}) {
  const method = options.method ?? 'POST';
  const headers: Record<string, string> = {};
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.cookie !== undefined) {
    headers['cookie'] = `${SESSION_COOKIE_NAME}=${options.cookie}`;
  }
  if (options.csrf !== undefined) {
    headers[CSRF_HEADER_NAME] = options.csrf;
  }
  const browser = options.browser ?? {};
  if (browser !== false && method !== 'GET') {
    headers['origin'] = browser.origin ?? WEB;
    headers['sec-fetch-site'] = browser.site ?? 'same-origin';
  }
  const response = await fetch(`${api.baseUrl}${path}`, {
    method,
    headers,
    ...(options.rawBody !== undefined
      ? { body: options.rawBody }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: text === '' ? undefined : (JSON.parse(text) as unknown),
    headers: response.headers,
    setCookies: response.headers.getSetCookie(),
  };
}

type CallResult = Awaited<ReturnType<typeof call>>;

function expectError(result: CallResult, status: number, code: AuthErrorCode) {
  expect(result.status, result.text).toBe(status);
  const body = authErrorResponseSchema.parse(result.json);
  expect(body.error.code).toBe(code);
  expect(result.headers.get('cache-control')).toBe('no-store');
  return body;
}

/** The session token from a Set-Cookie header, or undefined. */
function sessionTokenFrom(result: CallResult): string | undefined {
  for (const header of result.setCookies) {
    const cookie = parseSetCookie(header);
    const value = cookie.value;
    if (
      cookie.name === SESSION_COOKIE_NAME &&
      value !== undefined &&
      value !== ''
    ) {
      secrets.add(value);
      return value;
    }
  }
  return undefined;
}

function clearsSession(result: CallResult): boolean {
  return result.setCookies.some((header) => {
    const cookie = parseSetCookie(header);
    return cookie.name === SESSION_COOKIE_NAME && cookie.maxAge === 0;
  });
}

/** The newest message to `to` with `template`, and the token in its link (if any). */
function lastMail(api: Harness, to: string, template: string) {
  const message = api.mail.sent
    .filter((m) => m.to === to && m.template === template)
    .at(-1);
  if (message === undefined) {
    throw new Error(`no ${template} mail to ${to}`);
  }
  const token = /#token=([A-Za-z0-9_-]{43})\b/.exec(message.textBody)?.[1];
  if (token !== undefined) {
    secrets.add(token);
  }
  return { message, token };
}

const freshEmail = (label: string) =>
  `${label}.${randomUUID().slice(0, 8)}@Example.TEST`;
const normalized = (email: string) => email.toLowerCase();

describe.runIf(testDatabaseUrl !== undefined)(
  'auth flows on PostgreSQL',
  () => {
    let api: Harness;

    beforeAll(async () => {
      await db.create();
      api = await startApi();
    }, 60_000);

    afterAll(async () => {
      await api.app.close();
      await db.drop();
      // No secret reached a log line, in any test of this file.
      const output = JSON.stringify(lines);
      for (const secret of secrets) {
        expect(output.includes(secret), 'a secret was logged').toBe(false);
      }
    }, 60_000);

    /** Registers and verifies an account; returns its address. */
    async function verifiedAccount(label: string, password = PASSWORD) {
      const email = freshEmail(label);
      expect(
        (await call(api, AUTH_ROUTES.register, { body: { email, password } }))
          .status,
      ).toBe(202);
      await api.tasks.drain();
      const { token } = lastMail(api, email, 'auth.verify_email');
      expect(
        (await call(api, AUTH_ROUTES.verifyEmail, { body: { token } })).status,
      ).toBe(200);
      return email;
    }

    async function signIn(email: string, password = PASSWORD, cookie?: string) {
      const result = await call(api, AUTH_ROUTES.login, {
        body: { email, password },
        cookie,
      });
      expect(result.status, result.text).toBe(200);
      const body = sessionResponseSchema.parse(result.json);
      secrets.add(body.csrfToken);
      const token = sessionTokenFrom(result);
      if (token === undefined) {
        throw new Error('no session cookie');
      }
      return { token, body, result };
    }

    describe('registration and email verification', () => {
      it('answers 202 and emails a one-time link; stores only hashes', async () => {
        const email = freshEmail('new');
        const result = await call(api, AUTH_ROUTES.register, {
          body: { email, password: PASSWORD, displayName: 'New User' },
        });
        expect(result.status).toBe(202);
        expect(acceptedResponseSchema.parse(result.json)).toEqual({
          status: 'accepted',
        });
        expect(result.headers.get('cache-control')).toBe('no-store');
        await api.tasks.drain();
        const { message, token } = lastMail(api, email, 'auth.verify_email');
        expect(message.textBody).toContain(
          `${WEB}/verify-email#token=${token ?? ''}`,
        );
        const user = await api.prisma.user.findUniqueOrThrow({
          where: { normalizedEmail: normalized(email) },
          include: { credential: true, authTokens: true },
        });
        expect(user).toMatchObject({
          email,
          displayName: 'New User',
          emailVerifiedAt: null,
        });
        expect(user.credential?.passwordHash).toMatch(
          /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
        );
        expect(user.authTokens).toHaveLength(1);
        expect(user.authTokens[0]?.tokenHash).toBe(sha256Hex(token ?? ''));
        // Neither the password nor the token is stored anywhere in these rows.
        const stored = JSON.stringify(user);
        expect(stored).not.toContain(PASSWORD);
        expect(stored).not.toContain(token);
      });

      it('cannot sign in before verifying, and verifies once', async () => {
        const email = freshEmail('verify');
        await call(api, AUTH_ROUTES.register, {
          body: { email, password: PASSWORD },
        });
        await api.tasks.drain();
        const { token } = lastMail(api, email, 'auth.verify_email');
        expectError(
          await call(api, AUTH_ROUTES.login, {
            body: { email, password: PASSWORD },
          }),
          403,
          'email_not_verified',
        );
        expectError(
          await call(api, AUTH_ROUTES.verifyEmail, {
            body: { token: 'A'.repeat(43) },
          }),
          400,
          'invalid_or_expired_token',
        );
        const verified = await call(api, AUTH_ROUTES.verifyEmail, {
          body: { token },
        });
        expect(emailVerifiedResponseSchema.parse(verified.json)).toEqual({
          status: 'verified',
        });
        expectError(
          await call(api, AUTH_ROUTES.verifyEmail, { body: { token } }),
          400,
          'invalid_or_expired_token',
        );
        await signIn(email);
      });

      it('rejects an expired verification link and sends a new one on request', async () => {
        const email = freshEmail('expired');
        await call(api, AUTH_ROUTES.register, {
          body: { email, password: PASSWORD },
        });
        await api.tasks.drain();
        const { token } = lastMail(api, email, 'auth.verify_email');
        advance(24 * 60 * 60 + 1);
        expectError(
          await call(api, AUTH_ROUTES.verifyEmail, { body: { token } }),
          400,
          'invalid_or_expired_token',
        );
        expect(
          (await call(api, AUTH_ROUTES.resendVerification, { body: { email } }))
            .status,
        ).toBe(202);
        await api.tasks.drain();
        const fresh = lastMail(api, email, 'auth.verify_email');
        expect(fresh.token).not.toBe(token);
        expect(
          (
            await call(api, AUTH_ROUTES.verifyEmail, {
              body: { token: fresh.token },
            })
          ).status,
        ).toBe(200);
      });

      it('gives the same answer for a new, an unverified and a verified address', async () => {
        const verified = await verifiedAccount('taken');
        const unverified = freshEmail('pending');
        await call(api, AUTH_ROUTES.register, {
          body: { email: unverified, password: PASSWORD },
        });
        await api.tasks.drain();
        const answers = [];
        for (const email of [freshEmail('brand-new'), unverified, verified]) {
          const result = await call(api, AUTH_ROUTES.register, {
            body: { email, password: OTHER_PASSWORD },
          });
          answers.push({ status: result.status, body: result.text });
        }
        expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
        await api.tasks.drain();
        // The verified owner is told; no link, no second account.
        const notice = lastMail(api, verified, 'auth.already_registered');
        expect(notice.token).toBeUndefined();
        expect(
          await api.prisma.user.count({
            where: { normalizedEmail: normalized(verified) },
          }),
        ).toBe(1);
      });

      it('lets the inbox owner, not the first registrant, choose the password (pre-hijacking)', async () => {
        const email = freshEmail('victim');
        // Someone else registers the address first, with their password.
        await call(api, AUTH_ROUTES.register, {
          body: { email, password: OTHER_PASSWORD },
        });
        await api.tasks.drain();
        const attackersLink = lastMail(api, email, 'auth.verify_email').token;
        // The owner registers too: the first link stops working, a "finish setup" link arrives.
        await call(api, AUTH_ROUTES.register, {
          body: { email, password: PASSWORD },
        });
        await api.tasks.drain();
        expectError(
          await call(api, AUTH_ROUTES.verifyEmail, {
            body: { token: attackersLink },
          }),
          400,
          'invalid_or_expired_token',
        );
        const { token } = lastMail(api, email, 'auth.finish_setup');
        const reset = await call(api, AUTH_ROUTES.passwordResetConfirm, {
          body: { token, newPassword: PASSWORD },
        });
        expect(passwordResetResponseSchema.parse(reset.json)).toEqual({
          status: 'password_reset',
        });
        await signIn(email);
        expectError(
          await call(api, AUTH_ROUTES.login, {
            body: { email, password: OTHER_PASSWORD },
          }),
          401,
          'invalid_credentials',
        );
      });

      it('validates input without echoing it', async () => {
        const weak = expectError(
          await call(api, AUTH_ROUTES.register, {
            body: { email: freshEmail('weak'), password: 'Short1!' },
          }),
          400,
          'validation_failed',
        );
        expect(weak.error.issues?.map((i) => i.path)).toEqual(['password']);
        expect(JSON.stringify(weak)).not.toContain('Short1!');
        const extra = expectError(
          await call(api, AUTH_ROUTES.login, {
            body: {
              email: 'a@example.test',
              password: 'x',
              isPlatformAdmin: true,
            },
          }),
          400,
          'validation_failed',
        );
        expect(extra.error.issues).toHaveLength(1);
        expectError(
          await call(api, AUTH_ROUTES.register, {
            body: { email: 'not..valid@example.test', password: PASSWORD },
          }),
          400,
          'validation_failed',
        );
        expectError(
          await call(api, AUTH_ROUTES.login, { rawBody: '{"email":' }),
          400,
          'validation_failed',
        );
      });
    });

    describe('sign-in and sessions', () => {
      it('answers wrong password, unknown address and disabled user identically', async () => {
        const email = await verifiedAccount('creds');
        const disabled = await verifiedAccount('disabled');
        await api.prisma.user.update({
          where: { normalizedEmail: normalized(disabled) },
          data: { status: 'DISABLED' },
        });
        const bodies = [];
        for (const attempt of [
          { email, password: OTHER_PASSWORD },
          { email: freshEmail('nobody'), password: PASSWORD },
          { email: disabled, password: PASSWORD },
        ]) {
          const result = await call(api, AUTH_ROUTES.login, { body: attempt });
          expectError(result, 401, 'invalid_credentials');
          expect(sessionTokenFrom(result)).toBeUndefined();
          bodies.push(result.text);
        }
        expect(new Set(bodies).size).toBe(1);
      });

      it('sets a hardened session cookie and stores only its hash', async () => {
        const email = await verifiedAccount('cookie');
        const { token, body, result } = await signIn(email);
        const cookie = parseSetCookie(
          result.setCookies.find((h) => h.startsWith(SESSION_COOKIE_NAME)) ??
            '',
        );
        expect(cookie).toMatchObject({
          name: '__Host-lf_session',
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
        });
        expect(
          cookie.domain ?? cookie.maxAge ?? cookie.expires,
        ).toBeUndefined();
        expect(result.text).not.toContain(token);
        expect(body.user).toMatchObject({ email, emailVerified: true });
        expect(body.session).toEqual({
          idleExpiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
          absoluteExpiresAt: new Date(
            now.getTime() + 8 * 3_600_000,
          ).toISOString(),
        });
        const sessions = await api.prisma.userSession.findMany({
          where: { user: { normalizedEmail: normalized(email) } },
        });
        expect(sessions.map((s) => s.tokenHash)).toEqual([sha256Hex(token)]);
        const current = await call(api, AUTH_ROUTES.session, {
          method: 'GET',
          cookie: token,
        });
        expect(sessionResponseSchema.parse(current.json)).toEqual(body);
      });

      it('refuses requests without a valid session', async () => {
        const none = expectError(
          await call(api, AUTH_ROUTES.session, { method: 'GET' }),
          401,
          'unauthenticated',
        );
        expect(none.error.message).toBe('Sign in to continue.');
        const forged = await call(api, AUTH_ROUTES.session, {
          method: 'GET',
          cookie: 'A'.repeat(43),
        });
        expectError(forged, 401, 'unauthenticated');
        expect(clearsSession(forged)).toBe(true);
      });

      it('ends a session after 30 idle minutes, and activity extends it up to 8 hours', async () => {
        const email = await verifiedAccount('idle');
        const first = await signIn(email);
        advance(31 * 60);
        const idle = await call(api, AUTH_ROUTES.session, {
          method: 'GET',
          cookie: first.token,
        });
        expectError(idle, 401, 'session_expired');
        expect(clearsSession(idle)).toBe(true);
        const ended = await api.prisma.userSession.findUniqueOrThrow({
          where: { tokenHash: sha256Hex(first.token) },
        });
        expect(ended.endReason).toBe('EXPIRED');
        // Active every 20 minutes: alive until the absolute end, then expired.
        const { token } = await signIn(email);
        for (let minute = 20; minute < 8 * 60; minute += 20) {
          advance(20 * 60);
          expect(
            (
              await call(api, AUTH_ROUTES.session, {
                method: 'GET',
                cookie: token,
              })
            ).status,
          ).toBe(200);
        }
        advance(20 * 60);
        expectError(
          await call(api, AUTH_ROUTES.session, {
            method: 'GET',
            cookie: token,
          }),
          401,
          'session_expired',
        );
      });

      it('issues a new session id at every sign-in and ends the previous one', async () => {
        const email = await verifiedAccount('rotate');
        const first = await signIn(email);
        const second = await signIn(email, PASSWORD, first.token);
        expect(second.token).not.toBe(first.token);
        expect(second.body.csrfToken).not.toBe(first.body.csrfToken);
        expectError(
          await call(api, AUTH_ROUTES.session, {
            method: 'GET',
            cookie: first.token,
          }),
          401,
          'unauthenticated',
        );
        const old = await api.prisma.userSession.findUniqueOrThrow({
          where: { tokenHash: sha256Hex(first.token) },
        });
        expect(old.endReason).toBe('REPLACED');
      });

      it('ends the session of a user who was disabled', async () => {
        const email = await verifiedAccount('later-disabled');
        const { token } = await signIn(email);
        await api.prisma.user.update({
          where: { normalizedEmail: normalized(email) },
          data: { status: 'DISABLED' },
        });
        expectError(
          await call(api, AUTH_ROUTES.session, {
            method: 'GET',
            cookie: token,
          }),
          401,
          'unauthenticated',
        );
        const session = await api.prisma.userSession.findUniqueOrThrow({
          where: { tokenHash: sha256Hex(token) },
        });
        expect(session.endReason).toBe('USER_DISABLED');
      });
    });

    describe('CSRF and logout', () => {
      it('logs out only with the session CSRF token', async () => {
        const email = await verifiedAccount('logout');
        const mine = await signIn(email);
        const other = await signIn(await verifiedAccount('other-session'));
        expectError(
          await call(api, AUTH_ROUTES.logout, { cookie: mine.token }),
          403,
          'csrf_failed',
        );
        expectError(
          await call(api, AUTH_ROUTES.logout, {
            cookie: mine.token,
            csrf: other.body.csrfToken,
          }),
          403,
          'csrf_failed',
        );
        // Still signed in after the refused attempts.
        expect(
          (
            await call(api, AUTH_ROUTES.session, {
              method: 'GET',
              cookie: mine.token,
            })
          ).status,
        ).toBe(200);
        const out = await call(api, AUTH_ROUTES.logout, {
          cookie: mine.token,
          csrf: mine.body.csrfToken,
        });
        expect(out.status).toBe(204);
        expect(clearsSession(out)).toBe(true);
        expectError(
          await call(api, AUTH_ROUTES.session, {
            method: 'GET',
            cookie: mine.token,
          }),
          401,
          'unauthenticated',
        );
        const ended = await api.prisma.userSession.findUniqueOrThrow({
          where: { tokenHash: sha256Hex(mine.token) },
        });
        expect(ended.endReason).toBe('LOGOUT');
      });

      it.each([
        ['another origin', { origin: 'https://evil.test' }],
        ['a cross-site fetch', { site: 'cross-site' }],
        ['a same-site but cross-origin fetch', { site: 'same-site' }],
        ['an opaque origin', { origin: 'null' }],
      ])(
        'refuses mutations from %s, including sign-in',
        async (_name, browser) => {
          const email = await verifiedAccount('origin');
          expectError(
            await call(api, AUTH_ROUTES.login, {
              body: { email, password: PASSWORD },
              browser,
            }),
            403,
            'forbidden_origin',
          );
          expectError(
            await call(api, AUTH_ROUTES.register, {
              body: { email: freshEmail('csrf'), password: PASSWORD },
              browser,
            }),
            403,
            'forbidden_origin',
          );
        },
      );

      it('accepts non-browser clients (no Origin, no Fetch Metadata)', async () => {
        const email = await verifiedAccount('cli');
        const result = await call(api, AUTH_ROUTES.login, {
          body: { email, password: PASSWORD },
          browser: false,
        });
        expect(result.status).toBe(200);
        sessionTokenFrom(result);
      });
    });

    describe('password reset', () => {
      it('answers unknown and known addresses alike, and emails only the owner', async () => {
        const email = await verifiedAccount('reset');
        const unknown = freshEmail('unknown');
        const sentBefore = api.mail.sent.length;
        const answers = [];
        for (const address of [unknown, email]) {
          const result = await call(api, AUTH_ROUTES.passwordResetRequest, {
            body: { email: address },
          });
          answers.push(`${String(result.status)} ${result.text}`);
        }
        expect(answers[0]).toBe(answers[1]);
        await api.tasks.drain();
        expect(
          api.mail.sent.slice(sentBefore).map((m) => [m.to, m.template]),
        ).toEqual([[email, 'auth.password_reset']]);
        const { message, token } = lastMail(api, email, 'auth.password_reset');
        expect(message.textBody).toContain(
          `${WEB}/reset-password#token=${token ?? ''}`,
        );
      });

      it('sets the new password once, ends every session and notifies the owner', async () => {
        const email = await verifiedAccount('reset-flow');
        const session = await signIn(email);
        await call(api, AUTH_ROUTES.passwordResetRequest, { body: { email } });
        await api.tasks.drain();
        const { token } = lastMail(api, email, 'auth.password_reset');
        // A weak password is refused without using up the link.
        expectError(
          await call(api, AUTH_ROUTES.passwordResetConfirm, {
            body: { token, newPassword: 'too short' },
          }),
          400,
          'validation_failed',
        );
        const done = await call(api, AUTH_ROUTES.passwordResetConfirm, {
          body: { token, newPassword: OTHER_PASSWORD },
        });
        expect(done.status).toBe(200);
        expectError(
          await call(api, AUTH_ROUTES.passwordResetConfirm, {
            body: { token, newPassword: OTHER_PASSWORD },
          }),
          400,
          'invalid_or_expired_token',
        );
        expectError(
          await call(api, AUTH_ROUTES.session, {
            method: 'GET',
            cookie: session.token,
          }),
          401,
          'unauthenticated',
        );
        expectError(
          await call(api, AUTH_ROUTES.login, {
            body: { email, password: PASSWORD },
          }),
          401,
          'invalid_credentials',
        );
        await signIn(email, OTHER_PASSWORD);
        await api.tasks.drain();
        expect(
          lastMail(api, email, 'auth.password_changed').token,
        ).toBeUndefined();
      });

      it('rejects a reset link after 30 minutes', async () => {
        const email = await verifiedAccount('reset-expiry');
        await call(api, AUTH_ROUTES.passwordResetRequest, { body: { email } });
        await api.tasks.drain();
        const { token } = lastMail(api, email, 'auth.password_reset');
        advance(30 * 60 + 1);
        expectError(
          await call(api, AUTH_ROUTES.passwordResetConfirm, {
            body: { token, newPassword: OTHER_PASSWORD },
          }),
          400,
          'invalid_or_expired_token',
        );
      });

      it('sends at most 3 reset emails per address and hour', async () => {
        const email = await verifiedAccount('reset-flood');
        const before = api.mail.sent.length;
        for (let i = 0; i < 5; i += 1) {
          expect(
            (
              await call(api, AUTH_ROUTES.passwordResetRequest, {
                body: { email },
              })
            ).status,
          ).toBe(202);
          await api.tasks.drain();
        }
        expect(
          api.mail.sent.slice(before).filter((m) => m.to === email),
        ).toHaveLength(3);
        advance(60 * 60 + 1);
        await call(api, AUTH_ROUTES.passwordResetRequest, { body: { email } });
        await api.tasks.drain();
        expect(
          api.mail.sent.slice(before).filter((m) => m.to === email),
        ).toHaveLength(4);
      });
    });

    describe('repeated attempts', () => {
      it('locks sign-in for an address after 5 failures, for 15 minutes', async () => {
        for (const email of [
          await verifiedAccount('locked'),
          freshEmail('ghost'),
        ]) {
          for (let i = 0; i < 5; i += 1) {
            expectError(
              await call(api, AUTH_ROUTES.login, {
                body: { email, password: OTHER_PASSWORD },
              }),
              401,
              'invalid_credentials',
            );
          }
          // Locked: even the right password is refused, existing account or not.
          const locked = await call(api, AUTH_ROUTES.login, {
            body: { email, password: PASSWORD },
          });
          const body = expectError(locked, 429, 'too_many_requests');
          expect(body.error.retryAfterSeconds).toBe(15 * 60);
          expect(locked.headers.get('retry-after')).toBe(String(15 * 60));
        }
        advance(15 * 60);
        const email = await verifiedAccount('unlocked');
        await signIn(email);
      });

      it('lifts the lock after the 15 minutes', async () => {
        const email = await verifiedAccount('relock');
        for (let i = 0; i < 5; i += 1) {
          await call(api, AUTH_ROUTES.login, {
            body: { email, password: OTHER_PASSWORD },
          });
        }
        expectError(
          await call(api, AUTH_ROUTES.login, {
            body: { email, password: PASSWORD },
          }),
          429,
          'too_many_requests',
        );
        advance(15 * 60);
        await signIn(email);
        // A success resets the count.
        const row = await api.prisma.authThrottle.findMany({
          where: { scope: 'LOGIN' },
        });
        expect(
          row.every(
            (r) => r.keyHash !== sha256Hex(`email:${normalized(email)}`),
          ),
        ).toBe(true);
      });

      it('limits requests per client IP', async () => {
        const limited = await startApi({ ipRequestsPerMinute: 3 });
        try {
          const results = [];
          for (let i = 0; i < 4; i += 1) {
            results.push(
              await call(limited, AUTH_ROUTES.passwordResetRequest, {
                body: { email: freshEmail('ip') },
              }),
            );
          }
          expect(results.map((r) => r.status)).toEqual([202, 202, 202, 429]);
          const refused = results[3];
          if (refused === undefined) {
            throw new Error('missing result');
          }
          expectError(refused, 429, 'too_many_requests');
          expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
          // Reading the session is not throttled per IP.
          expect(
            (await call(limited, AUTH_ROUTES.session, { method: 'GET' }))
              .status,
          ).toBe(401);
        } finally {
          await limited.tasks.drain();
          await limited.app.close();
        }
      });
    });

    describe('security audit events (task 04C)', () => {
      /** The platform audit records about one account, by action. */
      async function eventsOf(email: string) {
        const user = await api.prisma.user.findUniqueOrThrow({
          where: { normalizedEmail: normalized(email) },
        });
        const records = await api.prisma.platformAuditRecord.findMany({
          where: { OR: [{ actorUserId: user.id }, { targetId: user.id }] },
          orderBy: { id: 'asc' },
        });
        const of = (action: string) =>
          records.filter((record) => record.action === action);
        return { user, records, of };
      }

      it('records sign-up, verification, sign-in, sign-out and reset, without secrets', async () => {
        const email = await verifiedAccount('audit-trail');
        expectError(
          await call(api, AUTH_ROUTES.login, {
            body: { email, password: OTHER_PASSWORD },
          }),
          401,
          'invalid_credentials',
        );
        const session = await signIn(email);
        expect(
          (
            await call(api, AUTH_ROUTES.logout, {
              cookie: session.token,
              csrf: session.body.csrfToken,
            })
          ).status,
        ).toBe(204);
        await call(api, AUTH_ROUTES.passwordResetRequest, { body: { email } });
        await api.tasks.drain();
        const { token } = lastMail(api, email, 'auth.password_reset');
        expect(
          (
            await call(api, AUTH_ROUTES.passwordResetConfirm, {
              body: { token, newPassword: OTHER_PASSWORD },
            })
          ).status,
        ).toBe(200);

        const { user, records, of } = await eventsOf(email);
        const sessionRow = await api.prisma.userSession.findFirstOrThrow({
          where: { userId: user.id, endReason: 'LOGOUT' },
        });
        // The user acted: registration, verification, sign-in, sign-out, the new password.
        for (const action of [
          'user.registered',
          'user.email_verified',
          'user.signed_in',
          'user.signed_out',
          'user.password_reset',
        ]) {
          const [record, ...more] = of(action);
          expect(more, action).toHaveLength(0);
          expect(record, action).toMatchObject({
            actorType: 'USER',
            actorUserId: user.id,
            actorName: null,
            subjectTenantId: null,
          });
        }
        expect(of('user.signed_in')[0]).toMatchObject({
          targetType: 'user_session',
          targetId: sessionRow.id,
        });
        expect(of('user.signed_out')[0]).toMatchObject({
          targetType: 'user_session',
          targetId: sessionRow.id,
        });
        // Nobody proven acted: a failed sign-in and a reset request are the system's records.
        expect(of('user.sign_in_failed')).toEqual([
          expect.objectContaining({
            actorType: 'SYSTEM',
            actorUserId: null,
            actorName: 'auth',
            targetType: 'user',
            targetId: user.id,
            metadata: { reason: 'wrong_password' },
          }),
        ]);
        expect(of('user.password_reset_requested')).toEqual([
          expect.objectContaining({ actorType: 'SYSTEM', targetId: user.id }),
        ]);
        // Every record carries the request id, and no token, password or address.
        for (const record of records) {
          expect(record.requestId, record.action).toMatch(
            /^[A-Za-z0-9._:-]{1,128}$/,
          );
        }
        const stored = JSON.stringify(records).toLowerCase();
        expect(stored.includes(normalized(email))).toBe(false);
        for (const secret of secrets) {
          expect(
            stored.includes(secret.toLowerCase()),
            'a secret was stored',
          ).toBe(false);
        }
      });

      it('records refusals for existing accounts only, and the start of a lock once', async () => {
        const before = await api.prisma.platformAuditRecord.count();
        expectError(
          await call(api, AUTH_ROUTES.login, {
            body: { email: freshEmail('nobody'), password: OTHER_PASSWORD },
          }),
          401,
          'invalid_credentials',
        );
        expect(await api.prisma.platformAuditRecord.count()).toBe(before);

        const email = await verifiedAccount('audit-lock');
        for (let i = 0; i < 6; i += 1) {
          await call(api, AUTH_ROUTES.login, {
            body: { email, password: OTHER_PASSWORD },
          });
        }
        const { of } = await eventsOf(email);
        // Five counted failures; the sixth was refused by the lock before any check.
        expect(of('user.sign_in_failed')).toHaveLength(5);
        expect(of('user.sign_in_locked')).toEqual([
          expect.objectContaining({
            actorType: 'SYSTEM',
            metadata: { lockedSeconds: 15 * 60 },
          }),
        ]);
        advance(15 * 60);

        const unverified = freshEmail('audit-unverified');
        await call(api, AUTH_ROUTES.register, {
          body: { email: unverified, password: PASSWORD },
        });
        await api.tasks.drain();
        expectError(
          await call(api, AUTH_ROUTES.login, {
            body: { email: unverified, password: PASSWORD },
          }),
          403,
          'email_not_verified',
        );
        // Registering the address again is recorded for its owner, without the address.
        await call(api, AUTH_ROUTES.register, {
          body: { email: unverified, password: OTHER_PASSWORD },
        });
        await api.tasks.drain();
        const events = await eventsOf(unverified);
        expect(events.of('user.sign_in_failed')).toEqual([
          expect.objectContaining({
            metadata: { reason: 'email_not_verified' },
          }),
        ]);
        expect(events.of('user.registration_repeated')).toEqual([
          expect.objectContaining({
            actorType: 'SYSTEM',
            metadata: { verified: false },
          }),
        ]);
      });
    });
  },
);

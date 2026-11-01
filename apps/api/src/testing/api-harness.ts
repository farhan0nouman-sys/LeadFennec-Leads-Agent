// Test-only (excluded from the build): boots the real Nest app on a loopback port against a
// migrated test schema, with the fake mail provider and a controllable clock, and offers
// browser-like HTTP helpers. Used by the API's database-backed integration suites.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  createPrismaClient,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import type { MigratedSchema } from '@lead-fennec-ai/database/testing';
import { FakeTransactionalMailProvider } from '@lead-fennec-ai/integrations';
import {
  apiErrorResponseSchema,
  AUTH_ROUTES,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  sessionResponseSchema,
  type ApiErrorCode,
} from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { parseSetCookie } from 'cookie';
import { Logger } from 'nestjs-pino';
import { expect } from 'vitest';
import { AppModule } from '../app.module.js';
import { AuthTasks } from '../auth/auth-tasks.js';
import {
  AUTH_CLOCK,
  AUTH_POLICY,
  DEFAULT_AUTH_POLICY,
  type AuthPolicy,
} from '../auth/auth.policy.js';
import { PRISMA_CLIENT } from '../database/database.module.js';
import { apiEnvSchema } from '../env.js';
import { TRANSACTIONAL_MAIL } from '../mail/mail.module.js';

export const WEB = 'https://app.lead-fennec.test';
export const PASSWORD = 'correct horse battery staple';

type LogLine = Record<string, unknown>;

/** Log lines of the app, and every secret the tests saw (none may appear in a log line). */
export const captured = {
  lines: [] as LogLine[],
  secrets: new Set<string>([PASSWORD]),
};

const logger = createLogger({
  app: 'api',
  level: 'debug',
  destination: new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        captured.lines.push(JSON.parse(line) as LogLine);
      }
      callback();
    },
  }),
});

/** Fails if any secret seen by the tests appears in a captured log line. */
export function expectNoSecretsLogged(): void {
  const output = JSON.stringify(captured.lines);
  for (const secret of captured.secrets) {
    expect(output.includes(secret), 'a secret was logged').toBe(false);
  }
}

export const clock = { now: new Date('2026-11-02T09:00:00.000Z') };
export const advance = (seconds: number) => {
  clock.now = new Date(clock.now.getTime() + seconds * 1000);
};

export interface Harness {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly mail: FakeTransactionalMailProvider;
  readonly tasks: AuthTasks;
  readonly prisma: PrismaClient;
}

export async function startApi(
  db: MigratedSchema,
  policy: Partial<AuthPolicy> = {},
): Promise<Harness> {
  const env = apiEnvSchema.parse({
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused_test',
    REDIS_URL: 'redis://127.0.0.1:1/15',
    WEB_APP_URL: WEB,
  });
  // One connection per client: PGlite (local runs) multiplexes one session.
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
    .useValue(() => new Date(clock.now.getTime()))
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

export interface CallOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly session?: Session;
  readonly headers?: Record<string, string>;
  /** Browser-like headers of the web app; false for a non-browser client. */
  readonly browser?: false | { origin?: string; site?: string };
  /** Leave out the session's CSRF token on a mutation. */
  readonly withoutCsrf?: boolean;
}

export interface Session {
  readonly token: string;
  readonly csrfToken: string;
  readonly userId: string;
  readonly email: string;
}

export async function call(
  api: Harness,
  path: string,
  options: CallOptions = {},
) {
  const method =
    options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.session !== undefined) {
    headers['cookie'] = `${SESSION_COOKIE_NAME}=${options.session.token}`;
    if (method !== 'GET' && options.withoutCsrf !== true) {
      headers[CSRF_HEADER_NAME] = options.session.csrfToken;
    }
  }
  const browser = options.browser ?? {};
  if (browser !== false && method !== 'GET') {
    headers['origin'] = browser.origin ?? WEB;
    headers['sec-fetch-site'] = browser.site ?? 'same-origin';
  }
  const response = await fetch(`${api.baseUrl}${path}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
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

export type CallResult = Awaited<ReturnType<typeof call>>;

export function expectError(
  result: CallResult,
  status: number,
  code: ApiErrorCode,
) {
  expect(result.status, result.text).toBe(status);
  const body = apiErrorResponseSchema.parse(result.json);
  expect(body.error.code).toBe(code);
  return body;
}

/** The newest message to `to` with `template`, and the token in its link (if any). */
export function lastMail(api: Harness, to: string, template: string) {
  const message = api.mail.sent
    .filter((m) => m.to === to && m.template === template)
    .at(-1);
  if (message === undefined) {
    throw new Error(`no ${template} mail to ${to}`);
  }
  const token = /#token=([A-Za-z0-9_-]{43})\b/.exec(message.textBody)?.[1];
  if (token !== undefined) {
    captured.secrets.add(token);
  }
  return { message, token };
}

export const freshEmail = (label: string) =>
  `${label}.${randomUUID().slice(0, 8)}@example.test`;

/** Registers, verifies and signs in a new account. */
export async function signedInUser(
  api: Harness,
  label: string,
  email = freshEmail(label),
): Promise<Session> {
  expect(
    (
      await call(api, AUTH_ROUTES.register, {
        body: { email, password: PASSWORD },
      })
    ).status,
  ).toBe(202);
  await api.tasks.drain();
  const { token } = lastMail(api, email, 'auth.verify_email');
  expect(
    (await call(api, AUTH_ROUTES.verifyEmail, { body: { token } })).status,
  ).toBe(200);
  return signIn(api, email);
}

export async function signIn(api: Harness, email: string): Promise<Session> {
  const result = await call(api, AUTH_ROUTES.login, {
    body: { email, password: PASSWORD },
  });
  expect(result.status, result.text).toBe(200);
  const body = sessionResponseSchema.parse(result.json);
  let token: string | undefined;
  for (const header of result.setCookies) {
    const cookie = parseSetCookie(header);
    if (
      cookie.name === SESSION_COOKIE_NAME &&
      cookie.value !== undefined &&
      cookie.value !== ''
    ) {
      token = cookie.value;
    }
  }
  if (token === undefined) {
    throw new Error('no session cookie');
  }
  captured.secrets.add(token);
  captured.secrets.add(body.csrfToken);
  return { token, csrfToken: body.csrfToken, userId: body.user.id, email };
}

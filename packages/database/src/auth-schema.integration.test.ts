import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthStore, type AuthStore } from './auth/store.js';
import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Authentication tables (task 04A, docs/decisions.md D-04A-*) and their store, on real
// PostgreSQL. The HTTP flows are tested in apps/api (auth.integration.test.ts). Runs only
// when TEST_DATABASE_URL is set; otherwise it is reported as skipped, never as passed.
const db = new MigratedSchema('t04a');
const CHECK = '23514';
const UNIQUE = '23505';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
// A real Argon2id PHC string (salt and hash are base64 without padding).
const ARGON2ID =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$ZmFrZWhhc2hmYWtlaGFzaGZha2VoYXNoZmFrZWhhc2g';

describe.runIf(testDatabaseUrl !== undefined)(
  'authentication tables on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let client: Client;
    let store: AuthStore;
    const at = (iso: string) => new Date(iso);

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      store = createAuthStore(prisma);
      client = await db.connect();
    }, 60_000);

    afterAll(async () => {
      await client.end();
      await prisma.$disconnect();
      await db.drop();
    }, 60_000);

    async function newUser(passwordHash = ARGON2ID) {
      const email = `user.${randomUUID().slice(0, 8)}@example.test`;
      const created = await store.createUserWithPassword({
        email,
        normalizedEmail: email,
        displayName: null,
        passwordHash,
        now: at('2026-11-02T09:00:00Z'),
      });
      if (created === null) {
        throw new Error('duplicate');
      }
      return { id: created.id, email };
    }

    async function rejects(sql: string, params: unknown[], code: string) {
      await expect(client.query(sql, params)).rejects.toMatchObject({ code });
    }

    describe('integrity rules (SQL)', () => {
      it.each([
        ['a plain password', 'correct horse battery staple'],
        [
          'a bcrypt hash',
          '$2b$12$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUV12345',
        ],
        ['an Argon2i hash', ARGON2ID.replace('argon2id', 'argon2i')],
      ])('stores only Argon2id hashes, not %s', async (_name, value) => {
        const { id } = await newUser();
        await rejects(
          'UPDATE user_credentials SET password_hash = $2 WHERE user_id = $1',
          [id, value],
          CHECK,
        );
      });

      it('stores tokens only as SHA-256 and keeps session times consistent', async () => {
        const { id } = await newUser();
        const session = (overrides: Record<string, unknown>) => {
          const row: Record<string, unknown> = {
            id: randomUUID(),
            user_id: id,
            token_hash: sha(randomUUID()),
            created_at: at('2026-11-02T09:00:00Z'),
            last_seen_at: at('2026-11-02T09:00:00Z'),
            idle_expires_at: at('2026-11-02T09:30:00Z'),
            absolute_expires_at: at('2026-11-02T17:00:00Z'),
            ...overrides,
          };
          const columns = Object.keys(row);
          return client.query(
            `INSERT INTO user_sessions (${columns.join(', ')})
           VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
            Object.values(row),
          );
        };
        await session({});
        for (const overrides of [
          { token_hash: 'A'.repeat(64) },
          { token_hash: randomUUID() },
          { idle_expires_at: at('2026-11-02T18:00:00Z') },
          { ended_at: at('2026-11-02T10:00:00Z') },
          { end_reason: 'LOGOUT' },
        ]) {
          await expect(session(overrides)).rejects.toMatchObject({
            code: CHECK,
          });
        }
      });

      it('allows one unused token per user and purpose, used only before expiry', async () => {
        const { id, email } = await newUser();
        const now = at('2026-11-02T09:00:00Z');
        const issue = (purpose: string, extra: Record<string, unknown> = {}) =>
          client.query(
            `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, email, created_at, expires_at, used_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              id,
              purpose,
              extra['token_hash'] ?? sha(randomUUID()),
              extra['email'] ?? email,
              now,
              extra['expires_at'] ?? at('2026-11-02T09:30:00Z'),
              extra['used_at'] ?? null,
            ],
          );
        await issue('PASSWORD_RESET');
        await expect(issue('PASSWORD_RESET')).rejects.toMatchObject({
          code: UNIQUE,
        });
        await issue('EMAIL_VERIFICATION');
        await issue('PASSWORD_RESET', { used_at: at('2026-11-02T09:10:00Z') });
        for (const extra of [
          { used_at: at('2026-11-02T10:00:00Z') },
          { expires_at: now },
          { email: 'Not.Normalized@Example.test' },
          { token_hash: 'x'.repeat(64) },
        ]) {
          await expect(
            issue('PASSWORD_RESET', {
              used_at: at('2026-11-02T09:05:00Z'),
              ...extra,
            }),
          ).rejects.toMatchObject({ code: CHECK });
        }
      });

      it('keys throttles by hash and deletes a user with everything that authenticates it', async () => {
        await rejects(
          `INSERT INTO auth_throttles (scope, key_hash, attempts, window_started_at, updated_at)
         VALUES ('LOGIN', 'someone@example.test', 1, now(), now())`,
          [],
          CHECK,
        );
        const { id } = await newUser();
        await store.createSession({
          userId: id,
          tokenHash: sha(randomUUID()),
          now: at('2026-11-02T09:00:00Z'),
          idleExpiresAt: at('2026-11-02T09:30:00Z'),
          absoluteExpiresAt: at('2026-11-02T17:00:00Z'),
        });
        await client.query('DELETE FROM users WHERE id = $1', [id]);
        for (const table of [
          'user_credentials',
          'user_sessions',
          'auth_tokens',
        ]) {
          const left = await client.query(
            `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`,
            [id],
          );
          expect(left.rows, table).toEqual([{ n: 0 }]);
        }
      });
    });

    describe('store', () => {
      const rule = { maxAttempts: 3, windowSeconds: 600, lockSeconds: 900 };

      it('counts attempts per window, locks at the limit and unlocks after the lock', async () => {
        const key = sha(randomUUID());
        const t = (minutes: number) =>
          new Date(Date.parse('2026-11-02T09:00:00Z') + minutes * 60_000);
        expect(await store.recordAttempt('LOGIN', key, rule, t(0))).toEqual({
          allowed: true,
          retryAfterSeconds: null,
        });
        await store.recordAttempt('LOGIN', key, rule, t(1));
        // The third attempt is counted and starts the lock.
        expect(await store.recordAttempt('LOGIN', key, rule, t(2))).toEqual({
          allowed: true,
          retryAfterSeconds: 900,
        });
        expect(await store.lockedFor('LOGIN', key, t(3))).toBe(840);
        expect(await store.recordAttempt('LOGIN', key, rule, t(3))).toEqual({
          allowed: false,
          retryAfterSeconds: 840,
        });
        expect(await store.lockedFor('LOGIN', key, t(17))).toBeNull();
        // After the lock, counting starts again.
        expect(await store.recordAttempt('LOGIN', key, rule, t(17))).toEqual({
          allowed: true,
          retryAfterSeconds: null,
        });
        // An old window without a lock also starts again.
        const other = sha(randomUUID());
        await store.recordAttempt('LOGIN', other, rule, t(0));
        await store.recordAttempt('LOGIN', other, rule, t(1));
        await store.recordAttempt('LOGIN', other, rule, t(11));
        expect(await store.lockedFor('LOGIN', other, t(12))).toBeNull();
        await store.clearAttempts('LOGIN', key);
        expect(
          await prisma.authThrottle.count({ where: { keyHash: key } }),
        ).toBe(0);
      });

      it('counts concurrent attempts exactly once each', async () => {
        const key = sha(randomUUID());
        const now = at('2026-11-02T09:00:00Z');
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            store.recordAttempt(
              'VERIFICATION_EMAIL',
              key,
              { ...rule, maxAttempts: 100 },
              now,
            ),
          ),
        );
        expect(results.every((r) => r.allowed)).toBe(true);
        const row = await prisma.authThrottle.findUniqueOrThrow({
          where: {
            scope_keyHash: { scope: 'VERIFICATION_EMAIL', keyHash: key },
          },
        });
        expect(row.attempts).toBe(8);
      });

      it('replaces an unused token and refuses one for a changed address', async () => {
        const { id, email } = await newUser();
        const now = at('2026-11-02T09:00:00Z');
        const later = at('2026-11-03T09:00:00Z');
        const first = sha('first');
        const second = sha('second');
        await store.issueToken({
          userId: id,
          purpose: 'EMAIL_VERIFICATION',
          tokenHash: first,
          email,
          now,
          expiresAt: later,
        });
        await store.issueToken({
          userId: id,
          purpose: 'EMAIL_VERIFICATION',
          tokenHash: second,
          email,
          now,
          expiresAt: later,
        });
        expect(
          await store.isTokenUsable(first, 'EMAIL_VERIFICATION', now),
        ).toBe(false);
        expect(
          await store.isTokenUsable(second, 'EMAIL_VERIFICATION', now),
        ).toBe(true);
        // The address changed after the link was sent: the link no longer verifies anything.
        await prisma.user.update({
          where: { id },
          data: { normalizedEmail: `changed.${email}` },
        });
        expect(await store.verifyEmailWithToken(second, now)).toBe(false);
        expect(
          await store.isTokenUsable(second, 'EMAIL_VERIFICATION', now),
        ).toBe(true);
      });

      it('resets a password atomically: hash, verification and every session', async () => {
        const { id, email } = await newUser();
        const now = at('2026-11-02T09:00:00Z');
        for (let i = 0; i < 2; i += 1) {
          await store.createSession({
            userId: id,
            tokenHash: sha(randomUUID()),
            now,
            idleExpiresAt: at('2026-11-02T09:30:00Z'),
            absoluteExpiresAt: at('2026-11-02T17:00:00Z'),
          });
        }
        const tokenHash = sha(randomUUID());
        await store.issueToken({
          userId: id,
          purpose: 'PASSWORD_RESET',
          tokenHash,
          email,
          now,
          expiresAt: at('2026-11-02T09:30:00Z'),
        });
        const newHash = ARGON2ID.replace('t=2', 't=3');
        const after = at('2026-11-02T09:10:00Z');
        expect(
          await store.resetPasswordWithToken({
            tokenHash,
            passwordHash: newHash,
            now: after,
          }),
        ).toEqual({ id, email });
        const user = await prisma.user.findUniqueOrThrow({
          where: { id },
          include: { credential: true, sessions: true },
        });
        expect(user.credential?.passwordHash).toBe(newHash);
        expect(user.emailVerifiedAt).toEqual(after);
        expect(user.sessions.map((s) => s.endReason)).toEqual([
          'PASSWORD_RESET',
          'PASSWORD_RESET',
        ]);
        expect(
          await store.resetPasswordWithToken({
            tokenHash,
            passwordHash: newHash,
            now: after,
          }),
        ).toBeNull();
      });
    });
  },
);

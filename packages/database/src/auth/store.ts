// Data access for authentication (task 04A, docs/decisions.md D-04A-*). Platform-scope
// tables: users, user_credentials, user_sessions, auth_tokens, auth_throttles. Callers pass
// only hashes: SHA-256 of tokens and email keys, Argon2id hashes of passwords.
import {
  Prisma,
  type AuthThrottleScope,
  type AuthTokenPurpose,
  type PrismaClient,
  type SessionEndReason,
  type UserStatus,
} from '../generated/prisma/client.js';

export interface LoginCandidate {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly status: UserStatus;
  readonly emailVerifiedAt: Date | null;
  readonly isPlatformAdmin: boolean;
  /** Null when the user has no password (e.g. created by an import or an admin). */
  readonly passwordHash: string | null;
}

export interface ActiveSession {
  readonly id: string;
  readonly userId: string;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly endedAt: Date | null;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly status: UserStatus;
    readonly emailVerifiedAt: Date | null;
    readonly isPlatformAdmin: boolean;
  };
}

/** A counter rule: `maxAttempts` per `windowSeconds`, then locked for `lockSeconds`. */
export interface AttemptRule {
  readonly maxAttempts: number;
  readonly windowSeconds: number;
  readonly lockSeconds: number;
}

export interface AttemptResult {
  /** False when the key was already locked; the attempt was not counted. */
  readonly allowed: boolean;
  /** Seconds until the lock ends (when locked now). */
  readonly retryAfterSeconds: number | null;
}

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  emailVerifiedAt: true,
  isPlatformAdmin: true,
} as const;

function secondsUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export function createAuthStore(prisma: PrismaClient) {
  return {
    async findLoginCandidate(
      normalizedEmail: string,
    ): Promise<LoginCandidate | null> {
      const user = await prisma.user.findUnique({
        where: { normalizedEmail },
        select: {
          ...USER_SELECT,
          credential: { select: { passwordHash: true } },
        },
      });
      if (user === null) {
        return null;
      }
      const { credential, ...rest } = user;
      return { ...rest, passwordHash: credential?.passwordHash ?? null };
    },

    /** Creates the user with a password. Null when the address is already registered. */
    async createUserWithPassword(input: {
      email: string;
      normalizedEmail: string;
      displayName: string | null;
      passwordHash: string;
      now: Date;
    }): Promise<{ readonly id: string } | null> {
      try {
        return await prisma.user.create({
          data: {
            email: input.email,
            normalizedEmail: input.normalizedEmail,
            displayName: input.displayName,
            createdAt: input.now,
            credential: {
              create: {
                passwordHash: input.passwordHash,
                passwordChangedAt: input.now,
                createdAt: input.now,
              },
            },
          },
          select: { id: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return null;
        }
        throw error;
      }
    },

    /** Replaces a hash with a stronger one of the same password (after a successful login). */
    async rehashPassword(userId: string, passwordHash: string): Promise<void> {
      await prisma.userCredential.update({
        where: { userId },
        data: { passwordHash },
      });
    },

    async createSession(input: {
      userId: string;
      tokenHash: string;
      now: Date;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
    }): Promise<{ readonly id: string }> {
      return prisma.userSession.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          createdAt: input.now,
          lastSeenAt: input.now,
          idleExpiresAt: input.idleExpiresAt,
          absoluteExpiresAt: input.absoluteExpiresAt,
        },
        select: { id: true },
      });
    },

    /** The session for a token hash, ended or not; null if unknown. */
    async findSession(tokenHash: string): Promise<ActiveSession | null> {
      return prisma.userSession.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          lastSeenAt: true,
          idleExpiresAt: true,
          absoluteExpiresAt: true,
          endedAt: true,
          user: { select: USER_SELECT },
        },
      });
    },

    async touchSession(
      sessionId: string,
      now: Date,
      idleExpiresAt: Date,
    ): Promise<void> {
      await prisma.userSession.updateMany({
        where: { id: sessionId, endedAt: null },
        data: { lastSeenAt: now, idleExpiresAt },
      });
    },

    async endSession(
      sessionId: string,
      reason: SessionEndReason,
      now: Date,
    ): Promise<void> {
      await prisma.userSession.updateMany({
        where: { id: sessionId, endedAt: null },
        data: { endedAt: now, endReason: reason },
      });
    },

    /**
     * Issues a single-use token: deletes the user's unused token for the same purpose, then
     * stores the hash of the new one.
     */
    async issueToken(input: {
      userId: string;
      purpose: AuthTokenPurpose;
      tokenHash: string;
      email: string;
      now: Date;
      expiresAt: Date;
    }): Promise<void> {
      await prisma.$transaction([
        prisma.authToken.deleteMany({
          where: { userId: input.userId, purpose: input.purpose, usedAt: null },
        }),
        prisma.authToken.create({
          data: {
            userId: input.userId,
            purpose: input.purpose,
            tokenHash: input.tokenHash,
            email: input.email,
            createdAt: input.now,
            expiresAt: input.expiresAt,
          },
        }),
      ]);
    },

    /** Deletes the user's unused tokens of `purpose`: their links stop working. */
    async revokeTokens(
      userId: string,
      purpose: AuthTokenPurpose,
    ): Promise<void> {
      await prisma.authToken.deleteMany({
        where: { userId, purpose, usedAt: null },
      });
    },

    /** True when an unused, unexpired token of `purpose` has this hash (no side effects). */
    async isTokenUsable(
      tokenHash: string,
      purpose: AuthTokenPurpose,
      now: Date,
    ): Promise<boolean> {
      const count = await prisma.authToken.count({
        where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      });
      return count === 1;
    },

    /**
     * Verifies an email address with a token: marks the token used and the user verified,
     * atomically. Returns the user id, or null when the token is unknown, used, expired, for
     * another purpose, or no longer matches the user's address or an active user.
     */
    async verifyEmailWithToken(
      tokenHash: string,
      now: Date,
    ): Promise<string | null> {
      return prisma
        .$transaction(async (tx) => {
          const token = await consumeToken(
            tx,
            tokenHash,
            'EMAIL_VERIFICATION',
            now,
          );
          if (token === null) {
            return null;
          }
          const { count } = await tx.user.updateMany({
            where: {
              id: token.userId,
              normalizedEmail: token.email,
              status: 'ACTIVE',
            },
            data: { emailVerifiedAt: now },
          });
          if (count !== 1) {
            // Roll back: the token stays unused but can never succeed.
            throw new TokenMismatch();
          }
          return token.userId;
        })
        .catch((error: unknown) => {
          if (error instanceof TokenMismatch) {
            return null;
          }
          throw error;
        });
    },

    /**
     * Resets a password with a token: marks the token used, stores the new hash, verifies
     * the address (the link proved it) and ends every session of the user. Returns the user
     * (for the notice email), or null under the same conditions as verifyEmailWithToken.
     */
    async resetPasswordWithToken(input: {
      tokenHash: string;
      passwordHash: string;
      now: Date;
    }): Promise<{ readonly id: string; readonly email: string } | null> {
      const { tokenHash, passwordHash, now } = input;
      return prisma
        .$transaction(async (tx) => {
          const token = await consumeToken(
            tx,
            tokenHash,
            'PASSWORD_RESET',
            now,
          );
          if (token === null) {
            return null;
          }
          const user = await tx.user.findFirst({
            where: {
              id: token.userId,
              normalizedEmail: token.email,
              status: 'ACTIVE',
            },
            select: { id: true, email: true, emailVerifiedAt: true },
          });
          if (user === null) {
            throw new TokenMismatch();
          }
          await tx.userCredential.upsert({
            where: { userId: user.id },
            create: {
              userId: user.id,
              passwordHash,
              passwordChangedAt: now,
              createdAt: now,
            },
            update: { passwordHash, passwordChangedAt: now },
          });
          if (user.emailVerifiedAt === null) {
            await tx.user.update({
              where: { id: user.id },
              data: { emailVerifiedAt: now },
            });
          }
          await tx.userSession.updateMany({
            where: { userId: user.id, endedAt: null },
            data: { endedAt: now, endReason: 'PASSWORD_RESET' },
          });
          return { id: user.id, email: user.email };
        })
        .catch((error: unknown) => {
          if (error instanceof TokenMismatch) {
            return null;
          }
          throw error;
        });
    },

    /** Seconds until the key's lock ends, or null when it is not locked. */
    async lockedFor(
      scope: AuthThrottleScope,
      keyHash: string,
      now: Date,
    ): Promise<number | null> {
      const row = await prisma.authThrottle.findUnique({
        where: { scope_keyHash: { scope, keyHash } },
        select: { lockedUntil: true },
      });
      return row?.lockedUntil != null && row.lockedUntil > now
        ? secondsUntil(row.lockedUntil, now)
        : null;
    },

    /**
     * Counts one attempt under `rule`. Not counted, and not allowed, while the key is locked.
     * The attempt that reaches `maxAttempts` is allowed and starts the lock. Concurrent
     * attempts are serialized optimistically: the update applies only to the row version
     * that was read, otherwise it is retried.
     */
    async recordAttempt(
      scope: AuthThrottleScope,
      keyHash: string,
      rule: AttemptRule,
      now: Date,
    ): Promise<AttemptResult> {
      await prisma.authThrottle.createMany({
        data: [
          { scope, keyHash, attempts: 0, windowStartedAt: now, updatedAt: now },
        ],
        skipDuplicates: true,
      });
      for (let retry = 0; retry < 10; retry += 1) {
        const row = await prisma.authThrottle.findUniqueOrThrow({
          where: { scope_keyHash: { scope, keyHash } },
        });
        if (row.lockedUntil !== null && row.lockedUntil > now) {
          return {
            allowed: false,
            retryAfterSeconds: secondsUntil(row.lockedUntil, now),
          };
        }
        const windowEnd = new Date(
          row.windowStartedAt.getTime() + rule.windowSeconds * 1000,
        );
        // A new window after the old one ended, or after a lock ran out.
        const fresh = windowEnd <= now || row.lockedUntil !== null;
        const attempts = fresh ? 1 : row.attempts + 1;
        const lockedUntil =
          attempts >= rule.maxAttempts
            ? new Date(now.getTime() + rule.lockSeconds * 1000)
            : null;
        const { count } = await prisma.authThrottle.updateMany({
          where: {
            scope,
            keyHash,
            attempts: row.attempts,
            windowStartedAt: row.windowStartedAt,
            lockedUntil: row.lockedUntil,
          },
          data: {
            attempts,
            windowStartedAt: fresh ? now : row.windowStartedAt,
            lockedUntil,
            updatedAt: now,
          },
        });
        if (count === 1) {
          return {
            allowed: true,
            retryAfterSeconds:
              lockedUntil === null ? null : secondsUntil(lockedUntil, now),
          };
        }
      }
      throw new Error('auth_throttles: too many concurrent updates');
    },

    /**
     * Records a security event about a user's account in the platform audit records (task
     * 04C, D-04C-03): the user as actor when they acted themselves, otherwise the system actor
     * "auth". Callers pass ids and codes only: never tokens, passwords or addresses.
     */
    async recordSecurityEvent(input: {
      action: string;
      userId: string;
      byUser: boolean;
      target?: { type: string; id: string };
      metadata?: Prisma.InputJsonObject;
      requestId?: string | undefined;
      now: Date;
    }): Promise<void> {
      await prisma.platformAuditRecord.create({
        data: {
          actorType: input.byUser ? 'USER' : 'SYSTEM',
          actorUserId: input.byUser ? input.userId : null,
          actorName: input.byUser ? null : 'auth',
          action: input.action,
          targetType: input.target?.type ?? 'user',
          targetId: input.target?.id ?? input.userId,
          occurredAt: input.now,
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          ...(input.requestId === undefined
            ? {}
            : { requestId: input.requestId }),
        },
      });
    },

    async clearAttempts(
      scope: AuthThrottleScope,
      keyHash: string,
    ): Promise<void> {
      await prisma.authThrottle.deleteMany({ where: { scope, keyHash } });
    },
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;

class TokenMismatch extends Error {}

/** Marks an unused, unexpired token of `purpose` used; null when there is none. */
async function consumeToken(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  purpose: AuthTokenPurpose,
  now: Date,
): Promise<{ userId: string; email: string } | null> {
  const used = await tx.authToken.updateManyAndReturn({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
    select: { userId: true, email: true },
  });
  return used[0] ?? null;
}

// Registration, email verification, login, sessions and password reset (task 04A,
// docs/decisions.md D-04A-*, contract: @lead-fennec-ai/shared contracts/auth.ts).
import {
  type AuthStore,
  type AuthThrottleScope,
  type AuthTokenPurpose,
  type AttemptRule,
  type LoginCandidate,
} from '@lead-fennec-ai/database';
import type { TransactionalMailProvider } from '@lead-fennec-ai/integrations';
import {
  AUTH_LINK_PATHS,
  IdentityNormalizationError,
  normalizeEmail,
  type LoginRequest,
  type SessionResponse,
} from '@lead-fennec-ai/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUTH_STORE } from '../database/database.module.js';
import { API_ENV, type ApiEnv } from '../env.js';
import { TRANSACTIONAL_MAIL } from '../mail/mail.module.js';
import {
  csrfTokenFor,
  emailKeyHash,
  newToken,
  sha256Hex,
} from './auth-crypto.js';
import {
  ApiHttpException,
  invalidCredentials,
  tooManyRequests,
} from '../http/api-errors.js';
import {
  alreadyRegisteredMessage,
  finishSetupMessage,
  passwordChangedMessage,
  passwordResetMessage,
  tokenLink,
  verifyEmailMessage,
} from './auth-mail.js';
import {
  AUTH_CLOCK,
  AUTH_POLICY,
  type AuthClock,
  type AuthPolicy,
} from './auth.policy.js';
import { AuthTasks } from './auth-tasks.js';
import { PasswordHasher } from './password-hasher.js';

/** An authenticated request's session (SessionGuard). */
export interface SessionContext {
  readonly sessionId: string;
  /** The cookie's value; used only to derive the CSRF token. Never logged or returned. */
  readonly sessionToken: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
  };
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

const plus = (date: Date, seconds: number) =>
  new Date(date.getTime() + seconds * 1000);

const invalidToken = () =>
  new ApiHttpException(
    400,
    'invalid_or_expired_token',
    'This link is invalid or has expired. Request a new one.',
  );

const unauthenticated = () =>
  new ApiHttpException(401, 'unauthenticated', 'Sign in to continue.', {
    clearSession: true,
  });

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly webAppUrl: string;

  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(TRANSACTIONAL_MAIL)
    private readonly mail: TransactionalMailProvider,
    @Inject(AUTH_POLICY) private readonly policy: AuthPolicy,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
    @Inject(API_ENV) env: ApiEnv,
    private readonly hasher: PasswordHasher,
    private readonly tasks: AuthTasks,
  ) {
    this.webAppUrl = env.WEB_APP_URL;
  }

  // ─── Requests answered with 202, whatever the account state ────────────────

  register(input: {
    email: string;
    password: string;
    displayName?: string | undefined;
  }): void {
    const normalized = this.normalize(input.email);
    const email = input.email.trim();
    this.tasks.run('register', async () => {
      const existing = await this.store.findLoginCandidate(normalized);
      if (existing !== null) {
        await this.registeredAgain(existing, normalized);
        return;
      }
      const passwordHash = await this.hasher.hash(input.password);
      const created = await this.store.createUserWithPassword({
        email,
        normalizedEmail: normalized,
        displayName: input.displayName ?? null,
        passwordHash,
        now: this.clock(),
      });
      if (created === null) {
        // Registered concurrently: treat like a repeated registration.
        const raced = await this.store.findLoginCandidate(normalized);
        if (raced !== null) {
          await this.registeredAgain(raced, normalized);
        }
        return;
      }
      await this.sendVerification({ id: created.id, email }, normalized);
    });
  }

  resendVerification(rawEmail: string): void {
    const normalized = this.normalize(rawEmail);
    this.tasks.run('resend_verification', async () => {
      const user = await this.store.findLoginCandidate(normalized);
      if (user?.status !== 'ACTIVE' || user.emailVerifiedAt !== null) {
        return;
      }
      await this.sendVerification(user, normalized);
    });
  }

  requestPasswordReset(rawEmail: string): void {
    const normalized = this.normalize(rawEmail);
    this.tasks.run('password_reset_request', async () => {
      const user = await this.store.findLoginCandidate(normalized);
      if (user?.status !== 'ACTIVE') {
        return;
      }
      if (
        !(await this.allowEmail(
          'PASSWORD_RESET_EMAIL',
          normalized,
          this.policy.passwordResetEmails,
        ))
      ) {
        return;
      }
      const token = await this.issue(
        user.id,
        'PASSWORD_RESET',
        normalized,
        this.policy.passwordResetTokenSeconds,
      );
      await this.mail.send(
        passwordResetMessage(
          user.email,
          tokenLink(this.webAppUrl, AUTH_LINK_PATHS.resetPassword, token),
          this.policy.passwordResetTokenSeconds / 60,
        ),
      );
    });
  }

  // ─── Emailed links ─────────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    if (
      !(await this.store.verifyEmailWithToken(sha256Hex(token), this.clock()))
    ) {
      throw invalidToken();
    }
  }

  /** Sets a new password, verifies the address and ends every session of the user. */
  async confirmPasswordReset(
    token: string,
    newPassword: string,
  ): Promise<void> {
    const tokenHash = sha256Hex(token);
    // Cheap check first, so an unknown token never costs a password hash.
    if (
      !(await this.store.isTokenUsable(
        tokenHash,
        'PASSWORD_RESET',
        this.clock(),
      ))
    ) {
      throw invalidToken();
    }
    const passwordHash = await this.hasher.hash(newPassword);
    const user = await this.store.resetPasswordWithToken({
      tokenHash,
      passwordHash,
      now: this.clock(),
    });
    if (user === null) {
      throw invalidToken();
    }
    // The owner proved control of the address: lift any sign-in lock.
    await this.store.clearAttempts(
      'LOGIN',
      emailKeyHash(normalizeEmail(user.email).email),
    );
    this.tasks.run('password_changed_notice', async () => {
      await this.mail.send(passwordChangedMessage(user.email, this.webAppUrl));
    });
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  /**
   * Checks the password and starts a new session (a session cookie from the same browser is
   * ended first: the session id is never reused across a sign-in). Wrong password, unknown
   * address and disabled user are indistinguishable, in response and in cost.
   */
  async login(
    input: LoginRequest,
    previousSessionToken: string | null,
  ): Promise<{ sessionToken: string; session: SessionContext }> {
    const normalized = this.normalize(input.email);
    const key = emailKeyHash(normalized);
    const now = this.clock();
    const locked = await this.store.lockedFor('LOGIN', key, now);
    if (locked !== null) {
      throw tooManyRequests(locked);
    }
    const user = await this.store.findLoginCandidate(normalized);
    const passwordMatches = await this.hasher.verify(
      user?.passwordHash ?? null,
      input.password,
    );
    if (user === null || !passwordMatches || user.status !== 'ACTIVE') {
      const attempt = await this.store.recordAttempt(
        'LOGIN',
        key,
        this.policy.loginFailures,
        now,
      );
      if (!attempt.allowed && attempt.retryAfterSeconds !== null) {
        throw tooManyRequests(attempt.retryAfterSeconds);
      }
      throw invalidCredentials();
    }
    if (user.emailVerifiedAt === null) {
      throw new ApiHttpException(
        403,
        'email_not_verified',
        'Confirm your email address first. We can send the link again.',
      );
    }
    await this.store.clearAttempts('LOGIN', key);
    if (
      user.passwordHash !== null &&
      this.hasher.needsRehash(user.passwordHash)
    ) {
      await this.store.rehashPassword(
        user.id,
        await this.hasher.hash(input.password),
      );
    }
    if (previousSessionToken !== null) {
      const previous = await this.store.findSession(
        sha256Hex(previousSessionToken),
      );
      if (previous !== null && previous.endedAt === null) {
        await this.store.endSession(previous.id, 'REPLACED', now);
      }
    }
    const sessionToken = newToken();
    const absoluteExpiresAt = plus(now, this.policy.sessionAbsoluteSeconds);
    const idleExpiresAt = new Date(
      Math.min(
        plus(now, this.policy.sessionIdleSeconds).getTime(),
        absoluteExpiresAt.getTime(),
      ),
    );
    const { id } = await this.store.createSession({
      userId: user.id,
      tokenHash: sha256Hex(sessionToken),
      now,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    return {
      sessionToken,
      session: {
        sessionId: id,
        sessionToken,
        user: { id: user.id, email: user.email, displayName: user.displayName },
        idleExpiresAt,
        absoluteExpiresAt,
      },
    };
  }

  /** The request's session, or 401. Expired sessions are ended; activity extends idle time. */
  async authenticate(sessionToken: string | null): Promise<SessionContext> {
    if (sessionToken === null) {
      throw unauthenticated();
    }
    const session = await this.store.findSession(sha256Hex(sessionToken));
    // Unknown or ended.
    if (session?.endedAt !== null) {
      throw unauthenticated();
    }
    const now = this.clock();
    if (session.user.status !== 'ACTIVE') {
      await this.store.endSession(session.id, 'USER_DISABLED', now);
      throw unauthenticated();
    }
    if (now >= session.idleExpiresAt || now >= session.absoluteExpiresAt) {
      await this.store.endSession(session.id, 'EXPIRED', now);
      throw new ApiHttpException(
        401,
        'session_expired',
        'Your session has expired. Sign in again.',
        { clearSession: true },
      );
    }
    let idleExpiresAt = session.idleExpiresAt;
    if (
      now.getTime() - session.lastSeenAt.getTime() >=
      this.policy.sessionTouchSeconds * 1000
    ) {
      idleExpiresAt = new Date(
        Math.min(
          plus(now, this.policy.sessionIdleSeconds).getTime(),
          session.absoluteExpiresAt.getTime(),
        ),
      );
      await this.store.touchSession(session.id, now, idleExpiresAt);
    }
    return {
      sessionId: session.id,
      sessionToken,
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
      },
      idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    };
  }

  async logout(session: SessionContext): Promise<void> {
    await this.store.endSession(session.sessionId, 'LOGOUT', this.clock());
  }

  sessionResponse(session: SessionContext): SessionResponse {
    return {
      user: { ...session.user, emailVerified: true },
      session: {
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      },
      csrfToken: csrfTokenFor(session.sessionToken),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private normalize(rawEmail: string): string {
    try {
      return normalizeEmail(rawEmail).email;
    } catch (error) {
      if (error instanceof IdentityNormalizationError) {
        throw new ApiHttpException(
          400,
          'validation_failed',
          'The request is invalid.',
          {
            issues: [
              { path: 'email', message: 'Enter a valid email address.' },
            ],
          },
        );
      }
      throw error;
    }
  }

  /**
   * Someone registered an address that already has an account. Verified: tell the owner.
   * Not verified: earlier confirmation links stop working and the inbox owner chooses the
   * password, so whoever registered first cannot keep a password on someone else's
   * address (account pre-hijacking, D-04A-08).
   */
  private async registeredAgain(
    user: LoginCandidate,
    normalized: string,
  ): Promise<void> {
    if (user.status !== 'ACTIVE') {
      return;
    }
    if (
      !(await this.allowEmail(
        'VERIFICATION_EMAIL',
        normalized,
        this.policy.verificationEmails,
      ))
    ) {
      return;
    }
    if (user.emailVerifiedAt !== null) {
      await this.mail.send(
        alreadyRegisteredMessage(user.email, this.webAppUrl),
      );
      return;
    }
    await this.store.revokeTokens(user.id, 'EMAIL_VERIFICATION');
    const token = await this.issue(
      user.id,
      'PASSWORD_RESET',
      normalized,
      this.policy.passwordResetTokenSeconds,
    );
    await this.mail.send(
      finishSetupMessage(
        user.email,
        tokenLink(this.webAppUrl, AUTH_LINK_PATHS.resetPassword, token),
        this.policy.passwordResetTokenSeconds / 60,
      ),
    );
  }

  private async sendVerification(
    user: { readonly id: string; readonly email: string },
    normalized: string,
  ): Promise<void> {
    if (
      !(await this.allowEmail(
        'VERIFICATION_EMAIL',
        normalized,
        this.policy.verificationEmails,
      ))
    ) {
      return;
    }
    const token = await this.issue(
      user.id,
      'EMAIL_VERIFICATION',
      normalized,
      this.policy.verificationTokenSeconds,
    );
    await this.mail.send(
      verifyEmailMessage(
        user.email,
        tokenLink(this.webAppUrl, AUTH_LINK_PATHS.verifyEmail, token),
        this.policy.verificationTokenSeconds / 3600,
      ),
    );
  }

  /** Issues a token and returns its value; only the hash is stored. */
  private async issue(
    userId: string,
    purpose: AuthTokenPurpose,
    normalized: string,
    validSeconds: number,
  ): Promise<string> {
    const token = newToken();
    const now = this.clock();
    await this.store.issueToken({
      userId,
      purpose,
      tokenHash: sha256Hex(token),
      email: normalized,
      now,
      expiresAt: plus(now, validSeconds),
    });
    return token;
  }

  /** Per-address email budget; the address itself is never logged. */
  private async allowEmail(
    scope: AuthThrottleScope,
    normalized: string,
    rule: AttemptRule,
  ): Promise<boolean> {
    const attempt = await this.store.recordAttempt(
      scope,
      emailKeyHash(normalized),
      rule,
      this.clock(),
    );
    if (!attempt.allowed) {
      this.logger.warn(
        `Auth email skipped: ${scope} limit reached for an address`,
      );
    }
    return attempt.allowed;
  }
}

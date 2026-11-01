// Authentication settings (docs/decisions.md D-04A-*). Constants for now; tests override
// AUTH_POLICY and AUTH_CLOCK through Nest's providers.
import type { AttemptRule } from '@lead-fennec-ai/database';

export interface AuthPolicy {
  /** Session ends after this long without a request (OWASP: 15–30 min for low-risk apps). */
  readonly sessionIdleSeconds: number;
  /** Session ends this long after sign-in, whatever the activity (OWASP: 4–8 h). */
  readonly sessionAbsoluteSeconds: number;
  /** Activity is written back at most this often per session. */
  readonly sessionTouchSeconds: number;
  readonly verificationTokenSeconds: number;
  readonly passwordResetTokenSeconds: number;
  /** Failed sign-ins per email address. */
  readonly loginFailures: AttemptRule;
  /** Verification and "already registered" emails per address. */
  readonly verificationEmails: AttemptRule;
  /** Password reset emails per address. */
  readonly passwordResetEmails: AttemptRule;
  /** Invitation links stay valid this long (task 04B). */
  readonly invitationTokenSeconds: number;
  /** Invitation emails per workspace (task 04B). */
  readonly invitationEmails: AttemptRule;
  /** Requests to each throttled auth route per client IP and minute. */
  readonly ipRequestsPerMinute: number;
  /** Argon2id cost (OWASP minimum: m=19456 KiB, t=2, p=1). */
  readonly argon2: {
    readonly memoryCost: number;
    readonly timeCost: number;
    readonly parallelism: number;
  };
}

export const DEFAULT_AUTH_POLICY: AuthPolicy = {
  sessionIdleSeconds: 30 * 60,
  sessionAbsoluteSeconds: 8 * 60 * 60,
  sessionTouchSeconds: 60,
  verificationTokenSeconds: 24 * 60 * 60,
  passwordResetTokenSeconds: 30 * 60,
  loginFailures: {
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    lockSeconds: 15 * 60,
  },
  verificationEmails: {
    maxAttempts: 3,
    windowSeconds: 60 * 60,
    lockSeconds: 60 * 60,
  },
  passwordResetEmails: {
    maxAttempts: 3,
    windowSeconds: 60 * 60,
    lockSeconds: 60 * 60,
  },
  invitationTokenSeconds: 7 * 24 * 60 * 60,
  invitationEmails: {
    maxAttempts: 100,
    windowSeconds: 24 * 60 * 60,
    lockSeconds: 24 * 60 * 60,
  },
  ipRequestsPerMinute: 20,
  argon2: { memoryCost: 19_456, timeCost: 2, parallelism: 1 },
};

export const AUTH_POLICY = Symbol('AUTH_POLICY');

/** The current time; one clock for every timestamp the auth flows write. */
export type AuthClock = () => Date;
export const AUTH_CLOCK = Symbol('AUTH_CLOCK');

// Bounded polling for live dashboard panels (task 05C, docs/decisions.md D-05C-04). Pure: the
// timing rules only; useApiQuery's `poll` option applies them. Polling runs only while the page
// is visible, waits longer after each failure, and stops after a fixed number of refreshes or
// failures until the user resumes it, so an open tab can't load the API indefinitely.

export interface PollPolicy {
  /** Wait between automatic refreshes while they succeed. */
  readonly intervalMs: number;
  /** Automatic refreshes before polling stops until the user resumes it. */
  readonly maxPolls: number;
  /** Consecutive failed refreshes before polling stops until the user retries. */
  readonly maxFailures: number;
  /** Longest wait after failures; the wait doubles with each consecutive failure. */
  readonly maxBackoffMs: number;
}

export interface PollProgress {
  /** Automatic refreshes since polling (re)started. */
  readonly polls: number;
  /** Consecutive failed automatic refreshes. */
  readonly failures: number;
  /** Refresh at once: the page became visible again or the user resumed. */
  readonly due: boolean;
}

export const POLL_START: PollProgress = Object.freeze({
  polls: 0,
  failures: 0,
  due: false,
});

/** Polling restarted by the user or by the page becoming visible: refresh now, then as usual. */
export const POLL_RESUME: PollProgress = Object.freeze({
  polls: 0,
  failures: 0,
  due: true,
});

export type PollStop = 'limit' | 'failures';

/** Why automatic refreshes have stopped, or null while they continue. */
export function pollStop(
  policy: PollPolicy,
  progress: PollProgress,
): PollStop | null {
  if (progress.failures >= policy.maxFailures) {
    return 'failures';
  }
  return progress.polls >= policy.maxPolls ? 'limit' : null;
}

/** Milliseconds until the next automatic refresh, or null when polling has stopped. */
export function nextPollDelay(
  policy: PollPolicy,
  progress: PollProgress,
): number | null {
  if (pollStop(policy, progress) !== null) {
    return null;
  }
  if (progress.due) {
    return 0;
  }
  return progress.failures === 0
    ? policy.intervalMs
    : Math.min(policy.intervalMs * 2 ** progress.failures, policy.maxBackoffMs);
}

/** The progress after an automatic refresh that succeeded (`ok`) or failed. */
export function afterPoll(progress: PollProgress, ok: boolean): PollProgress {
  return {
    polls: progress.polls + 1,
    failures: ok ? 0 : progress.failures + 1,
    due: false,
  };
}

/** Recent activity: every minute, for at most 30 minutes without the user. */
export const ACTIVITY_POLL: PollPolicy = Object.freeze({
  intervalMs: 60_000,
  maxPolls: 30,
  maxFailures: 3,
  maxBackoffMs: 5 * 60_000,
});

/** Integration health changes slowly: every 2 minutes, for at most 30 minutes. */
export const HEALTH_POLL: PollPolicy = Object.freeze({
  intervalMs: 2 * 60_000,
  maxPolls: 15,
  maxFailures: 3,
  maxBackoffMs: 10 * 60_000,
});

import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_POLL,
  afterPoll,
  HEALTH_POLL,
  nextPollDelay,
  POLL_RESUME,
  POLL_START,
  pollStop,
  type PollProgress,
} from './polling';

const run = (results: readonly boolean[], start: PollProgress = POLL_START) =>
  results.reduce(afterPoll, start);

describe('bounded polling (task 05C)', () => {
  it('refreshes at the interval while refreshes succeed', () => {
    expect(nextPollDelay(ACTIVITY_POLL, POLL_START)).toBe(60_000);
    expect(nextPollDelay(ACTIVITY_POLL, run([true, true]))).toBe(60_000);
  });

  it('refreshes at once when resumed or visible again', () => {
    expect(nextPollDelay(ACTIVITY_POLL, POLL_RESUME)).toBe(0);
    expect(run([true], POLL_RESUME).due).toBe(false);
  });

  it('waits longer after each failure, up to the cap, and stops after three', () => {
    expect(nextPollDelay(ACTIVITY_POLL, run([false]))).toBe(120_000);
    expect(nextPollDelay(ACTIVITY_POLL, run([false, false]))).toBe(240_000);
    expect(nextPollDelay(HEALTH_POLL, run([false, false]))).toBe(480_000);
    const capped = { ...ACTIVITY_POLL, maxFailures: 10 };
    expect(nextPollDelay(capped, run([false, false, false]))).toBe(300_000);
    const failed = run([false, false, false]);
    expect(pollStop(ACTIVITY_POLL, failed)).toBe('failures');
    expect(nextPollDelay(ACTIVITY_POLL, failed)).toBeNull();
    // A success in between starts the count again.
    expect(pollStop(ACTIVITY_POLL, run([false, false, true, false]))).toBe(
      null,
    );
  });

  it('stops after 30 minutes of automatic refreshes', () => {
    for (const policy of [ACTIVITY_POLL, HEALTH_POLL]) {
      expect(policy.intervalMs * policy.maxPolls).toBe(30 * 60_000);
      const almost = run(Array<boolean>(policy.maxPolls - 1).fill(true));
      expect(pollStop(policy, almost)).toBeNull();
      const done = afterPoll(almost, true);
      expect(pollStop(policy, done)).toBe('limit');
      expect(nextPollDelay(policy, done)).toBeNull();
    }
  });

  it('never refreshes more often than the interval without the user', () => {
    let progress = POLL_START;
    let elapsed = 0;
    for (let i = 0; i < 100; i += 1) {
      const delay = nextPollDelay(ACTIVITY_POLL, progress);
      if (delay === null) {
        break;
      }
      expect(delay).toBeGreaterThanOrEqual(ACTIVITY_POLL.intervalMs);
      elapsed += delay;
      progress = afterPoll(progress, i % 2 === 0);
    }
    expect(nextPollDelay(ACTIVITY_POLL, progress)).toBeNull();
    expect(elapsed).toBeLessThanOrEqual(2 * 60 * 60_000);
  });
});

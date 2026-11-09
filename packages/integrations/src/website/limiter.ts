// Per-host concurrency (task 09A, docs/decisions.md D-09A-03): at most N requests to one host
// at a time in this process; the rest wait in order, within their own time budget. It holds
// counts only, never page data, so one limiter serves every workspace.

export class HostConcurrencyLimiter {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, (() => void)[]>();

  constructor(readonly maxPerHost: number) {
    if (!Number.isInteger(maxPerHost) || maxPerHost < 1) {
      throw new RangeError('maxPerHost must be a positive integer.');
    }
  }

  /** Requests to `key` running now. */
  inFlight(key: string): number {
    return this.active.get(key) ?? 0;
  }

  /** Requests to `key` waiting for a slot. */
  queued(key: string): number {
    return this.waiting.get(key)?.length ?? 0;
  }

  /**
   * Waits for a slot; resolves with its release function (safe to call more than once).
   * Rejects with the signal's reason if the signal aborts first.
   */
  async acquire(key: string, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    const running = this.inFlight(key);
    if (running < this.maxPerHost) {
      this.active.set(key, running + 1);
      return this.releaser(key);
    }
    await new Promise<void>((resolve, reject) => {
      const queue = this.waiting.get(key) ?? [];
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = queue.indexOf(grant);
        if (index !== -1) {
          queue.splice(index, 1);
        }
        if (queue.length === 0) {
          this.waiting.delete(key);
        }
        reject(signal.reason as Error);
      };
      queue.push(grant);
      this.waiting.set(key, queue);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    // The slot was handed over by a release: the active count already includes it.
    return this.releaser(key);
  }

  private releaser(key: string): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const queue = this.waiting.get(key);
      const next = queue?.shift();
      if (queue?.length === 0) {
        this.waiting.delete(key);
      }
      if (next !== undefined) {
        next();
        return;
      }
      const running = this.inFlight(key) - 1;
      if (running <= 0) {
        this.active.delete(key);
      } else {
        this.active.set(key, running);
      }
    };
  }
}

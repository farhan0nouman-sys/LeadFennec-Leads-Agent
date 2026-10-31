export interface LivenessReport {
  readonly status: 'ok';
}

export interface ReadinessCheck {
  readonly name: string;
  /** Resolves when the dependency is usable; rejects otherwise. Must honour `timeoutMs`. */
  readonly check: (timeoutMs: number) => Promise<void>;
}

export interface DependencyStatus {
  readonly status: 'up' | 'down';
  readonly durationMs: number;
  readonly reason?: 'timeout' | 'unavailable';
}

/** Public readiness response. Holds no hostnames, error messages or credentials. */
export interface ReadinessReport {
  readonly status: 'ready' | 'not_ready';
  readonly checks: Readonly<Record<string, DependencyStatus>>;
}

export const LIVENESS_OK: LivenessReport = { status: 'ok' };

class CheckTimeoutError extends Error {
  override readonly name = 'CheckTimeoutError';
}

async function withTimeout(
  work: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new CheckTimeoutError(`timed out after ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs every check in parallel. Each check gets `timeoutMs`; a small grace period guards
 * against a check that ignores its timeout. Failures are reported to `onFailure` for
 * server-side logging and summarised in the report without details.
 */
export async function runReadinessChecks(
  checks: readonly ReadinessCheck[],
  timeoutMs: number,
  onFailure: (name: string, error: unknown) => void,
): Promise<ReadinessReport> {
  const results = await Promise.all(
    checks.map(async ({ name, check }): Promise<[string, DependencyStatus]> => {
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      try {
        await withTimeout(check(timeoutMs), timeoutMs + 250);
        return [name, { status: 'up', durationMs: elapsed() }];
      } catch (error) {
        onFailure(name, error);
        // A client's own timeout (e.g. pg connectionTimeoutMillis) also counts as a timeout.
        const durationMs = elapsed();
        const reason = durationMs >= timeoutMs ? 'timeout' : 'unavailable';
        return [name, { status: 'down', durationMs, reason }];
      }
    }),
  );
  const ready = results.every(([, result]) => result.status === 'up');
  return {
    status: ready ? 'ready' : 'not_ready',
    checks: Object.fromEntries(results),
  };
}

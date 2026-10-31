import { describe, expect, it, vi } from 'vitest';
import { runReadinessChecks, type ReadinessCheck } from './health.js';

const up: ReadinessCheck = { name: 'up', check: () => Promise.resolve() };
const down: ReadinessCheck = {
  name: 'down',
  check: () => Promise.reject(new Error('refused')),
};

describe('runReadinessChecks', () => {
  it('reports ready when every check passes', async () => {
    const report = await runReadinessChecks([up], 1_000, () => undefined);
    expect(report.status).toBe('ready');
    expect(report.checks['up']).toMatchObject({ status: 'up' });
  });

  it('reports not_ready, marks the failing check unavailable, and reports the error', async () => {
    const onFailure = vi.fn();
    const report = await runReadinessChecks([up, down], 1_000, onFailure);
    expect(report.status).toBe('not_ready');
    expect(report.checks['down']).toMatchObject({
      status: 'down',
      reason: 'unavailable',
    });
    expect(onFailure).toHaveBeenCalledWith('down', expect.any(Error));
  });

  it('gives up on a check that ignores its timeout and reports it as timeout', async () => {
    const hangs: ReadinessCheck = {
      name: 'hangs',
      check: () => new Promise(() => undefined),
    };
    const report = await runReadinessChecks([hangs], 100, () => undefined);
    expect(report.checks['hangs']).toMatchObject({
      status: 'down',
      reason: 'timeout',
    });
  });

  it('reports a failure that took the full timeout as timeout', async () => {
    const slowFailure: ReadinessCheck = {
      name: 'slow',
      check: (timeoutMs) =>
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('client timeout'));
          }, timeoutMs);
        }),
    };
    const report = await runReadinessChecks(
      [slowFailure],
      100,
      () => undefined,
    );
    expect(report.checks['slow']).toMatchObject({
      status: 'down',
      reason: 'timeout',
    });
  });

  it('never exposes error details in the report', async () => {
    const leaky: ReadinessCheck = {
      name: 'leaky',
      check: () => Promise.reject(new Error('postgresql://u:SECRET@h/db')),
    };
    const report = await runReadinessChecks([leaky], 1_000, () => undefined);
    expect(JSON.stringify(report)).not.toContain('SECRET');
  });
});

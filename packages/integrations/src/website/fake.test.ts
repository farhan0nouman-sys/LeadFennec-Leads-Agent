import { describe, expect, it } from 'vitest';
import { createWebsiteFetcher } from '../registry.js';
import { WebsiteFetchError } from './errors.js';
import { FakeWebsiteFetcher } from './fake.js';
import { SafeWebsiteFetcher } from './fetcher.js';
import { HostConcurrencyLimiter } from './limiter.js';

// Task 09A, docs/decisions.md D-09A-03 and D-09A-07: the fake of development and tests, the
// environment's fetcher and the per-host limiter.

const SCOPE = 'tenant-a';

async function failure(promise: Promise<unknown>): Promise<WebsiteFetchError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WebsiteFetchError);
    return error as WebsiteFetchError;
  }
  throw new Error('expected the fetch to fail');
}

describe('FakeWebsiteFetcher', () => {
  it('returns the same synthetic page for a host every time', async () => {
    const fake = new FakeWebsiteFetcher();
    const first = await fake.fetchPage({
      url: 'https://www.acme-widgets.example/about',
      cacheScope: SCOPE,
    });
    const second = await fake.fetchPage({
      url: 'https://www.acme-widgets.example/about',
      cacheScope: SCOPE,
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      source: 'FAKE',
      finalUrl: 'https://www.acme-widgets.example/about',
      status: 200,
      title: 'Acme Widgets (synthetic)',
      text: 'Acme Widgets\nThis synthetic page stands for www.acme-widgets.example/about. It describes no real business, person or address.',
      retrievedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(first.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.links.map((link) => link.url)).toEqual([
      'https://www.acme-widgets.example/',
      'https://www.acme-widgets.example/about',
      'https://www.acme-widgets.example/contact',
    ]);
    expect(fake.requests).toEqual([
      'https://www.acme-widgets.example/about',
      'https://www.acme-widgets.example/about',
    ]);
  });

  it('refuses unsafe URLs exactly like the live fetcher', async () => {
    const fake = new FakeWebsiteFetcher();
    for (const [url, code] of [
      ['http://127.0.0.1/', 'blocked_address'],
      ['http://169.254.169.254/latest/meta-data/', 'blocked_address'],
      ['http://localhost/', 'blocked_host'],
      ['http://metadata.google.internal/', 'blocked_host'],
      ['file:///etc/passwd', 'blocked_scheme'],
      ['http://acme.example:8080/', 'blocked_port'],
    ] as const) {
      expect(
        (await failure(fake.fetchPage({ url, cacheScope: SCOPE }))).code,
      ).toBe(code);
    }
    expect(fake.requests).toEqual([]);
  });

  it('plays scripted pages, redirects, failures and the access policy', async () => {
    const fake = new FakeWebsiteFetcher({
      now: () => new Date('2026-11-06T00:00:00.000Z'),
      pages: {
        'https://acme.example/old': { status: 301, redirectTo: '/new' },
        'https://acme.example/new': { body: '<main><p>moved here</p></main>' },
        'https://acme.example/to-internal': {
          status: 302,
          redirectTo: 'http://10.0.0.1/',
        },
        'https://acme.example/pdf': {
          contentType: 'application/pdf',
          body: '%PDF',
        },
        'https://acme.example/gone': { status: 410 },
      },
      failures: { 'https://acme.example/slow': 'timeout' },
      policy: { blockedHosts: ['blocked.example'] },
    });
    const moved = await fake.fetchPage({
      url: 'https://acme.example/old',
      cacheScope: SCOPE,
    });
    expect(moved).toMatchObject({
      text: 'moved here',
      finalUrl: 'https://acme.example/new',
      redirects: [{ url: 'https://acme.example/old', status: 301 }],
      retrievedAt: new Date('2026-11-06T00:00:00.000Z'),
    });
    const cases = [
      ['https://acme.example/to-internal', 'blocked_address'],
      ['https://acme.example/pdf', 'unsupported_content_type'],
      ['https://acme.example/gone', 'http_error'],
      ['https://acme.example/slow', 'timeout'],
      ['https://shop.blocked.example/', 'access_restricted'],
    ] as const;
    for (const [url, code] of cases) {
      expect(
        (await failure(fake.fetchPage({ url, cacheScope: SCOPE }))).code,
      ).toBe(code);
    }
  });

  it('needs a cache scope and honours cancellation', async () => {
    const fake = new FakeWebsiteFetcher();
    await expect(
      fake.fetchPage({ url: 'https://acme.example/', cacheScope: '' }),
    ).rejects.toThrow(TypeError);
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await failure(
          fake.fetchPage({
            url: 'https://acme.example/',
            cacheScope: SCOPE,
            signal: controller.signal,
          }),
        )
      ).code,
    ).toBe('canceled');
  });
});

describe('createWebsiteFetcher', () => {
  it('gives development and test the fake, which never connects', () => {
    expect(createWebsiteFetcher('test')).toBeInstanceOf(FakeWebsiteFetcher);
    expect(createWebsiteFetcher('development').source).toBe('FAKE');
  });

  it('gives staging and production the safe fetcher with the configured restrictions', () => {
    const fetcher = createWebsiteFetcher('production', {
      blockedHosts: ['WWW.Blocked.com'],
      allowedHosts: [],
    });
    expect(fetcher).toBeInstanceOf(SafeWebsiteFetcher);
    expect((fetcher as SafeWebsiteFetcher).policy).toMatchObject({
      blockedHosts: ['blocked.com'],
      allowedHosts: null,
      respectRobots: true,
      maxRedirects: 5,
      timeoutMs: 15_000,
      maxBytes: 2 * 1024 * 1024,
      maxPerHost: 2,
      allowedPorts: [80, 443],
    });
    expect(
      createWebsiteFetcher('staging', { allowedHosts: ['acme.com'] }).source,
    ).toBe('LIVE');
  });

  it('refuses invalid restrictions before any fetch', () => {
    expect(() =>
      createWebsiteFetcher('production', { blockedHosts: ['http://'] }),
    ).toThrow();
    expect(() =>
      createWebsiteFetcher('test', { allowedHosts: ['not a domain'] }),
    ).toThrow();
  });
});

describe('HostConcurrencyLimiter', () => {
  it('hands slots over in order and releases each slot once', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    const signal = new AbortController().signal;
    const release = await limiter.acquire('acme.com', signal);
    const order: string[] = [];
    const second = limiter.acquire('acme.com', signal).then((next) => {
      order.push('second');
      return next;
    });
    const third = limiter.acquire('acme.com', signal).then((next) => {
      order.push('third');
      return next;
    });
    expect(limiter.queued('acme.com')).toBe(2);
    release();
    release();
    const releaseSecond = await second;
    expect(limiter.inFlight('acme.com')).toBe(1);
    expect(limiter.queued('acme.com')).toBe(1);
    releaseSecond();
    (await third)();
    expect(order).toEqual(['second', 'third']);
    expect(limiter.inFlight('acme.com')).toBe(0);
  });

  it('drops a waiter whose signal aborts', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    const release = await limiter.acquire(
      'acme.com',
      new AbortController().signal,
    );
    const controller = new AbortController();
    const waiting = limiter.acquire('acme.com', controller.signal);
    controller.abort(new Error('synthetic abort'));
    await expect(waiting).rejects.toThrow('synthetic abort');
    expect(limiter.queued('acme.com')).toBe(0);
    release();
    expect(limiter.inFlight('acme.com')).toBe(0);
    expect(() => new HostConcurrencyLimiter(0)).toThrow(RangeError);
  });
});

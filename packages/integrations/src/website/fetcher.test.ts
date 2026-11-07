import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  connect,
  createServer as createTcpServer,
  type AddressInfo,
  type Server as TcpServer,
  type Socket,
} from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { WebsiteFetchError } from './errors.js';
import {
  networkError,
  SafeWebsiteFetcher,
  type HostResolver,
} from './fetcher.js';
import { HostConcurrencyLimiter } from './limiter.js';
import type { WebsiteFetchPolicyInput } from './policy.js';
import { NodeHttpTransport, type DialTarget } from './transport.js';

// Task 09A, docs/decisions.md D-09A-01 to D-09A-06. Every request goes to a local fixture
// server: DNS is a fake (names "resolve" to public addresses), and the dialer connects those
// addresses to 127.0.0.1. Nothing leaves the machine (the network guard would refuse it).

const NOW = new Date('2026-11-06T12:00:00.000Z');
const PUBLIC = '93.184.215.14';
const PUBLIC_V6 = '2606:4700:4700::1111';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let port: number;
const routes = new Map<string, Handler>();
const seen: { host: string; path: string; headers: IncomingHttpHeaders }[] = [];

/** Routes by Host header and path (query ignored). */
function route(host: string, path: string, handler: Handler): void {
  routes.set(`${host}${path}`, handler);
}

function html(body: string, headers: Record<string, string> = {}): Handler {
  return (_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      ...headers,
    });
    response.end(body);
  };
}

function redirect(location: string, status = 302): Handler {
  return (_request, response) => {
    response.writeHead(status, { location });
    response.end();
  };
}

const robotsCount = (host: string) =>
  seen.filter((entry) => entry.host === host && entry.path === '/robots.txt')
    .length;

beforeAll(async () => {
  server = createServer((request, response) => {
    const host = request.headers.host ?? '';
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    seen.push({ host, path, headers: request.headers });
    const handler = routes.get(`${host}${path}`);
    if (handler === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    handler(request, response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  routes.clear();
  seen.length = 0;
});

type Answers =
  | Readonly<Record<string, readonly string[]>>
  | ((host: string, call: number) => readonly string[] | undefined);

interface HarnessOptions {
  readonly policy?: WebsiteFetchPolicyInput;
  readonly dns?: Answers;
  readonly resolver?: HostResolver;
  readonly dialPort?: number;
  readonly limiter?: HostConcurrencyLimiter;
}

const DEFAULT_DNS: Readonly<Record<string, readonly string[]>> = {
  'acme-widgets.com': [PUBLIC],
  'www.acme-widgets.com': [PUBLIC],
  'other.com': [PUBLIC],
  'busy.com': [PUBLIC],
  'cdn.acme-widgets.com': [PUBLIC_V6],
};

function harness(options: HarnessOptions = {}) {
  const dials: DialTarget[] = [];
  const lookups: string[] = [];
  const answers = options.dns ?? DEFAULT_DNS;
  const resolver: HostResolver = options.resolver ?? {
    lookup(host) {
      lookups.push(host);
      const call = lookups.filter((name) => name === host).length;
      const list =
        typeof answers === 'function' ? answers(host, call) : answers[host];
      if (list === undefined) {
        return Promise.reject(
          Object.assign(new Error('synthetic: no such host'), {
            code: 'ENOTFOUND',
          }),
        );
      }
      return Promise.resolve(
        list.map((address) => ({
          address,
          family: address.includes(':') ? 6 : 4,
        })),
      );
    },
  };
  const transport = new NodeHttpTransport({
    dial: (target) => {
      dials.push(target);
      return connect({ host: '127.0.0.1', port: options.dialPort ?? port });
    },
  });
  const fetcher = new SafeWebsiteFetcher({
    policy: { respectRobots: false, ...options.policy },
    resolver,
    transport,
    now: () => NOW,
    ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
  });
  const fetchPage = (
    url: string,
    cacheScope = 'tenant-a',
    signal?: AbortSignal,
  ) =>
    fetcher.fetchPage({
      url,
      cacheScope,
      ...(signal === undefined ? {} : { signal }),
    });
  return { fetcher, fetchPage, dials, lookups };
}

async function failure(promise: Promise<unknown>): Promise<WebsiteFetchError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WebsiteFetchError);
    return error as WebsiteFetchError;
  }
  throw new Error('expected the fetch to fail');
}

const PAGE = `<!doctype html><html lang="en"><head><title>Acme Widgets</title>
<script>window.track = 1</script></head>
<body><nav><a href="/about">About</a></nav>
<main><h1>Widgets</h1><p>Synthetic widgets since 2001.</p></main>
<footer>Footer</footer></body></html>`;

describe('SafeWebsiteFetcher: a page', () => {
  it('fetches a page through the checked address and keeps URL, time and hash', async () => {
    route('acme-widgets.com', '/', html(PAGE));
    const { fetchPage, dials, lookups } = harness({
      policy: { respectRobots: true },
    });
    const page = await fetchPage('http://acme-widgets.com/#top');
    expect(page).toMatchObject({
      source: 'LIVE',
      requestedUrl: 'http://acme-widgets.com/',
      finalUrl: 'http://acme-widgets.com/',
      redirects: [],
      status: 200,
      contentType: 'text/html',
      charset: 'utf-8',
      retrievedAt: NOW,
      title: 'Acme Widgets',
      language: 'en',
      text: 'Widgets\nSynthetic widgets since 2001.',
      textTruncated: false,
      links: [
        { url: 'http://acme-widgets.com/about', text: 'About', sameSite: true },
      ],
    });
    expect(page.byteLength).toBe(Buffer.byteLength(PAGE));
    expect(page.contentSha256).toBe(
      createHash('sha256').update(PAGE).digest('hex'),
    );
    expect(page.textSha256).toBe(
      createHash('sha256').update(page.text).digest('hex'),
    );
    // robots.txt first (404: no rules), then the page; one lookup per hop, never re-resolved.
    expect(seen.map((entry) => entry.path)).toEqual(['/robots.txt', '/']);
    expect(lookups).toEqual(['acme-widgets.com', 'acme-widgets.com']);
    expect(dials.map((dial) => dial.address)).toEqual([PUBLIC, PUBLIC]);
    expect(dials[0]).toMatchObject({
      hostname: 'acme-widgets.com',
      port: 80,
      tls: false,
    });
    const headers = seen[1]?.headers ?? {};
    expect(headers.host).toBe('acme-widgets.com');
    expect(headers['user-agent']).toBe('LeadFennecBot/0.1');
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });

  it('decodes gzip, deflate and br bodies, plain text and other charsets', async () => {
    const body = '<main><p>compressed widgets</p></main>';
    routes.set('acme-widgets.com/gzip', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
      });
      response.end(gzipSync(body));
    });
    routes.set('acme-widgets.com/deflate', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': 'deflate',
      });
      response.end(deflateSync(body));
    });
    routes.set('acme-widgets.com/br', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': 'br',
      });
      response.end(brotliCompressSync(body));
    });
    routes.set('acme-widgets.com/text', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/plain; charset=windows-1252',
      });
      response.end(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    });
    const { fetchPage } = harness();
    for (const path of ['/gzip', '/deflate', '/br']) {
      const page = await fetchPage(`http://acme-widgets.com${path}`);
      expect(page.text).toBe('compressed widgets');
      expect(page.contentSha256).toBe(
        createHash('sha256').update(body).digest('hex'),
      );
    }
    const text = await fetchPage('http://acme-widgets.com/text');
    expect(text).toMatchObject({
      contentType: 'text/plain',
      charset: 'windows-1252',
      text: `caf${String.fromCharCode(0xe9)}`,
      links: [],
    });
  });

  it('connects to an IPv6 answer and to public IP literals without DNS', async () => {
    route('cdn.acme-widgets.com', '/', html('<p>v6</p>'));
    route(PUBLIC, '/', html('<p>literal</p>'));
    const { fetchPage, dials, lookups } = harness();
    expect((await fetchPage('http://cdn.acme-widgets.com/')).text).toBe('v6');
    expect(dials[0]).toMatchObject({ address: PUBLIC_V6, family: 6 });
    expect((await fetchPage(`http://${PUBLIC}/`)).text).toBe('literal');
    expect(lookups).toEqual(['cdn.acme-widgets.com']);
    expect(dials[1]).toMatchObject({ address: PUBLIC, family: 4 });
  });

  it('marks long text as truncated', async () => {
    route(
      'acme-widgets.com',
      '/long',
      html(`<main><p>${'word '.repeat(2000)}</p></main>`),
    );
    const { fetchPage } = harness({ policy: { maxTextChars: 500 } });
    const page = await fetchPage('http://acme-widgets.com/long');
    expect(page.textTruncated).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(500);
  });
});

describe('SafeWebsiteFetcher: unsafe destinations', () => {
  it.each([
    ['http://127.0.0.1/', 'blocked_address'],
    ['http://localhost:80/', 'blocked_host'],
    ['http://0x7f000001/', 'blocked_address'],
    ['http://2130706433/', 'blocked_address'],
    ['http://[::1]/', 'blocked_address'],
    ['http://[::ffff:127.0.0.1]/', 'blocked_address'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked_address'],
    ['http://[fd00:ec2::254]/', 'blocked_address'],
    ['http://metadata.google.internal/', 'blocked_host'],
    ['http://10.0.0.8/', 'blocked_address'],
    ['file:///etc/passwd', 'blocked_scheme'],
    ['http://acme-widgets.com:6379/', 'blocked_port'],
    ['http://admin:secret@acme-widgets.com/', 'credentials_in_url'],
  ])('refuses %s without a lookup or a connection', async (url, code) => {
    const { fetchPage, dials, lookups } = harness();
    const error = await failure(fetchPage(url));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(false);
    expect(lookups).toEqual([]);
    expect(dials).toEqual([]);
    expect(seen).toEqual([]);
  });

  it.each([
    [['127.0.0.1'], 'loopback'],
    [['10.1.2.3'], 'private'],
    [['169.254.169.254'], 'metadata'],
    [['::1'], 'loopback'],
    [['::ffff:127.0.0.1'], 'loopback'],
    [['fd00:ec2::254'], 'metadata'],
    [['fe80::1'], 'link_local'],
    [[PUBLIC, '192.168.1.10'], 'private'],
    [[PUBLIC_V6, '::ffff:10.0.0.1'], 'private'],
  ])(
    'refuses a name whose DNS answer includes %j (%s)',
    async (answer, reason) => {
      const { fetchPage, dials } = harness({ dns: { 'evil-dns.com': answer } });
      const error = await failure(fetchPage('http://evil-dns.com/'));
      expect(error).toMatchObject({ code: 'blocked_address', reason });
      expect(dials).toEqual([]);
    },
  );

  it('reports missing names and DNS failures, retryable only when they may pass', async () => {
    const missing = await failure(
      harness().fetchPage('http://no-such-host.com/'),
    );
    expect(missing).toMatchObject({ code: 'host_not_found', retryable: false });
    const flaky = harness({
      resolver: {
        lookup: () =>
          Promise.reject(
            Object.assign(new Error('synthetic'), { code: 'EAI_AGAIN' }),
          ),
      },
    });
    expect(
      await failure(flaky.fetchPage('http://acme-widgets.com/')),
    ).toMatchObject({
      code: 'dns_failed',
      retryable: true,
    });
    const empty = harness({ dns: { 'empty.com': [] } });
    expect((await failure(empty.fetchPage('http://empty.com/'))).code).toBe(
      'host_not_found',
    );
  });
});

describe('SafeWebsiteFetcher: DNS changes', () => {
  it('checks the answer of every fetch, so a name that turns internal is refused', async () => {
    route('rebind.com', '/', html('<p>public at first</p>'));
    const { fetchPage, dials } = harness({
      dns: (host, call) =>
        host === 'rebind.com'
          ? call === 1
            ? [PUBLIC]
            : ['127.0.0.1']
          : undefined,
    });
    expect((await fetchPage('http://rebind.com/')).text).toBe(
      'public at first',
    );
    const error = await failure(fetchPage('http://rebind.com/'));
    expect(error).toMatchObject({
      code: 'blocked_address',
      reason: 'loopback',
    });
    expect(dials).toHaveLength(1);
  });

  it('checks again at a redirect to the same host, and connects only to checked addresses', async () => {
    route('rebind.com', '/start', redirect('/next'));
    route('rebind.com', '/next', html('<p>never served</p>'));
    const { fetchPage, dials, lookups } = harness({
      dns: (host, call) =>
        host === 'rebind.com'
          ? call === 1
            ? [PUBLIC]
            : ['169.254.169.254']
          : undefined,
    });
    const error = await failure(fetchPage('http://rebind.com/start'));
    expect(error).toMatchObject({
      code: 'blocked_address',
      reason: 'metadata',
    });
    expect(lookups).toEqual(['rebind.com', 'rebind.com']);
    expect(dials.map((dial) => dial.address)).toEqual([PUBLIC]);
    expect(seen.map((entry) => entry.path)).toEqual(['/start']);
  });
});

describe('SafeWebsiteFetcher: redirects', () => {
  it.each([
    ['http://127.0.0.1/admin', 'blocked_address'],
    ['http://[::1]:80/', 'blocked_address'],
    ['http://169.254.169.254/latest/meta-data/iam/', 'blocked_address'],
    ['http://0x7f000001/', 'blocked_address'],
    ['http://017700000001/', 'blocked_address'],
    ['http://[::ffff:a9fe:a9fe]/', 'blocked_address'],
    ['http://localhost/', 'blocked_host'],
    ['http://metadata.google.internal/computeMetadata/v1/', 'blocked_host'],
    ['http://internal-name.com/', 'blocked_address'],
    ['file:///etc/passwd', 'blocked_scheme'],
    ['gopher://acme-widgets.com/', 'blocked_scheme'],
    ['http://acme-widgets.com:22/', 'blocked_port'],
    ['http://user:pw@acme-widgets.com/', 'credentials_in_url'],
  ])(
    'refuses a redirect to %s (%s) without connecting to it',
    async (location, code) => {
      route('acme-widgets.com', '/go', redirect(location));
      const { fetchPage, dials } = harness({
        dns: { ...DEFAULT_DNS, 'internal-name.com': ['10.0.0.5'] },
      });
      const error = await failure(fetchPage('http://acme-widgets.com/go'));
      expect(error.code).toBe(code);
      expect(dials).toHaveLength(1);
      expect(seen.map((entry) => entry.path)).toEqual(['/go']);
    },
  );

  it('follows checked redirects, relative and to other hosts, and records them', async () => {
    route('acme-widgets.com', '/old', redirect('/new', 301));
    route(
      'acme-widgets.com',
      '/new',
      redirect('http://www.acme-widgets.com/final', 308),
    );
    route('www.acme-widgets.com', '/final', html('<p>arrived</p>'));
    const { fetchPage, lookups } = harness();
    const page = await fetchPage('http://acme-widgets.com/old');
    expect(page.text).toBe('arrived');
    expect(page.finalUrl).toBe('http://www.acme-widgets.com/final');
    expect(page.redirects).toEqual([
      { url: 'http://acme-widgets.com/old', status: 301 },
      { url: 'http://acme-widgets.com/new', status: 308 },
    ]);
    expect(lookups).toEqual([
      'acme-widgets.com',
      'acme-widgets.com',
      'www.acme-widgets.com',
    ]);
  });

  it('limits redirects, and refuses loops and missing locations', async () => {
    for (let hop = 0; hop < 4; hop += 1) {
      route(
        'acme-widgets.com',
        `/hop${String(hop)}`,
        redirect(`/hop${String(hop + 1)}`),
      );
    }
    route('acme-widgets.com', '/hop4', html('<p>too far</p>'));
    route('acme-widgets.com', '/loop-a', redirect('/loop-b'));
    route('acme-widgets.com', '/loop-b', redirect('/loop-a'));
    route('acme-widgets.com', '/nowhere', (_request, response) => {
      response.writeHead(302);
      response.end();
    });
    const { fetchPage } = harness({ policy: { maxRedirects: 3 } });
    expect(
      (await failure(fetchPage('http://acme-widgets.com/hop0'))).code,
    ).toBe('too_many_redirects');
    expect(
      (await failure(fetchPage('http://acme-widgets.com/loop-a'))).code,
    ).toBe('redirect_loop');
    expect(
      (await failure(fetchPage('http://acme-widgets.com/nowhere'))).code,
    ).toBe('bad_redirect');
    const zero = harness({ policy: { maxRedirects: 0 } });
    expect(
      (await failure(zero.fetchPage('http://acme-widgets.com/hop3'))).code,
    ).toBe('too_many_redirects');
  });
});

describe('SafeWebsiteFetcher: sizes and types', () => {
  it('refuses a declared length over the limit before reading the body', async () => {
    route('acme-widgets.com', '/huge', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-length': String(50 * 1024 * 1024),
      });
      response.write('<p>start');
      // Never finishes: the fetcher must not wait for 50 MB.
    });
    const { fetchPage } = harness({ policy: { maxBytes: 64 * 1024 } });
    const started = performance.now();
    expect(
      (await failure(fetchPage('http://acme-widgets.com/huge'))).code,
    ).toBe('too_large');
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('stops a streamed body at the limit', async () => {
    route('acme-widgets.com', '/stream', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      const chunk = 'x'.repeat(16 * 1024);
      const timer = setInterval(() => {
        response.write(chunk);
      }, 1);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    const { fetchPage } = harness({ policy: { maxBytes: 64 * 1024 } });
    expect(
      (await failure(fetchPage('http://acme-widgets.com/stream'))).code,
    ).toBe('too_large');
  });

  it('stops a decompression bomb at the limit', async () => {
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    route('acme-widgets.com', '/bomb', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
      });
      response.end(bomb);
    });
    const { fetchPage } = harness({ policy: { maxBytes: 64 * 1024 } });
    expect(
      (await failure(fetchPage('http://acme-widgets.com/bomb'))).code,
    ).toBe('too_large');
  });

  it('refuses oversized headers', async () => {
    route(
      'acme-widgets.com',
      '/headers',
      html('<p>x</p>', { 'x-filler': 'a'.repeat(20_000) }),
    );
    const error = await failure(
      harness().fetchPage('http://acme-widgets.com/headers'),
    );
    expect(error).toMatchObject({ code: 'too_large', reason: 'headers' });
  });

  it.each([
    ['application/pdf'],
    ['image/png'],
    ['application/json'],
    ['application/octet-stream'],
    ['text/csv'],
    ['not a type'],
  ])('refuses the content type %s', async (type) => {
    route('acme-widgets.com', '/file', (_request, response) => {
      response.writeHead(200, { 'content-type': type });
      response.end('%PDF-1.7 synthetic');
    });
    const error = await failure(
      harness().fetchPage('http://acme-widgets.com/file'),
    );
    expect(error.code).toBe('unsupported_content_type');
    expect(error.retryable).toBe(false);
  });

  it('refuses a body without a content type, and unknown or stacked encodings', async () => {
    route('acme-widgets.com', '/untyped', (_request, response) => {
      response.writeHead(200);
      response.end('<p>no type</p>');
    });
    for (const coding of ['compress', 'gzip, br', 'zstd']) {
      route(
        'acme-widgets.com',
        `/${coding.replace(/\W+/g, '-')}`,
        (_request, response) => {
          response.writeHead(200, {
            'content-type': 'text/html',
            'content-encoding': coding,
          });
          response.end('<p>x</p>');
        },
      );
    }
    const { fetchPage } = harness();
    expect(
      (await failure(fetchPage('http://acme-widgets.com/untyped'))).code,
    ).toBe('unsupported_content_type');
    for (const path of ['/compress', '/gzip-br', '/zstd']) {
      expect(
        (await failure(fetchPage(`http://acme-widgets.com${path}`))).code,
      ).toBe('unsupported_encoding');
    }
  });

  it('refuses corrupt compression and markup too complex to parse', async () => {
    route('acme-widgets.com', '/corrupt', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
      });
      response.end(Buffer.from('this is not gzip'));
    });
    route('acme-widgets.com', '/deep', html(`${'<div>'.repeat(5000)}x`));
    const { fetchPage } = harness();
    expect(
      await failure(fetchPage('http://acme-widgets.com/corrupt')),
    ).toMatchObject({
      code: 'bad_response',
      reason: 'encoding',
    });
    expect(
      (await failure(fetchPage('http://acme-widgets.com/deep'))).code,
    ).toBe('too_complex');
  });
});

describe('SafeWebsiteFetcher: time', () => {
  it('times out a site that never answers', async () => {
    route('acme-widgets.com', '/hang', () => {
      // Never answers.
    });
    const { fetchPage } = harness({ policy: { timeoutMs: 200 } });
    const started = performance.now();
    const error = await failure(fetchPage('http://acme-widgets.com/hang'));
    expect(error).toMatchObject({ code: 'timeout', retryable: true });
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('times out a body that drips forever', async () => {
    route('acme-widgets.com', '/drip', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      const timer = setInterval(() => {
        response.write('.');
      }, 20);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    const { fetchPage } = harness({ policy: { timeoutMs: 300 } });
    expect(
      (await failure(fetchPage('http://acme-widgets.com/drip'))).code,
    ).toBe('timeout');
  });

  it('times out a DNS lookup that never returns', async () => {
    const { fetchPage, dials } = harness({
      policy: { timeoutMs: 200 },
      resolver: { lookup: () => new Promise(() => undefined) },
    });
    expect((await failure(fetchPage('http://acme-widgets.com/'))).code).toBe(
      'timeout',
    );
    expect(dials).toEqual([]);
  });

  it('stops when the caller cancels', async () => {
    route('acme-widgets.com', '/hang', () => {
      // Never answers.
    });
    const { fetchPage } = harness();
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 50);
    const error = await failure(
      fetchPage('http://acme-widgets.com/hang', 'tenant-a', controller.signal),
    );
    expect(error).toMatchObject({ code: 'canceled', retryable: false });
  });
});

describe('SafeWebsiteFetcher: errors from the site', () => {
  it('reports HTTP errors with their status, retryable only for 408, 429 and 5xx', async () => {
    for (const status of [403, 404, 410, 429, 500, 503]) {
      route('acme-widgets.com', `/s${String(status)}`, (_request, response) => {
        response.writeHead(status, { 'content-type': 'text/html' });
        response.end('<p>error page with site text</p>');
      });
    }
    const { fetchPage } = harness();
    for (const [status, retryable] of [
      [403, false],
      [404, false],
      [410, false],
      [429, true],
      [500, true],
      [503, true],
    ] as const) {
      const error = await failure(
        fetchPage(`http://acme-widgets.com/s${String(status)}`),
      );
      expect(error).toMatchObject({ code: 'http_error', status, retryable });
      expect(error.message).not.toContain('site text');
    }
  });

  it('reports a refused connection as retryable', async () => {
    const closed = createTcpServer();
    await new Promise<void>((resolve) => {
      closed.listen(0, '127.0.0.1', resolve);
    });
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });
    const { fetchPage } = harness({ dialPort: closedPort });
    expect(await failure(fetchPage('http://acme-widgets.com/'))).toMatchObject({
      code: 'connection_failed',
      retryable: true,
    });
  });

  it('reports malformed HTTP as a bad response', async () => {
    const sockets = new Set<Socket>();
    const raw: TcpServer = createTcpServer((socket) => {
      sockets.add(socket);
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: abc\r\n\r\nbody');
    });
    await new Promise<void>((resolve) => {
      raw.listen(0, '127.0.0.1', resolve);
    });
    try {
      const { fetchPage } = harness({
        dialPort: (raw.address() as AddressInfo).port,
      });
      expect(
        await failure(fetchPage('http://acme-widgets.com/')),
      ).toMatchObject({
        code: 'bad_response',
        reason: 'http',
      });
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        raw.close(() => {
          resolve();
        });
      });
    }
  });
});

describe('SafeWebsiteFetcher: per-host concurrency', () => {
  it('runs at most maxPerHost requests to one host, and other hosts meanwhile', async () => {
    let active = 0;
    let peak = 0;
    const waiting: (() => void)[] = [];
    route('busy.com', '/slow', (request, response) => {
      active += 1;
      peak = Math.max(peak, active);
      waiting.push(() => {
        active -= 1;
        html('<p>slow</p>')(request, response);
      });
    });
    route('other.com', '/fast', html('<p>fast</p>'));
    const limiter = new HostConcurrencyLimiter(2);
    const { fetchPage } = harness({ limiter, policy: { timeoutMs: 10_000 } });
    const slow = Array.from({ length: 5 }, (_, index) =>
      fetchPage(`http://busy.com/slow?n=${String(index)}`),
    );
    await vi.waitFor(() => {
      expect(waiting).toHaveLength(2);
    });
    expect(limiter.inFlight('busy.com')).toBe(2);
    expect(limiter.queued('busy.com')).toBe(3);
    // Another host is not held up by the busy one.
    expect((await fetchPage('http://other.com/fast')).text).toBe('fast');
    for (let released = 0; released < 5; released += 1) {
      await vi.waitFor(() => {
        expect(waiting.length).toBeGreaterThan(0);
      });
      expect(active).toBeLessThanOrEqual(2);
      waiting.shift()?.();
    }
    const pages = await Promise.all(slow);
    expect(pages.map((page) => page.text)).toEqual(Array(5).fill('slow'));
    expect(peak).toBe(2);
    expect(limiter.inFlight('busy.com')).toBe(0);
    expect(limiter.queued('busy.com')).toBe(0);
  });

  it('gives up waiting for a slot when the time budget runs out', async () => {
    route('busy.com', '/hold', () => {
      // Holds its slot until the client gives up.
    });
    const limiter = new HostConcurrencyLimiter(1);
    const { fetchPage } = harness({ limiter, policy: { timeoutMs: 300 } });
    // Both outcomes are awaited together, so neither rejection goes unhandled.
    const [first, second] = await Promise.all([
      failure(fetchPage('http://busy.com/hold')),
      failure(fetchPage('http://busy.com/hold?again')),
    ]);
    expect(first.code).toBe('timeout');
    expect(second.code).toBe('timeout');
    expect(limiter.inFlight('busy.com')).toBe(0);
    expect(limiter.queued('busy.com')).toBe(0);
  });
});

describe('SafeWebsiteFetcher: access restrictions', () => {
  it('refuses blocked hosts and their subdomains, also through a redirect', async () => {
    route(
      'acme-widgets.com',
      '/to-blocked',
      redirect('http://shop.blocked.com/'),
    );
    const { fetchPage, dials } = harness({
      policy: { blockedHosts: ['blocked.com'] },
      dns: {
        ...DEFAULT_DNS,
        'blocked.com': [PUBLIC],
        'shop.blocked.com': [PUBLIC],
      },
    });
    for (const url of [
      'http://blocked.com/',
      'http://www.blocked.com/',
      'http://shop.blocked.com/x',
    ]) {
      expect(await failure(fetchPage(url))).toMatchObject({
        code: 'access_restricted',
        reason: 'blocked_host',
      });
    }
    expect(dials).toEqual([]);
    expect(
      (await failure(fetchPage('http://acme-widgets.com/to-blocked'))).code,
    ).toBe('access_restricted');
    expect(dials).toHaveLength(1);
  });

  it('fetches only allowed hosts when an allow list is set', async () => {
    route('acme-widgets.com', '/', html('<p>allowed</p>'));
    const { fetchPage } = harness({
      policy: { allowedHosts: ['acme-widgets.com'] },
    });
    expect((await fetchPage('http://acme-widgets.com/')).text).toBe('allowed');
    expect(await failure(fetchPage('http://other.com/'))).toMatchObject({
      code: 'access_restricted',
      reason: 'not_allowed',
    });
    expect((await failure(fetchPage(`http://${PUBLIC}/`))).code).toBe(
      'access_restricted',
    );
  });

  it('refuses invalid restrictions when the fetcher is made', () => {
    expect(
      () =>
        new SafeWebsiteFetcher({ policy: { blockedHosts: ['not a host'] } }),
    ).toThrow();
    expect(
      () =>
        new SafeWebsiteFetcher({ policy: { maxBytes: 1024 * 1024 * 1024 } }),
    ).toThrow();
    expect(
      () => new SafeWebsiteFetcher({ policy: { userAgent: 'NoToken/1.0' } }),
    ).toThrow();
  });
});

describe('SafeWebsiteFetcher: robots.txt', () => {
  const robots =
    (body: string, status = 200): Handler =>
    (_request, response) => {
      response.writeHead(status, { 'content-type': 'text/plain' });
      response.end(body);
    };

  it('honours the rules for our token and caches them per workspace', async () => {
    route(
      'acme-widgets.com',
      '/robots.txt',
      robots(
        'User-agent: *\nDisallow: /\n\nUser-agent: LeadFennecBot\nDisallow: /private\n',
      ),
    );
    route('acme-widgets.com', '/public', html('<p>public</p>'));
    route('acme-widgets.com', '/private/report', html('<p>private</p>'));
    const { fetchPage } = harness({ policy: { respectRobots: true } });
    expect((await fetchPage('http://acme-widgets.com/public')).text).toBe(
      'public',
    );
    expect(
      await failure(fetchPage('http://acme-widgets.com/private/report')),
    ).toMatchObject({
      code: 'robots_disallowed',
      retryable: false,
    });
    expect(robotsCount('acme-widgets.com')).toBe(1);
    expect(seen.some((entry) => entry.path === '/private/report')).toBe(false);
    // Another workspace reads its own copy.
    await fetchPage('http://acme-widgets.com/public', 'tenant-b');
    expect(robotsCount('acme-widgets.com')).toBe(2);
  });

  it('treats a missing robots.txt as no rules, and an unreachable one as "try later"', async () => {
    route('acme-widgets.com', '/', html('<p>open</p>'));
    route('other.com', '/robots.txt', robots('down', 503));
    route('other.com', '/', html('<p>never fetched</p>'));
    const { fetchPage } = harness({ policy: { respectRobots: true } });
    expect((await fetchPage('http://acme-widgets.com/')).text).toBe('open');
    expect(await failure(fetchPage('http://other.com/'))).toMatchObject({
      code: 'robots_unreachable',
      retryable: true,
    });
    expect(
      seen.some((entry) => entry.host === 'other.com' && entry.path === '/'),
    ).toBe(false);
  });

  it('follows a robots.txt redirect to another host, checked like any hop', async () => {
    route(
      'acme-widgets.com',
      '/robots.txt',
      redirect('http://cdn.acme-widgets.com/robots.txt'),
    );
    route(
      'cdn.acme-widgets.com',
      '/robots.txt',
      robots('User-agent: *\nDisallow: /\n'),
    );
    route('other.com', '/robots.txt', redirect('http://127.0.0.1/robots.txt'));
    const { fetchPage, dials } = harness({ policy: { respectRobots: true } });
    expect(
      (await failure(fetchPage('http://acme-widgets.com/page'))).code,
    ).toBe('robots_disallowed');
    expect((await failure(fetchPage('http://other.com/page'))).code).toBe(
      'robots_unreachable',
    );
    expect(dials.map((dial) => dial.address)).not.toContain('127.0.0.1');
  });

  it('fetches robots.txt itself without checking it', async () => {
    route(
      'acme-widgets.com',
      '/robots.txt',
      robots('User-agent: *\nDisallow: /\n'),
    );
    const { fetchPage } = harness({ policy: { respectRobots: true } });
    expect((await fetchPage('http://acme-widgets.com/robots.txt')).text).toBe(
      'User-agent: *\nDisallow: /',
    );
    expect(robotsCount('acme-widgets.com')).toBe(1);
  });
});

describe('NodeHttpTransport with the production dialer', () => {
  it('connects to the given address, never resolving the URL host, and sends its Host header', async () => {
    route(`unresolvable.invalid:${String(port)}`, '/', html('<p>direct</p>'));
    const transport = new NodeHttpTransport();
    const response = await transport.request({
      url: new URL(`http://unresolvable.invalid:${String(port)}/`),
      address: '127.0.0.1',
      family: 4,
      headers: { 'user-agent': 'LeadFennecBot/0.1' },
      signal: AbortSignal.timeout(5000),
      maxHeaderBytes: 16 * 1024,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) {
      chunks.push(Buffer.from(chunk));
    }
    expect(response.status).toBe(200);
    expect(Buffer.concat(chunks).toString()).toBe('<p>direct</p>');
    expect(seen[0]?.headers.host).toBe(`unresolvable.invalid:${String(port)}`);
  });
});

describe('networkError', () => {
  it.each([
    ['HPE_HEADER_OVERFLOW', 'too_large', false],
    ['HPE_INVALID_CONSTANT', 'bad_response', false],
    ['Z_DATA_ERROR', 'bad_response', false],
    ['ERR__ERROR_FORMAT_PADDING_1', 'bad_response', false],
    ['EPROTO', 'tls_failed', false],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_failed', false],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls_failed', false],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_failed', false],
    ['CERT_HAS_EXPIRED', 'tls_failed', false],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_failed', false],
    ['ECONNRESET', 'connection_failed', true],
    ['EHOSTUNREACH', 'connection_failed', true],
    ['', 'connection_failed', true],
  ])('maps %j to %s', (code, expected, retryable) => {
    const error = networkError(
      Object.assign(new Error('synthetic'), { code }),
      'u',
    );
    expect(error).toMatchObject({ code: expected, retryable });
  });
});

describe('NodeHttpTransport with the production dialer over TLS', () => {
  it('starts TLS to the checked address and fails closed when the server does not speak it', async () => {
    const transport = new NodeHttpTransport();
    let caught: unknown;
    try {
      await transport.request({
        url: new URL(`https://acme-widgets.com:${String(port)}/`),
        address: '127.0.0.1',
        family: 4,
        headers: {},
        signal: AbortSignal.timeout(5000),
        maxHeaderBytes: 16 * 1024,
      });
    } catch (error) {
      caught = error;
    }
    expect(networkError(caught, 'u').code).toBe('tls_failed');
    // Nothing was sent in clear text: the plain server saw no request.
    expect(seen).toEqual([]);
  });
});

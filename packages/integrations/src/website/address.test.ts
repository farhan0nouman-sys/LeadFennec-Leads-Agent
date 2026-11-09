import { describe, expect, it } from 'vitest';
import {
  checkAddress,
  checkHostName,
  parseFetchTarget,
  parseIPv6,
  pickPublicAddress,
} from './address.js';
import { WebsiteFetchError } from './errors.js';

// Task 09A, docs/decisions.md D-09A-01 and D-09A-02: which destinations are never fetched.

const PORTS = { allowedPorts: [80, 443] };

function refusal(run: () => unknown): WebsiteFetchError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WebsiteFetchError);
    return error as WebsiteFetchError;
  }
  throw new Error('expected a refusal');
}

describe('checkAddress: IPv4', () => {
  it.each([
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'unspecified'],
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['100.64.0.1', 'shared'],
    ['100.127.255.254', 'shared'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.0.1', 'link_local'],
    ['169.254.169.254', 'metadata'],
    ['169.254.170.2', 'metadata'],
    ['169.254.170.23', 'metadata'],
    ['100.100.100.200', 'metadata'],
    ['168.63.129.16', 'metadata'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.0.0.170', 'reserved'],
    ['192.0.2.1', 'documentation'],
    ['192.88.99.1', 'reserved'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ])('refuses %s (%s)', (address, reason) => {
    expect(checkAddress(address)).toEqual({ allowed: false, reason });
  });

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.215.14',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.3.1',
    '198.20.0.1',
    '223.255.255.255',
  ])('allows the public address %s', (address) => {
    expect(checkAddress(address)).toEqual({ allowed: true, family: 4 });
  });
});

describe('checkAddress: IPv6', () => {
  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:7f00:1', 'loopback'],
    ['0:0:0:0:0:ffff:7f00:0001', 'loopback'],
    ['::ffff:169.254.169.254', 'metadata'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:8.8.8.8', 'ipv4_embedded'],
    ['::127.0.0.1', 'loopback'],
    ['64:ff9b::7f00:1', 'loopback'],
    ['64:ff9b::808:808', 'ipv4_embedded'],
    ['64:ff9b:1::1', 'reserved'],
    ['2002:7f00:1::', 'loopback'],
    ['2002:a9fe:a9fe::1', 'metadata'],
    ['2002:808:808::1', 'ipv4_embedded'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'ipv4_embedded'],
    ['2001:db8::1', 'documentation'],
    ['3fff::1', 'documentation'],
    ['2001:2::1', 'benchmarking'],
    ['2001:10::1', 'reserved'],
    ['fc00::1', 'private'],
    ['fdab:cdef::1', 'private'],
    ['fd00:ec2::254', 'metadata'],
    ['fd00:ec2::23', 'metadata'],
    ['fd20:ce::254', 'metadata'],
    ['fe80::1', 'link_local'],
    ['febf::1', 'link_local'],
    ['fec0::1', 'private'],
    ['ff02::1', 'multicast'],
    ['100::1', 'reserved'],
    ['5f00::1', 'reserved'],
    ['4000::1', 'reserved'],
    // IPv4-compatible forms carry 0.0.0.2 and 8.8.8.8.
    ['::2', 'unspecified'],
    ['::8.8.8.8', 'ipv4_embedded'],
  ])('refuses %s (%s)', (address, reason) => {
    expect(checkAddress(address)).toEqual({ allowed: false, reason });
  });

  it.each([
    '2606:4700:4700::1111',
    '2a00:1450:4001:80b::200e',
    '2001:4860:4860::8888',
    '2620:0:2d0:200::7',
  ])('allows the global address %s', (address) => {
    expect(checkAddress(address)).toEqual({ allowed: true, family: 6 });
  });

  it('parses compressed forms and IPv4 tails into eight groups', () => {
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x102, 0x304,
    ]);
    expect(parseIPv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each([
    'localhost',
    '1.2.3',
    '01.2.3.4',
    '1.2.3.256',
    '0x7f.0.0.1',
    '2130706433',
    'fe80::1%eth0',
    ':::1',
    '1::2::3',
    '1:2:3:4:5:6:7:8:9',
    '12345::1',
    '',
  ])('refuses %j as not an address in canonical form', (value) => {
    expect(checkAddress(value)).toEqual({
      allowed: false,
      reason: 'not_an_address',
    });
  });
});

describe('checkHostName', () => {
  it.each([
    ['localhost', 'single_label'],
    ['intranet', 'single_label'],
    ['metadata', 'single_label'],
    ['foo.localhost', 'internal_name'],
    ['printer.local', 'internal_name'],
    ['db.internal', 'internal_name'],
    ['router.home.arpa', 'internal_name'],
    ['1.0.0.127.in-addr.arpa', 'internal_name'],
    ['kubernetes.default.svc', 'internal_name'],
    ['corp.lan', 'internal_name'],
    ['hidden.onion', 'internal_name'],
    ['metadata.google.internal', 'metadata'],
    ['metadata.goog', 'metadata'],
    ['www.example', 'reserved_name'],
    ['shop.test', 'reserved_name'],
  ])('refuses %s (%s)', (name, reason) => {
    expect(checkHostName(name)).toMatchObject({
      allowed: false,
      code: 'blocked_host',
      reason,
    });
  });

  it('lets only the fake serve the reserved example names', () => {
    expect(checkHostName('acme.example', { synthetic: true })).toEqual({
      allowed: true,
    });
    expect(checkHostName('localhost', { synthetic: true }).allowed).toBe(false);
    expect(checkHostName('acme.com')).toEqual({ allowed: true });
  });

  it('refuses malformed names', () => {
    for (const name of [
      '-bad.com',
      'bad-.com',
      'a..b',
      `${'a'.repeat(64)}.com`,
      'sp ace.com',
    ]) {
      expect(checkHostName(name)).toMatchObject({
        allowed: false,
        code: 'invalid_url',
      });
    }
  });
});

describe('parseFetchTarget: unsafe destinations and alternate encodings', () => {
  const fullWidthLoopback = [
    0xff11, 0xff12, 0xff17, 0xff0e, 0xff10, 0xff0e, 0xff10, 0xff0e, 0xff11,
  ]
    .map((code) => String.fromCharCode(code))
    .join('');

  it.each([
    ['http://127.0.0.1/', 'blocked_address', 'loopback'],
    ['http://127.0.0.1:443/', 'blocked_address', 'loopback'],
    ['http://2130706433/', 'blocked_address', 'loopback'],
    ['http://0x7f000001/', 'blocked_address', 'loopback'],
    ['http://0177.0.0.1/', 'blocked_address', 'loopback'],
    ['http://0x7f.0.0.1/', 'blocked_address', 'loopback'],
    ['http://127.1/', 'blocked_address', 'loopback'],
    ['http://%31%32%37.0.0.1/', 'blocked_address', 'loopback'],
    [`http://${fullWidthLoopback}/`, 'blocked_address', 'loopback'],
    ['http://[::1]/', 'blocked_address', 'loopback'],
    ['http://[0:0:0:0:0:0:0:1]/', 'blocked_address', 'loopback'],
    ['http://[::ffff:127.0.0.1]/', 'blocked_address', 'loopback'],
    ['http://[::ffff:7f00:1]/', 'blocked_address', 'loopback'],
    ['http://[::127.0.0.1]/', 'blocked_address', 'loopback'],
    ['http://0/', 'blocked_address', 'unspecified'],
    ['http://0.0.0.0/', 'blocked_address', 'unspecified'],
    ['http://10.0.0.1/', 'blocked_address', 'private'],
    ['http://192.168.0.1:80/', 'blocked_address', 'private'],
    ['http://[fc00::1]/', 'blocked_address', 'private'],
    ['http://[fe80::1]/', 'blocked_address', 'link_local'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked_address', 'metadata'],
    ['http://0xa9fea9fe/', 'blocked_address', 'metadata'],
    ['http://2852039166/', 'blocked_address', 'metadata'],
    ['http://0251.0376.0251.0376/', 'blocked_address', 'metadata'],
    ['http://[::ffff:169.254.169.254]/', 'blocked_address', 'metadata'],
    ['http://[fd00:ec2::254]/latest/meta-data/', 'blocked_address', 'metadata'],
    ['http://168.63.129.16/?comp=versions', 'blocked_address', 'metadata'],
    ['http://100.100.100.200/latest/meta-data/', 'blocked_address', 'metadata'],
    ['http://localhost/', 'blocked_host', 'single_label'],
    ['http://LOCALHOST./', 'blocked_host', 'single_label'],
    ['http://app.localhost/', 'blocked_host', 'internal_name'],
    [
      'http://metadata.google.internal/computeMetadata/v1/',
      'blocked_host',
      'metadata',
    ],
    ['http://metadata.goog/', 'blocked_host', 'metadata'],
    ['http://printer.local/', 'blocked_host', 'internal_name'],
    ['https://www.example/', 'blocked_host', 'reserved_name'],
  ])('refuses %s before any lookup (%s, %s)', (url, code, reason) => {
    const error = refusal(() => parseFetchTarget(url, PORTS));
    expect(error.code).toBe(code);
    expect(error.reason).toBe(reason);
    expect(error.retryable).toBe(false);
  });

  it.each([
    ['file:///etc/passwd', 'blocked_scheme'],
    ['ftp://files.acme.com/', 'blocked_scheme'],
    ['gopher://acme.com/', 'blocked_scheme'],
    ['data:text/html,hello', 'blocked_scheme'],
    ['javascript:alert(1)', 'blocked_scheme'],
    ['ws://acme.com/', 'blocked_scheme'],
    ['http://user:secret@acme.com/', 'credentials_in_url'],
    ['http://acme.com@127.0.0.1/', 'credentials_in_url'],
    ['http://acme.com:22/', 'blocked_port'],
    ['http://acme.com:6379/', 'blocked_port'],
    ['https://acme.com:8443/', 'blocked_port'],
    ['not a url', 'invalid_url'],
    ['/relative/path', 'invalid_url'],
    ['http://', 'invalid_url'],
    [`http://${'a'.repeat(60)}.${'b'.repeat(2050)}.com/`, 'invalid_url'],
    ['http://acme.123/', 'invalid_url'],
    ['http://exa$mple.com/', 'invalid_url'],
  ])('refuses %s (%s)', (url, code) => {
    expect(refusal(() => parseFetchTarget(url, PORTS)).code).toBe(code);
  });

  it('accepts public names, drops the fragment and keys concurrency without www', () => {
    const target = parseFetchTarget(
      'https://WWW.Acme-Widgets.co.uk./About?x=1#team',
      PORTS,
    );
    expect(target.url.href).toBe('https://www.acme-widgets.co.uk./About?x=1');
    expect(target.host).toBe('www.acme-widgets.co.uk');
    expect(target.port).toBe(443);
    expect(target.literal).toBeNull();
    expect(target.hostKey).toBe('acme-widgets.co.uk');
  });

  it('accepts public IP literals, connected to without DNS', () => {
    expect(parseFetchTarget('http://93.184.215.14/', PORTS).literal).toEqual({
      address: '93.184.215.14',
      family: 4,
    });
    expect(
      parseFetchTarget('http://[2606:4700:4700::1111]/', PORTS).literal,
    ).toEqual({ address: '2606:4700:4700::1111', family: 6 });
  });

  it('encodes international names before checking them', () => {
    const name = `b${String.fromCharCode(0xfc)}cher.de`;
    expect(parseFetchTarget(`https://${name}/`, PORTS).host).toBe(
      'xn--bcher-kva.de',
    );
  });

  it('allows other ports only when the policy lists them', () => {
    expect(
      parseFetchTarget('https://acme.com:8443/', { allowedPorts: [443, 8443] })
        .port,
    ).toBe(8443);
  });
});

describe('pickPublicAddress', () => {
  const url = 'http://acme.com/';

  it('refuses the whole answer when any address is not public', () => {
    for (const internal of [
      '127.0.0.1',
      '10.0.0.7',
      '::1',
      'fd00:ec2::254',
      '::ffff:192.168.0.1',
    ]) {
      const error = refusal(() =>
        pickPublicAddress(
          [
            { address: '93.184.215.14', family: 4 },
            { address: internal, family: internal.includes(':') ? 6 : 4 },
          ],
          url,
        ),
      );
      expect(error.code).toBe('blocked_address');
    }
  });

  it('prefers the first IPv4 address, else the first IPv6 one', () => {
    expect(
      pickPublicAddress(
        [
          { address: '2606:4700:4700::1111', family: 6 },
          { address: '1.1.1.1', family: 4 },
          { address: '1.0.0.1', family: 4 },
        ],
        url,
      ),
    ).toEqual({ address: '1.1.1.1', family: 4 });
    expect(
      pickPublicAddress([{ address: '2606:4700:4700::1111', family: 6 }], url),
    ).toEqual({ address: '2606:4700:4700::1111', family: 6 });
  });

  it('treats an empty answer as a missing host', () => {
    expect(refusal(() => pickPublicAddress([], url)).code).toBe(
      'host_not_found',
    );
  });
});

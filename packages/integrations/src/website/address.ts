// Destination checks for the website fetcher (task 09A, docs/decisions.md D-09A-01, D-09A-02).
//
// Only globally reachable unicast addresses are fetched. The lists follow the IANA IPv4 and
// IPv6 Special-Purpose Address Registries (both last updated 2025-10-09, checked 2026-11-06)
// and the cloud providers' metadata documentation. Every address of a DNS answer is checked,
// at every hop, and the connection is then made to the checked address only (no second
// lookup), so a name can't change to an internal address between the check and the request.

import { WebsiteFetchError } from './errors.js';

export type AddressFamily = 4 | 6;

export const ADDRESS_BLOCK_REASONS = [
  'unspecified',
  'loopback',
  'private',
  'link_local',
  'shared',
  'metadata',
  'multicast',
  'broadcast',
  'documentation',
  'benchmarking',
  'reserved',
  /** An IPv6 form carrying an IPv4 address (mapped, compatible, NAT64, 6to4, Teredo). */
  'ipv4_embedded',
  /** Not an IP address in canonical text form. */
  'not_an_address',
] as const;

export type AddressBlockReason = (typeof ADDRESS_BLOCK_REASONS)[number];

export type AddressCheck =
  | { readonly allowed: true; readonly family: AddressFamily }
  | { readonly allowed: false; readonly reason: AddressBlockReason };

// ─── IPv4 ────────────────────────────────────────────────────────────────────

const DECIMAL_OCTET = /^(0|[1-9][0-9]{0,2})$/;

/**
 * Strict dotted-decimal only (what the WHATWG URL parser and getaddrinfo produce). Octal, hex,
 * short and integer forms are refused here: URLs reach this function already normalized by
 * the URL parser, so anything else is not an address we connect to.
 */
export function parseIPv4(text: string): readonly number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!DECIMAL_OCTET.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
}

const toUint32 = (octets: readonly number[]): number =>
  (((octets[0] ?? 0) << 24) |
    ((octets[1] ?? 0) << 16) |
    ((octets[2] ?? 0) << 8) |
    (octets[3] ?? 0)) >>>
  0;

interface Ipv4Range {
  readonly base: number;
  readonly mask: number;
  readonly reason: AddressBlockReason;
}

function ipv4Range(cidr: string, reason: AddressBlockReason): Ipv4Range {
  const [address = '', bits = '32'] = cidr.split('/');
  const octets = parseIPv4(address);
  if (octets === null) {
    throw new Error(`Bad IPv4 range ${cidr}`);
  }
  const length = Number(bits);
  const mask = length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0;
  return { base: (toUint32(octets) & mask) >>> 0, mask, reason };
}

/** Cloud metadata services, checked first so the reason names them (D-09A-01). */
const IPV4_METADATA = new Set([
  // AWS, Google Cloud, Azure IMDS, Oracle, DigitalOcean, OpenStack.
  '169.254.169.254',
  // AWS ECS task metadata and EKS Pod Identity.
  '169.254.170.2',
  '169.254.170.23',
  // Alibaba Cloud ECS.
  '100.100.100.200',
  // Azure WireServer: a public address that only Azure's host answers (Microsoft Learn).
  '168.63.129.16',
]);

/** Not globally reachable, per the IANA IPv4 registry (plus multicast and 240/4). */
const IPV4_BLOCKED: readonly Ipv4Range[] = [
  ipv4Range('0.0.0.0/8', 'unspecified'),
  ipv4Range('10.0.0.0/8', 'private'),
  ipv4Range('100.64.0.0/10', 'shared'),
  ipv4Range('127.0.0.0/8', 'loopback'),
  ipv4Range('169.254.0.0/16', 'link_local'),
  ipv4Range('172.16.0.0/12', 'private'),
  // IETF protocol assignments; the two anycast addresses in it are no websites either.
  ipv4Range('192.0.0.0/24', 'reserved'),
  ipv4Range('192.0.2.0/24', 'documentation'),
  ipv4Range('192.88.99.0/24', 'reserved'),
  ipv4Range('192.168.0.0/16', 'private'),
  ipv4Range('198.18.0.0/15', 'benchmarking'),
  ipv4Range('198.51.100.0/24', 'documentation'),
  ipv4Range('203.0.113.0/24', 'documentation'),
  ipv4Range('224.0.0.0/4', 'multicast'),
  ipv4Range('255.255.255.255/32', 'broadcast'),
  ipv4Range('240.0.0.0/4', 'reserved'),
];

function checkIPv4Octets(octets: readonly number[]): AddressCheck {
  if (IPV4_METADATA.has(octets.join('.'))) {
    return { allowed: false, reason: 'metadata' };
  }
  const value = toUint32(octets);
  for (const range of IPV4_BLOCKED) {
    if ((value & range.mask) >>> 0 === range.base) {
      return { allowed: false, reason: range.reason };
    }
  }
  return { allowed: true, family: 4 };
}

// ─── IPv6 ────────────────────────────────────────────────────────────────────

const HEXTET = /^[0-9a-f]{1,4}$/;

/**
 * Eight 16-bit groups, or null. Accepts "::" compression and a dotted IPv4 tail. Refuses zone
 * ids ("%eth0"): a link-local scope is never fetched, and the URL parser refuses them anyway.
 */
export function parseIPv6(text: string): readonly number[] | null {
  let value = text.toLowerCase();
  if (value.includes('%') || value.length > 45) {
    return null;
  }
  const lastColon = value.lastIndexOf(':');
  if (lastColon === -1) {
    return null;
  }
  const tail = value.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (v4 === null) {
      return null;
    }
    const high = (((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16);
    const low = (((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const groupsOf = (part: string): number[] | null => {
    if (part === '') {
      return [];
    }
    const groups: number[] = [];
    for (const group of part.split(':')) {
      if (!HEXTET.test(group)) {
        return null;
      }
      groups.push(parseInt(group, 16));
    }
    return groups;
  };
  const halves = value.split('::');
  if (halves.length > 2) {
    return null;
  }
  if (halves.length === 2) {
    const head = groupsOf(halves[0] ?? '');
    const rest = groupsOf(halves[1] ?? '');
    if (head === null || rest === null) {
      return null;
    }
    const missing = 8 - head.length - rest.length;
    if (missing < 1) {
      return null;
    }
    return [...head, ...new Array<number>(missing).fill(0), ...rest];
  }
  const groups = groupsOf(value);
  return groups?.length === 8 ? groups : null;
}

const IPV6_METADATA = new Set([
  // AWS IMDS and EKS Pod Identity over IPv6.
  'fd00:ec2:0:0:0:0:0:254',
  'fd00:ec2:0:0:0:0:0:23',
  // Google Cloud metadata on IPv6-only instances.
  'fd20:ce:0:0:0:0:0:254',
]);

const embeddedIPv4 = (high: number, low: number): number[] => [
  high >> 8,
  high & 0xff,
  low >> 8,
  low & 0xff,
];

/** An IPv6 form that carries an IPv4 address: the IPv4 reason if it is blocked, else its own. */
function embedded(octets: readonly number[]): AddressCheck {
  const inner = checkIPv4Octets(octets);
  return {
    allowed: false,
    reason: inner.allowed ? 'ipv4_embedded' : inner.reason,
  };
}

function checkIPv6Groups(g: readonly number[]): AddressCheck {
  const at = (index: number) => g[index] ?? 0;
  if (IPV6_METADATA.has(g.map((group) => group.toString(16)).join(':'))) {
    return { allowed: false, reason: 'metadata' };
  }
  const firstFiveZero = [0, 1, 2, 3, 4].every((index) => at(index) === 0);
  if (firstFiveZero && at(5) === 0) {
    if (at(6) === 0 && at(7) === 0) {
      return { allowed: false, reason: 'unspecified' };
    }
    if (at(6) === 0 && at(7) === 1) {
      return { allowed: false, reason: 'loopback' };
    }
    // ::a.b.c.d, the deprecated IPv4-compatible form.
    return embedded(embeddedIPv4(at(6), at(7)));
  }
  // ::ffff:a.b.c.d, IPv4-mapped.
  if (firstFiveZero && at(5) === 0xffff) {
    return embedded(embeddedIPv4(at(6), at(7)));
  }
  // 64:ff9b::/96 (NAT64) and 64:ff9b:1::/48 (local-use NAT64).
  if (at(0) === 0x64 && at(1) === 0xff9b) {
    if ([2, 3, 4, 5].every((index) => at(index) === 0)) {
      return embedded(embeddedIPv4(at(6), at(7)));
    }
    return { allowed: false, reason: 'reserved' };
  }
  // 2002::/16, 6to4: the IPv4 address follows the prefix.
  if (at(0) === 0x2002) {
    return embedded(embeddedIPv4(at(1), at(2)));
  }
  if (at(0) === 0x2001) {
    if (at(1) === 0) {
      // 2001::/32, Teredo: an obfuscated IPv4 client address.
      return { allowed: false, reason: 'ipv4_embedded' };
    }
    if (at(1) === 0x0db8) {
      return { allowed: false, reason: 'documentation' };
    }
    if (at(1) === 2 && at(2) === 0) {
      return { allowed: false, reason: 'benchmarking' };
    }
    // The rest of 2001::/23, IETF protocol assignments: no websites.
    if (at(1) < 0x0200) {
      return { allowed: false, reason: 'reserved' };
    }
  }
  // 3fff::/20, documentation (RFC 9637).
  if (at(0) === 0x3fff && at(1) < 0x1000) {
    return { allowed: false, reason: 'documentation' };
  }
  if ((at(0) & 0xfe00) === 0xfc00) {
    return { allowed: false, reason: 'private' };
  }
  if ((at(0) & 0xffc0) === 0xfe80) {
    return { allowed: false, reason: 'link_local' };
  }
  // fec0::/10, the deprecated site-local block.
  if ((at(0) & 0xffc0) === 0xfec0) {
    return { allowed: false, reason: 'private' };
  }
  if ((at(0) & 0xff00) === 0xff00) {
    return { allowed: false, reason: 'multicast' };
  }
  // Only 2000::/3 is global unicast; everything else (::/8 rest, 100::/64, 5f00::/16 ...) isn't.
  if ((at(0) & 0xe000) !== 0x2000) {
    return { allowed: false, reason: 'reserved' };
  }
  return { allowed: true, family: 6 };
}

/** Whether an IP address (canonical IPv4 or IPv6 text, no brackets) may be fetched. */
export function checkAddress(address: string): AddressCheck {
  const v4 = parseIPv4(address);
  if (v4 !== null) {
    return checkIPv4Octets(v4);
  }
  const v6 = parseIPv6(address);
  if (v6 !== null) {
    return checkIPv6Groups(v6);
  }
  return { allowed: false, reason: 'not_an_address' };
}

// ─── Host names ──────────────────────────────────────────────────────────────

/**
 * Names that are internal by definition: RFC 6761 / 6762 / 8375 / 9476 special-use names,
 * ICANN's reserved .internal, common private suffixes, and cloud metadata names. DNS answers
 * are checked anyway; this refuses them before any lookup and says why.
 */
const INTERNAL_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'home.arpa',
  'corp',
  'private',
  'svc',
  'arpa',
  'onion',
  'alt',
  'invalid',
];

/** Reserved for examples and tests (RFC 2606): never real sites. The fake serves them. */
export const SYNTHETIC_SUFFIXES = ['example', 'test'] as const;

const INTERNAL_NAMES = new Set(['metadata.goog', 'metadata.google.internal']);

const LABEL = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;

const hasSuffix = (name: string, suffix: string) =>
  name === suffix || name.endsWith(`.${suffix}`);

export type HostNameCheck =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: 'invalid_url' | 'blocked_host';
      readonly reason: string;
    };

/**
 * A host name (already lower-cased and IDNA-encoded by the URL parser). `synthetic` lets the
 * fake serve the reserved example names; the live fetcher never does.
 */
export function checkHostName(
  name: string,
  options: { readonly synthetic?: boolean } = {},
): HostNameCheck {
  if (name.length === 0 || name.length > 253) {
    return { allowed: false, code: 'invalid_url', reason: 'length' };
  }
  const labels = name.split('.');
  if (!labels.every((label) => LABEL.test(label))) {
    return { allowed: false, code: 'invalid_url', reason: 'characters' };
  }
  if (labels.length < 2) {
    return { allowed: false, code: 'blocked_host', reason: 'single_label' };
  }
  if (INTERNAL_NAMES.has(name)) {
    return { allowed: false, code: 'blocked_host', reason: 'metadata' };
  }
  if (INTERNAL_SUFFIXES.some((suffix) => hasSuffix(name, suffix))) {
    return { allowed: false, code: 'blocked_host', reason: 'internal_name' };
  }
  if (
    options.synthetic !== true &&
    SYNTHETIC_SUFFIXES.some((suffix) => hasSuffix(name, suffix))
  ) {
    return { allowed: false, code: 'blocked_host', reason: 'reserved_name' };
  }
  return { allowed: true };
}

// ─── URLs ────────────────────────────────────────────────────────────────────

export const MAX_URL_LENGTH = 2048;

export interface FetchTarget {
  /** The URL to request, without its fragment. */
  readonly url: URL;
  /** The host without IPv6 brackets, lower case, no trailing dot. */
  readonly host: string;
  readonly port: number;
  /** Set when the host is an IP literal: it is connected to as is, without DNS. */
  readonly literal: {
    readonly address: string;
    readonly family: AddressFamily;
  } | null;
  /** The per-host concurrency key: the host without a leading "www.". */
  readonly hostKey: string;
}

export interface TargetOptions {
  readonly allowedPorts: readonly number[];
  /** The fake only: serve the reserved example names. */
  readonly synthetic?: boolean;
}

/**
 * Parses and checks a URL before anything is sent. The WHATWG URL parser normalizes the host
 * first, so alternate encodings of an address (integer, octal, hex, short forms, percent- or
 * full-width-encoded digits, IPv4-mapped IPv6) arrive here as the address they stand for and
 * are refused like it.
 */
export function parseFetchTarget(
  input: string | URL,
  options: TargetOptions,
): FetchTarget {
  const raw = typeof input === 'string' ? input.trim() : input.href;
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    throw new WebsiteFetchError('invalid_url', { reason: 'length' });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebsiteFetchError('invalid_url', { reason: 'syntax' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebsiteFetchError('blocked_scheme', {
      reason: url.protocol.replace(/:$/, ''),
    });
  }
  if (url.username !== '' || url.password !== '') {
    throw new WebsiteFetchError('credentials_in_url');
  }
  url.hash = '';
  const href = url.href;
  const port =
    url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!options.allowedPorts.includes(port)) {
    throw new WebsiteFetchError('blocked_port', {
      reason: String(port),
      url: href,
    });
  }
  let host = url.hostname.toLowerCase();
  if (host.endsWith('.')) {
    host = host.slice(0, -1);
  }
  if (host.startsWith('[') && host.endsWith(']')) {
    const address = host.slice(1, -1);
    const check = checkAddress(address);
    if (!check.allowed || check.family !== 6) {
      throw new WebsiteFetchError('blocked_address', {
        reason: check.allowed ? 'not_an_address' : check.reason,
        url: href,
      });
    }
    return {
      url,
      host: address,
      port,
      literal: { address, family: 6 },
      hostKey: address,
    };
  }
  if (parseIPv4(host) !== null) {
    const check = checkAddress(host);
    if (!check.allowed) {
      throw new WebsiteFetchError('blocked_address', {
        reason: check.reason,
        url: href,
      });
    }
    return {
      url,
      host,
      port,
      literal: { address: host, family: 4 },
      hostKey: host,
    };
  }
  // A last label of digits is an IPv4 form the URL parser should have converted; never DNS.
  if (/^(0x[0-9a-f]*|[0-9]+)$/.test(host.split('.').at(-1) ?? '')) {
    throw new WebsiteFetchError('invalid_url', {
      reason: 'numeric_host',
      url: href,
    });
  }
  const check = checkHostName(
    host,
    options.synthetic === true ? { synthetic: true } : {},
  );
  if (!check.allowed) {
    throw new WebsiteFetchError(check.code, {
      reason: check.reason,
      url: href,
    });
  }
  return {
    url,
    host,
    port,
    literal: null,
    hostKey: host.startsWith('www.') ? host.slice('www.'.length) : host,
  };
}

/**
 * Checks every address of a DNS answer: one non-public address refuses the whole answer (a
 * name that mixes public and internal addresses is not fetched). Returns the address to
 * connect to: the first IPv4 address, else the first IPv6 one.
 */
export function pickPublicAddress(
  addresses: readonly { readonly address: string; readonly family: number }[],
  url: string,
): { readonly address: string; readonly family: AddressFamily } {
  if (addresses.length === 0) {
    throw new WebsiteFetchError('host_not_found', { url });
  }
  let first: { address: string; family: AddressFamily } | null = null;
  let firstV6: { address: string; family: AddressFamily } | null = null;
  for (const { address } of addresses) {
    const check = checkAddress(address);
    if (!check.allowed) {
      throw new WebsiteFetchError('blocked_address', {
        reason: check.reason,
        url,
      });
    }
    if (check.family === 4) {
      first ??= { address, family: 4 };
    } else {
      firstV6 ??= { address, family: 6 };
    }
  }
  const chosen = first ?? firstV6;
  if (chosen === null) {
    throw new WebsiteFetchError('host_not_found', { url });
  }
  return chosen;
}

// Explicit normalization of identity keys. Every stored `normalized_*` column is produced by
// these functions; database CHECK constraints enforce the same invariants
// (packages/database/prisma/migrations/*_tenant_integrity_checks). Inputs are untrusted.

export class IdentityNormalizationError extends Error {
  override readonly name = 'IdentityNormalizationError';
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Normalizes a company domain or website address to its bare host name:
 * `https://WWW.Example.CO.uk/about` → `example.co.uk`.
 *
 * - Scheme, credentials, port, path, query and fragment are dropped.
 * - Lower-cased; internationalized names become ASCII (punycode) via WHATWG URL parsing.
 * - One leading `www.` and a trailing dot are removed.
 * - IP addresses, single-label hosts and invalid labels are rejected.
 */
export function normalizeDomain(input: string): string {
  const raw = input.trim();
  if (raw === '') {
    throw new IdentityNormalizationError('Domain is empty.');
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `http://${raw.replace(/^\/\//, '')}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    throw new IdentityNormalizationError('Domain is not a valid host name.');
  }
  host = host.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) {
    host = host.slice('www.'.length);
  }
  if (host.startsWith('[') || IPV4.test(host)) {
    throw new IdentityNormalizationError(
      'IP addresses are not company domains.',
    );
  }
  const labels = host.split('.');
  const tld = labels.at(-1) ?? '';
  if (
    host.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => LABEL.test(label)) ||
    !TLD.test(tld)
  ) {
    throw new IdentityNormalizationError('Domain is not a valid host name.');
  }
  return host;
}

export interface NormalizedEmail {
  /** Identity key: lower-cased local part @ normalized domain. */
  readonly email: string;
  /** The normalized domain part, for matching contacts to organizations. */
  readonly domain: string;
}

const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/;

/**
 * Normalizes an email address used as an identity key: trimmed, lower-cased, and with its
 * domain normalized by `normalizeDomain` (IDN → punycode, no trailing dot).
 *
 * Deliberately NOT applied: removing dots or `+tags` from the local part (provider-specific;
 * it would merge identities that the mailbox owner may treat as distinct), and stripping
 * `www.` (`www.` is never part of an email domain, so the domain step keeps it intact).
 * Quoted local parts and IP-literal domains are rejected.
 */
export function normalizeEmail(input: string): NormalizedEmail {
  const raw = input.trim();
  const at = raw.lastIndexOf('@');
  if (at <= 0 || raw.indexOf('@') !== at || at === raw.length - 1) {
    throw new IdentityNormalizationError(
      'Email address must contain exactly one "@".',
    );
  }
  const local = raw.slice(0, at).toLowerCase();
  if (
    !LOCAL_PART.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  ) {
    throw new IdentityNormalizationError(
      'Email address has an invalid local part.',
    );
  }
  const domainInput = raw.slice(at + 1);
  if (/[/:?#\s[\]]/.test(domainInput)) {
    throw new IdentityNormalizationError(
      'Email address has an invalid domain.',
    );
  }
  // normalizeDomain strips a leading "www."; email domains keep every label, so restore it.
  const keepsWww = /^www\./i.test(domainInput);
  const normalized = normalizeDomain(domainInput);
  const domain = keepsWww ? `www.${normalized}` : normalized;
  return { email: `${local}@${domain}`, domain };
}

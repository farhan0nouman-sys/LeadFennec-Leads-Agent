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

/** Legal-form words dropped from the end of a company name key ("Acme Inc." ~ "ACME"). */
const LEGAL_FORMS = new Set([
  'inc',
  'incorporated',
  'llc',
  'llp',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'gmbh',
  'ag',
  'kg',
  'sa',
  'sas',
  'sarl',
  'srl',
  'spa',
  'bv',
  'nv',
  'ab',
  'as',
  'oy',
  'pty',
  'pte',
  'kk',
]);

export interface CompanyIdentity {
  /** The name as shown: trimmed, inner whitespace collapsed. */
  readonly name: string;
  /** Lower-case ASCII words without punctuation or a trailing legal form. */
  readonly nameKey: string;
  /** From the domain or website (normalizeDomain); null when missing or invalid. */
  readonly domain: string | null;
  /** The identity of the company: its domain when known, else its name key. */
  readonly key: string;
}

/**
 * Normalizes a company's identity (task 07A). The domain is the strong key; a company without a
 * usable domain is identified by its name key, which ignores case, accents, punctuation and a
 * trailing legal form ("Müller GmbH" and "MULLER" match). Inputs are untrusted provider or
 * import data: an invalid domain is dropped, not an error; an empty name is an error.
 */
export function normalizeCompanyIdentity(input: {
  readonly name: string;
  readonly domain?: string | null;
  readonly website?: string | null;
}): CompanyIdentity {
  const name = input.name.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name === '') {
    throw new IdentityNormalizationError('Company name is empty.');
  }
  if (name.length > 300) {
    throw new IdentityNormalizationError('Company name is too long.');
  }
  const words = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
  while (words.length > 1 && LEGAL_FORMS.has(words.at(-1) ?? '')) {
    words.pop();
  }
  const nameKey = words.join(' ');
  if (nameKey === '') {
    throw new IdentityNormalizationError(
      'Company name has no letters or digits.',
    );
  }
  let domain: string | null = null;
  for (const candidate of [input.domain, input.website]) {
    if (domain === null && candidate !== null && candidate !== undefined) {
      try {
        domain = normalizeDomain(candidate);
      } catch {
        domain = null;
      }
    }
  }
  return {
    name,
    nameKey,
    domain,
    key: domain === null ? `name:${nameKey}` : `domain:${domain}`,
  };
}

export interface ContactIdentity {
  /** As shown: NFC, trimmed, inner whitespace collapsed. */
  readonly firstName: string;
  readonly lastName: string;
  /** "first last" in lower-case ASCII without accents or punctuation. */
  readonly nameKey: string;
  /** normalizeEmail's address; null without one. Never a verification status. */
  readonly email: string | null;
  /** The canonical profile URL (https://www.linkedin.com/in/<slug>); null without one. */
  readonly linkedinUrl: string | null;
  /** The company's domain (normalizeDomain); null when unknown. */
  readonly organizationDomain: string | null;
  /**
   * The identity of the person: the email address when known, else the LinkedIn profile, else
   * the company's domain with the name key.
   */
  readonly key: string;
}

const personName = (value: string, label: string): string => {
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name === '') {
    throw new IdentityNormalizationError(`${label} is empty.`);
  }
  if (name.length > 100) {
    throw new IdentityNormalizationError(`${label} is too long.`);
  }
  return name;
};

const asciiWords = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * A LinkedIn profile URL (task 08A) → https://www.linkedin.com/in/<slug>, or an
 * IdentityNormalizationError. Only https or http, a linkedin.com host and an /in/ path.
 */
export function normalizeLinkedinUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new IdentityNormalizationError('LinkedIn URL is not a URL.');
  }
  const host = url.hostname.toLowerCase();
  const match = /^\/in\/([^/]+)\/?$/.exec(url.pathname);
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) ||
    match?.[1] === undefined
  ) {
    throw new IdentityNormalizationError(
      'LinkedIn URL is not a profile (https://www.linkedin.com/in/…).',
    );
  }
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]).toLowerCase();
  } catch {
    throw new IdentityNormalizationError('LinkedIn URL is not a profile.');
  }
  if (!/^[\p{L}\p{N}_-]{3,100}$/u.test(slug)) {
    throw new IdentityNormalizationError('LinkedIn URL is not a profile.');
  }
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
}

/**
 * Normalizes a person's identity (task 08A). Inputs are untrusted provider, import or AI data:
 * an email, LinkedIn URL or domain that is given but malformed is an error, not dropped, so a
 * malformed contact is refused rather than half-saved. Someone with no email, no profile and
 * no company domain can't be identified and is an error too.
 */
export function normalizeContactIdentity(input: {
  readonly firstName: string;
  readonly lastName: string;
  readonly email?: string | null;
  readonly linkedinUrl?: string | null;
  readonly organizationDomain?: string | null;
}): ContactIdentity {
  const firstName = personName(input.firstName, 'First name');
  const lastName = personName(input.lastName, 'Last name');
  const nameKey = asciiWords(`${firstName} ${lastName}`).replace(/\s+/g, ' ');
  if (nameKey === '') {
    throw new IdentityNormalizationError('Name has no letters or digits.');
  }
  const email =
    input.email === null || input.email === undefined
      ? null
      : normalizeEmail(input.email).email;
  const linkedinUrl =
    input.linkedinUrl === null || input.linkedinUrl === undefined
      ? null
      : normalizeLinkedinUrl(input.linkedinUrl);
  const organizationDomain =
    input.organizationDomain === null || input.organizationDomain === undefined
      ? null
      : normalizeDomain(input.organizationDomain);
  let key: string;
  if (email !== null) {
    key = `email:${email}`;
  } else if (linkedinUrl !== null) {
    key = `linkedin:${linkedinUrl.slice('https://www.linkedin.com/in/'.length)}`;
  } else if (organizationDomain !== null) {
    key = `name:${organizationDomain}:${nameKey}`;
  } else {
    throw new IdentityNormalizationError(
      'A contact needs an email address, a LinkedIn profile or a company domain.',
    );
  }
  return {
    firstName,
    lastName,
    nameKey,
    email,
    linkedinUrl,
    organizationDomain,
    key,
  };
}

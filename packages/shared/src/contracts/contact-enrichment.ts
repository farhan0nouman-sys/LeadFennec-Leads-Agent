// Contact enrichment contracts (task 08A, docs/decisions.md D-08A-*): what the
// ContactEnrichmentAgent is given and may answer, how people are ranked for a role, what an
// email check says, and when an address may be sent to automatically. Pure zod: safe for web,
// API and worker.
//
// An email address is only an address. Whether it may receive email comes only from an email
// check (a verification provider's result with its provider and time), and no schema here has a
// field that lets anything else claim it: the agent's output can't carry a status (strict
// schemas), a provider's own "verified" is kept as an untrusted claim, and only a fresh
// `verified` check makes an address automatically send-eligible. `risky` and `unknown` never do.
import { z } from 'zod';
import {
  IdentityNormalizationError,
  normalizeContactIdentity,
  normalizeDomain,
  normalizeEmail,
  type ContactIdentity,
} from '../identity.js';

// ─── Seniority and role relevance ────────────────────────────────────────────

/** Seniority levels, most senior first. */
export const SENIORITY_LEVELS = [
  'owner',
  'founder',
  'c_suite',
  'partner',
  'vp',
  'head',
  'director',
  'manager',
  'senior',
  'entry',
  'intern',
] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

const ABBREVIATIONS: readonly [RegExp, string][] = [
  [/\bsvp\b/g, 'senior vice president'],
  [/\bevp\b/g, 'executive vice president'],
  [/\bavp\b/g, 'assistant vice president'],
  [/\bvp\b/g, 'vice president'],
  [/\bsr\b/g, 'senior'],
  [/\bjr\b/g, 'junior'],
  [/\bmgr\b/g, 'manager'],
  [/\bdir\b/g, 'director'],
  [/\bhd\b/g, 'head'],
  [/\bbiz dev\b/g, 'business development'],
  [/\bbd\b/g, 'business development'],
];

/** Lower-case ASCII words, abbreviations spelled out ("Sr. VP, Sales" → "senior vice president sales"). */
export function normalizeTitle(title: string): string {
  let text = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (const [pattern, replacement] of ABBREVIATIONS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, ' ');
}

const SENIORITY_WORDS: readonly [RegExp, SeniorityLevel][] = [
  [/\b(owner|proprietor)\b/, 'owner'],
  [/\b(co ?founder|founder)\b/, 'founder'],
  [
    /\b(chief|ceo|cto|cfo|coo|cmo|cro|cio|ciso|cpo|cso|c suite|c level|president)\b/,
    'c_suite',
  ],
  [/\b(partner|principal)\b/, 'partner'],
  [/\bvice president\b/, 'vp'],
  [/\bhead\b/, 'head'],
  [/\bdirector\b/, 'director'],
  [/\b(manager|lead|supervisor)\b/, 'manager'],
  [/\b(senior|staff)\b/, 'senior'],
  [/\b(intern|trainee|apprentice)\b/, 'intern'],
  [
    /\b(junior|associate|assistant|coordinator|specialist|representative)\b/,
    'entry',
  ],
];

/** The seniority a title implies, or null when it says nothing about it. */
export function inferSeniority(title: string | null): SeniorityLevel | null {
  if (title === null) {
    return null;
  }
  const text = normalizeTitle(title);
  // "Vice President" is a VP even though it contains "president".
  if (/\bvice president\b/.test(text) && !/\bchief\b/.test(text)) {
    return 'vp';
  }
  for (const [pattern, level] of SENIORITY_WORDS) {
    if (pattern.test(text)) {
      return level;
    }
  }
  return null;
}

/** A seniority as an ICP writes it ("VP", "C-level", "Directors") → a level, or null. */
export function parseSeniority(text: string): SeniorityLevel | null {
  const words = normalizeTitle(text).replace(/s$/, '');
  const direct = SENIORITY_LEVELS.find(
    (level) => level.replace('_', ' ') === words || level === words,
  );
  return direct ?? inferSeniority(words);
}

const STOP_WORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in', 'to', 'a']);
const tokens = (text: string) =>
  normalizeTitle(text)
    .split(' ')
    .filter((word) => word !== '' && !STOP_WORDS.has(word));

export interface RoleRelevance {
  /** 0–100: title match (up to 70) plus seniority match (up to 30). */
  readonly score: number;
  /** The ICP title that matched best, if any. */
  readonly matchedTitle: string | null;
  /** The person's seniority, given or read from the title. */
  readonly seniority: SeniorityLevel | null;
  readonly seniorityMatches: boolean;
  /** Why, in a few words each. */
  readonly reasons: readonly string[];
}

/**
 * How well a person fits the roles an ICP targets (task 08A, D-08A-03). Deterministic:
 * application code ranks people, never a model. Titles: the same title scores 70, every word
 * of a target title 55, otherwise the share of shared words up to 40. Seniority: a target
 * level scores 30, the level next to one 15. With no targets, only seniority counts, more
 * senior first.
 */
export function rankRoleRelevance(
  person: {
    readonly title: string | null;
    readonly seniority?: SeniorityLevel | null;
  },
  targeting: {
    readonly titles: readonly string[];
    readonly seniorities: readonly string[];
  },
): RoleRelevance {
  const seniority = person.seniority ?? inferSeniority(person.title);
  const reasons: string[] = [];
  let titleScore = 0;
  let matchedTitle: string | null = null;
  if (person.title !== null) {
    const own = normalizeTitle(person.title);
    const ownTokens = new Set(tokens(person.title));
    for (const target of targeting.titles) {
      const wanted = tokens(target);
      if (wanted.length === 0) {
        continue;
      }
      let score: number;
      if (own === normalizeTitle(target)) {
        score = 70;
      } else if (wanted.every((word) => ownTokens.has(word))) {
        score = 55;
      } else {
        const shared = wanted.filter((word) => ownTokens.has(word)).length;
        const union = new Set([...wanted, ...ownTokens]).size;
        score = Math.round((shared / union) * 40);
      }
      if (score > titleScore) {
        titleScore = score;
        matchedTitle = target;
      }
    }
  }
  if (matchedTitle !== null) {
    reasons.push(
      titleScore === 70
        ? `Title is "${matchedTitle}"`
        : `Title is like "${matchedTitle}"`,
    );
  }

  const wantedLevels = targeting.seniorities
    .map(parseSeniority)
    .filter((level): level is SeniorityLevel => level !== null);
  let seniorityScore = 0;
  let seniorityMatches = false;
  if (seniority !== null) {
    const rank = SENIORITY_LEVELS.indexOf(seniority);
    if (wantedLevels.length === 0) {
      // No target: more senior people first, by a small margin.
      seniorityScore = Math.round(
        ((SENIORITY_LEVELS.length - rank) / SENIORITY_LEVELS.length) * 10,
      );
    } else if (wantedLevels.includes(seniority)) {
      seniorityScore = 30;
      seniorityMatches = true;
      reasons.push(`Seniority is ${seniority.replace('_', '-')}`);
    } else if (
      wantedLevels.some(
        (level) => Math.abs(SENIORITY_LEVELS.indexOf(level) - rank) === 1,
      )
    ) {
      seniorityScore = 15;
      reasons.push(`Seniority is close (${seniority.replace('_', '-')})`);
    }
  }
  return {
    score: Math.min(100, titleScore + seniorityScore),
    matchedTitle,
    seniority,
    seniorityMatches,
    reasons,
  };
}

// ─── Provenance and the agent's schemas ──────────────────────────────────────

/** Where people and their addresses may come from (FAKE in development and tests). */
export const CONTACT_DATA_PROVIDERS = ['FAKE', 'APOLLO'] as const;
export type ContactDataProvider = (typeof CONTACT_DATA_PROVIDERS)[number];

/** Who checks addresses. Only the fake exists (D-08A-05). */
export const EMAIL_VERIFICATION_PROVIDERS = ['FAKE'] as const;
export type EmailVerificationProviderName =
  (typeof EMAIL_VERIFICATION_PROVIDERS)[number];

const iso = z.iso.datetime({ offset: true });

/** Required on every contact and every address: nothing unattributed is accepted. */
export const provenanceSchema = z.strictObject({
  provider: z.enum(CONTACT_DATA_PROVIDERS),
  /** The provider's id for the record, when it has one. */
  externalId: z.string().trim().min(1).max(200).nullable(),
  retrievedAt: iso,
  attribution: z.string().trim().min(1).max(300),
});
export type Provenance = z.output<typeof provenanceSchema>;

const domainSchema = z
  .string()
  .max(253)
  .refine((value) => {
    try {
      normalizeDomain(value);
      return true;
    } catch {
      return false;
    }
  }, 'Use a domain, such as example.com.');

const term = z.string().trim().min(1).max(100);

/** What the agent is given: one company and the roles to look for, nothing else. */
export const contactEnrichmentInputSchema = z.strictObject({
  organization: z.strictObject({
    id: z.uuid(),
    name: z.string().trim().min(1).max(300),
    domain: domainSchema.nullable(),
  }),
  targeting: z.strictObject({
    titles: z.array(term).max(30),
    seniorities: z.array(z.string().trim().min(1).max(40)).max(10),
  }),
  maxContacts: z.number().int().min(1).max(25),
});
export type ContactEnrichmentInput = z.output<
  typeof contactEnrichmentInputSchema
>;

/**
 * An address the agent found: the address and where it came from. Deliberately no status: an
 * address is never "verified" because it looks like an email or because a source says so.
 */
export const foundEmailSchema = z.strictObject({
  address: z.string().trim().min(3).max(254),
  provenance: provenanceSchema,
});

/** One person in the agent's answer. Strict: unknown keys (a status, a flag) are refused. */
export const enrichedContactSchema = z.strictObject({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200).nullable(),
  seniority: z.enum(SENIORITY_LEVELS).nullable(),
  linkedinUrl: z.string().trim().min(1).max(500).nullable(),
  email: foundEmailSchema.nullable(),
  provenance: provenanceSchema,
});

/** The agent's answer as a whole; each contact is checked on its own (parseContactEnrichmentOutput). */
export const contactEnrichmentOutputSchema = z.strictObject({
  contacts: z.array(z.unknown()).max(25),
});

export interface ContactIssue {
  readonly path: string;
  readonly message: string;
}

/** A contact that passed every check, ranked by application code. */
export interface AcceptedContact {
  readonly identity: ContactIdentity;
  readonly title: string | null;
  readonly seniority: SeniorityLevel | null;
  readonly relevance: RoleRelevance;
  /** An address to check, never one to send to as it is. */
  readonly email: {
    readonly address: string;
    readonly domain: string;
    readonly provenance: Provenance;
  } | null;
  readonly provenance: Provenance;
  /** What was dropped and why (e.g. an address at another domain). */
  readonly warnings: readonly string[];
}

export type ParsedEnrichment =
  | {
      readonly ok: true;
      /** Most relevant first; ties by seniority, then name. */
      readonly contacts: readonly AcceptedContact[];
      /** Refused contacts, by their place in the answer. */
      readonly rejected: readonly {
        readonly index: number;
        readonly issues: readonly ContactIssue[];
      }[];
    }
  | { readonly ok: false; readonly issues: readonly ContactIssue[] };

const issuesOf = (error: z.ZodError, prefix: string): ContactIssue[] =>
  error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter((p) => p !== '').join('.'),
    message: issue.message,
  }));

const onDomain = (emailDomain: string, organizationDomain: string) =>
  emailDomain === organizationDomain ||
  emailDomain.endsWith(`.${organizationDomain}`);

/**
 * Checks the agent's (untrusted) answer for `input` (task 08A, D-08A-02). The answer as a whole
 * is refused if it isn't the schema or has more contacts than asked for. Each contact is then
 * accepted or refused on its own: malformed fields, missing provenance, an identity that can't
 * be normalized, or the same person twice. An address at another domain than the company's is
 * dropped with a warning (it may be a personal address). Application code ranks the result.
 */
export function parseContactEnrichmentOutput(
  raw: unknown,
  rawInput: z.input<typeof contactEnrichmentInputSchema>,
): ParsedEnrichment {
  const input = contactEnrichmentInputSchema.parse(rawInput);
  const output = contactEnrichmentOutputSchema.safeParse(raw);
  if (!output.success) {
    return { ok: false, issues: issuesOf(output.error, '') };
  }
  if (output.data.contacts.length > input.maxContacts) {
    return {
      ok: false,
      issues: [
        {
          path: 'contacts',
          message: `The answer has more contacts than the ${String(input.maxContacts)} asked for.`,
        },
      ],
    };
  }
  const organizationDomain =
    input.organization.domain === null
      ? null
      : normalizeDomain(input.organization.domain);
  const accepted: AcceptedContact[] = [];
  const rejected: { index: number; issues: ContactIssue[] }[] = [];
  const seen = new Set<string>();

  output.data.contacts.forEach((candidate, index) => {
    const path = `contacts.${String(index)}`;
    const parsed = enrichedContactSchema.safeParse(candidate);
    if (!parsed.success) {
      rejected.push({ index, issues: issuesOf(parsed.error, path) });
      return;
    }
    const contact = parsed.data;
    const warnings: string[] = [];
    let email: AcceptedContact['email'] = null;
    if (contact.email !== null) {
      let normalized: { email: string; domain: string };
      try {
        normalized = normalizeEmail(contact.email.address);
      } catch {
        rejected.push({
          index,
          issues: [
            {
              path: `${path}.email.address`,
              message: 'This is not an email address.',
            },
          ],
        });
        return;
      }
      if (
        organizationDomain !== null &&
        !onDomain(normalized.domain, organizationDomain)
      ) {
        warnings.push(
          `The address at ${normalized.domain} was dropped: it isn't at ${organizationDomain}.`,
        );
      } else {
        email = {
          address: normalized.email,
          domain: normalized.domain,
          provenance: contact.email.provenance,
        };
      }
    }
    let identity: ContactIdentity;
    try {
      identity = normalizeContactIdentity({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: email?.address ?? null,
        linkedinUrl: contact.linkedinUrl,
        organizationDomain,
      });
    } catch (error) {
      if (!(error instanceof IdentityNormalizationError)) {
        throw error;
      }
      rejected.push({ index, issues: [{ path, message: error.message }] });
      return;
    }
    if (seen.has(identity.key)) {
      rejected.push({
        index,
        issues: [{ path, message: 'The same person appears twice.' }],
      });
      return;
    }
    seen.add(identity.key);
    const relevance = rankRoleRelevance(
      { title: contact.title, seniority: contact.seniority },
      input.targeting,
    );
    accepted.push({
      identity,
      title: contact.title,
      seniority: relevance.seniority,
      relevance,
      email,
      provenance: contact.provenance,
      warnings,
    });
  });

  const rank = (level: SeniorityLevel | null) =>
    level === null ? SENIORITY_LEVELS.length : SENIORITY_LEVELS.indexOf(level);
  accepted.sort(
    (a, b) =>
      b.relevance.score - a.relevance.score ||
      rank(a.seniority) - rank(b.seniority) ||
      a.identity.nameKey.localeCompare(b.identity.nameKey) ||
      a.identity.key.localeCompare(b.identity.key),
  );
  return { ok: true, contacts: accepted, rejected };
}

// ─── Email checks and send eligibility ───────────────────────────────────────

/** What an email check can say (stored as VALID / RISKY / UNKNOWN / INVALID, D-08A-04). */
export const EMAIL_VERIFICATION_STATUSES = [
  /** The mailbox exists and accepts email. */
  'verified',
  /** It may accept email but can't be confirmed (e.g. a catch-all domain). */
  'risky',
  /** The check couldn't decide (timeout, greylisting, provider unsure). */
  'unknown',
  /** It doesn't accept email (no mailbox, no domain, bad syntax). */
  'invalid',
] as const;
export type EmailVerificationStatus =
  (typeof EMAIL_VERIFICATION_STATUSES)[number];

/** One check of one address, by a verification provider, at a time. */
export const emailCheckSchema = z.strictObject({
  address: z.string().trim().min(3).max(254),
  status: z.enum(EMAIL_VERIFICATION_STATUSES),
  /** The provider's reason in our words (e.g. "catch_all"), or null. */
  reason: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .nullable(),
  provider: z.enum(EMAIL_VERIFICATION_PROVIDERS),
  checkedAt: iso,
});
export type EmailCheck = z.output<typeof emailCheckSchema>;

/** A verified check is trusted for this long; then the address is checked again. */
export const VERIFICATION_MAX_AGE_DAYS = 30;

export type SendEligibilityState =
  'eligible' | 'needs_review' | 'stale' | 'unverified' | 'blocked';

export interface SendEligibility {
  /** True only for a fresh `verified` check of this exact address. */
  readonly automatic: boolean;
  readonly state: SendEligibilityState;
  readonly reason: string;
}

/**
 * Whether `address` may be sent to without a person deciding (task 08A, D-08A-04). Only a
 * well-formed check of that same address, `verified`, from the last 30 days and not from the
 * future, says yes. `risky` and `unknown` need a person and are never automatic; `invalid` is
 * blocked; anything else (no check, a malformed one, another address's) is unverified. The
 * check is parsed here, so an email-shaped string or a bare status never passes.
 */
export function emailSendEligibility(
  address: string,
  rawCheck: unknown,
  now: Date,
): SendEligibility {
  const unverified = {
    automatic: false,
    state: 'unverified',
    reason: "The address hasn't been checked.",
  } as const;
  const parsed = emailCheckSchema.safeParse(rawCheck);
  if (!parsed.success) {
    return unverified;
  }
  const check = parsed.data;
  let same: boolean;
  try {
    same =
      normalizeEmail(check.address).email === normalizeEmail(address).email;
  } catch {
    return unverified;
  }
  const checkedAt = new Date(check.checkedAt).getTime();
  if (!same || checkedAt > now.getTime()) {
    return unverified;
  }
  switch (check.status) {
    case 'invalid':
      return {
        automatic: false,
        state: 'blocked',
        reason: "The address doesn't accept email.",
      };
    case 'risky':
      return {
        automatic: false,
        state: 'needs_review',
        reason:
          'The address may not accept email (for example, the domain accepts everything). A person must decide.',
      };
    case 'unknown':
      return {
        automatic: false,
        state: 'needs_review',
        reason:
          "The address couldn't be checked. A person must decide, or check it again later.",
      };
    case 'verified':
      return now.getTime() - checkedAt > VERIFICATION_MAX_AGE_DAYS * 86_400_000
        ? {
            automatic: false,
            state: 'stale',
            reason: `The address was verified more than ${String(VERIFICATION_MAX_AGE_DAYS)} days ago. Check it again.`,
          }
        : {
            automatic: true,
            state: 'eligible',
            reason: 'The address was verified recently.',
          };
  }
}

// Send eligibility (task 10B, docs/decisions.md D-10B-*): whether a campaign may email a person,
// decided by deterministic rules with reason codes, apart from how well the person fits.
//
// - Fit (the lead score, task 10A) and eligibility are separate results. The rules never read the
//   score, so no score, however high, can lift a block or a review.
// - Every check answers pass, review (a person must decide) or blocked (nobody may send; only a
//   change of the facts lifts it). The result is the strictest answer of all checks.
// - Nothing unknown counts as permission: an address that wasn't checked, a source or a country
//   the workspace's policy doesn't name, a policy that isn't set, a recipient whose country isn't
//   known. Each of these is review or blocked.
// - Eligibility is decided when asked, from the facts at that moment (never cached), so it
//   follows every change after a lead was scored: a new suppression, an aged email check, a
//   paused campaign, a changed policy.
// Pure and deterministic. Safe for web, API and worker.
import { z } from 'zod';
import { exclusionsSchema } from './campaigns.js';
import {
  emailCheckSchema,
  emailSendEligibility,
  VERIFICATION_MAX_AGE_DAYS,
} from './contact-enrichment.js';
import { CAMPAIGN_STATUSES } from './dashboard.js';
import { LEAD_SCORE_BANDS } from './lead-scoring.js';

/** The rules' version, reported with every result. */
export const SEND_ELIGIBILITY_RULES = 'send-eligibility/1';

export const SEND_POLICY_ROUTES = {
  sendPolicy: (workspaceId: string) =>
    `/workspaces/${workspaceId}/settings/send-policy`,
} as const;

// ─── The workspace's send policy ─────────────────────────────────────────────

/** What a policy says about a country or a source. */
export const SEND_POLICY_ACTIONS = ['ALLOW', 'REVIEW', 'BLOCK'] as const;
export type SendPolicyAction = (typeof SEND_POLICY_ACTIONS)[number];

/** Where a person's details can come from (source_records.provider). */
export const SEND_POLICY_SOURCES = [
  'APOLLO',
  'CSV_IMPORT',
  'MANUAL',
  'WEBSITE',
  'FAKE',
] as const;
export type SendPolicySource = (typeof SEND_POLICY_SOURCES)[number];

export const SEND_POLICY_SOURCE_LABELS: Readonly<
  Record<SendPolicySource, string>
> = {
  APOLLO: 'Apollo',
  CSV_IMPORT: 'CSV import',
  MANUAL: 'added by hand',
  WEBSITE: 'company website',
  FAKE: 'synthetic test data',
};

/** Most countries a policy may name. */
export const SEND_POLICY_MAX_COUNTRIES = 250;

const ACTION = 'Choose ALLOW, REVIEW or BLOCK.';
const actionSchema = z.enum(SEND_POLICY_ACTIONS, ACTION);
const countryKey = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Use two-letter country codes in capitals, such as US.');

/**
 * Which recipients and which sources a workspace allows. A country or a source it doesn't name
 * is never allowed: unnamed countries follow `otherCountries` (REVIEW or BLOCK, never ALLOW), and
 * unnamed sources need a person. Anything else is refused by name.
 */
export const sendPolicySchema = z.strictObject(
  {
    regions: z.strictObject({
      /** Recipients' countries (ISO 3166-1 alpha-2) and what to do with them. */
      countries: z
        .record(countryKey, actionSchema, {
          error: (issue) =>
            issue.code === 'invalid_key'
              ? 'Use two-letter country codes in capitals, such as US.'
              : undefined,
        })
        .refine(
          (countries) =>
            Object.keys(countries).length <= SEND_POLICY_MAX_COUNTRIES,
          `Name at most ${String(SEND_POLICY_MAX_COUNTRIES)} countries.`,
        ),
      /** Recipients in a country not named above, or whose country isn't known. */
      otherCountries: z.enum(['REVIEW', 'BLOCK'], 'Choose REVIEW or BLOCK.'),
    }),
    /** Each source whose contacts may (or may not) be emailed. */
    sources: z.partialRecord(z.enum(SEND_POLICY_SOURCES), actionSchema, {
      // An unknown source arrives as unrecognized_keys at run time; anything but a wrong type
      // is about the keys.
      error: (issue) =>
        issue.code === 'invalid_type'
          ? undefined
          : `Lead Fennec knows these sources only: ${SEND_POLICY_SOURCES.join(', ')}.`,
    }),
  },
  {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Lead Fennec doesn't recognize ${issue.keys.length === 1 ? 'the setting' : 'the settings'} ${issue.keys.map((key) => `"${key}"`).join(', ')}.`
        : undefined,
  },
);

export type SendPolicy = z.output<typeof sendPolicySchema>;

/** The stored policy and its version (0: never set). Null: not set, so nothing is allowed. */
export const sendPolicyStateSchema = z.strictObject({
  version: z.int().min(0),
  policy: sendPolicySchema.nullable(),
});

export type SendPolicyState = z.output<typeof sendPolicyStateSchema>;

/** A save names the version it started from (compare-and-set); null clears the policy. */
export const updateSendPolicyRequestSchema = z.strictObject({
  version: z.int().min(0),
  policy: sendPolicySchema.nullable(),
});

// ─── Checks and reasons ──────────────────────────────────────────────────────

/** campaign: true for every lead of the campaign; lead: about this person. */
export const SEND_ELIGIBILITY_CHECKS = [
  { key: 'workspace', label: 'Workspace sending', scope: 'campaign' },
  { key: 'campaign', label: 'Campaign', scope: 'campaign' },
  { key: 'sender', label: 'Sending mailbox', scope: 'campaign' },
  { key: 'contact', label: 'Person', scope: 'lead' },
  { key: 'suppression', label: 'Do-not-contact list', scope: 'lead' },
  { key: 'exclusions', label: 'Campaign exclusions', scope: 'lead' },
  { key: 'verification', label: 'Email check', scope: 'lead' },
  { key: 'source', label: 'Data source', scope: 'lead' },
  { key: 'region', label: 'Region', scope: 'lead' },
] as const;

export type SendEligibilityCheckKey =
  (typeof SEND_ELIGIBILITY_CHECKS)[number]['key'];

const CHECK_KEYS = SEND_ELIGIBILITY_CHECKS.map((check) => check.key) as [
  SendEligibilityCheckKey,
  ...SendEligibilityCheckKey[],
];

/** Every reason code, by the check that gives it. */
export const SEND_ELIGIBILITY_REASON_CODES = [
  // workspace
  'sending_disabled',
  'no_entitled_plan',
  'plan_excludes_email',
  // campaign
  'campaign_not_active',
  // sender
  'sender_missing',
  'sender_not_ready',
  // contact
  'contact_archived',
  // suppression
  'suppressed_email',
  'suppressed_domain',
  // exclusions
  'excluded_email',
  'excluded_domain',
  'excluded_lead_list',
  'in_other_campaign',
  // verification
  'no_email',
  'email_not_verified',
  'email_invalid',
  'email_risky',
  'email_unknown',
  'verification_stale',
  // source
  'source_unknown',
  'source_policy_unknown',
  'source_review',
  'source_blocked',
  // region
  'region_policy_unknown',
  'country_unknown',
  'region_not_listed',
  'region_review',
  'region_blocked',
  'company_region_blocked',
] as const;

export type SendEligibilityReasonCode =
  (typeof SEND_ELIGIBILITY_REASON_CODES)[number];

export const SEND_ELIGIBILITY_STATUSES = [
  'eligible',
  'review',
  'blocked',
] as const;
export type SendEligibilityStatus = (typeof SEND_ELIGIBILITY_STATUSES)[number];

const reasonSchema = z.strictObject({
  code: z.enum(SEND_ELIGIBILITY_REASON_CODES),
  /** review: a person may decide; blocked: nobody may send until the facts change. */
  status: z.enum(['review', 'blocked']),
  /** False for every block: neither a score nor a person can lift it. */
  overridable: z.boolean(),
  message: z.string(),
});

export type SendEligibilityReason = z.output<typeof reasonSchema>;

export const sendEligibilityResultSchema = z.strictObject({
  rules: z.literal(SEND_ELIGIBILITY_RULES),
  status: z.enum(SEND_ELIGIBILITY_STATUSES),
  evaluatedAt: z.iso.datetime(),
  /** Every check, in SEND_ELIGIBILITY_CHECKS order. */
  checks: z.array(
    z.strictObject({
      key: z.enum(CHECK_KEYS),
      label: z.string(),
      scope: z.enum(['campaign', 'lead']),
      status: z.enum(['pass', 'review', 'blocked']),
      reasons: z.array(reasonSchema),
    }),
  ),
});

export type SendEligibilityResult = z.output<
  typeof sendEligibilityResultSchema
>;

// ─── Facts ───────────────────────────────────────────────────────────────────

const countryCode = z.string().regex(/^[A-Z]{2}$/);

/** What the rules read, gathered by the database layer for one workspace at one time. */
export const sendEligibilityFactsSchema = z.strictObject({
  asOf: z.iso.datetime(),
  workspace: z.strictObject({
    outboundSendingEnabled: z.boolean(),
    /** An entitled subscription exists. */
    planEntitled: z.boolean(),
    /** EMAILS_SENT allowed per period (0 when there is no plan). */
    emailsPerPeriod: z.int().min(0),
    /** Null: not set (or stored out of shape): nothing is allowed. */
    policy: sendPolicySchema.nullable(),
  }),
  campaign: z.strictObject({
    id: z.uuid(),
    status: z.enum(CAMPAIGN_STATUSES),
    exclusions: exclusionsSchema,
    /** The campaign's mailbox, if it has one. */
    sender: z
      .strictObject({
        status: z.enum([
          'PENDING',
          'ACTIVE',
          'PAUSED',
          'DISCONNECTED',
          'ERROR',
        ]),
        hasCredentials: z.boolean(),
      })
      .nullable(),
  }),
  contact: z.strictObject({
    id: z.uuid(),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
    /** normalizeEmail's address, or null. */
    email: z.string().min(3).max(254).nullable(),
    countryCode: countryCode.nullable(),
    organization: z
      .strictObject({
        /** normalizeDomain's domain, or null. */
        domain: z.string().max(253).nullable(),
        countryCode: countryCode.nullable(),
      })
      .nullable(),
  }),
  /** The newest check of the current address (emailCheckSchema), or null. Parsed by the rules. */
  emailCheck: z.unknown(),
  /** Suppression entries that may match: addresses and domains, normalized. */
  suppressions: z.strictObject({
    emails: z.array(z.string()).max(10),
    domains: z.array(z.string()).max(10),
  }),
  /** Lead lists the person is on. */
  leadListIds: z.array(z.uuid()).max(1000),
  /** The person's pending or active enrollments in other campaigns. */
  otherCampaignEnrollments: z.int().min(0),
  /** Where the person's details came from (their source records' providers). */
  sources: z.array(z.enum(SEND_POLICY_SOURCES)).max(SEND_POLICY_SOURCES.length),
});

export type SendEligibilityFacts = z.input<typeof sendEligibilityFactsSchema>;

// ─── The rules ───────────────────────────────────────────────────────────────

type Reasons = Record<SendEligibilityCheckKey, SendEligibilityReason[]>;

const block = (
  code: SendEligibilityReasonCode,
  message: string,
): SendEligibilityReason => ({
  code,
  status: 'blocked',
  overridable: false,
  message,
});

const review = (
  code: SendEligibilityReasonCode,
  message: string,
): SendEligibilityReason => ({
  code,
  status: 'review',
  overridable: true,
  message,
});

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1);

function verificationReasons(
  facts: z.output<typeof sendEligibilityFactsSchema>,
): SendEligibilityReason[] {
  const email = facts.contact.email;
  if (email === null) {
    return [block('no_email', 'The person has no email address.')];
  }
  // The 08A rule: only a well-formed check of this address, not from the future, counts.
  const decision = emailSendEligibility(
    email,
    facts.emailCheck,
    new Date(facts.asOf),
  );
  switch (decision.state) {
    case 'eligible':
      return [];
    case 'stale':
      return [
        review(
          'verification_stale',
          `The address was verified more than ${String(VERIFICATION_MAX_AGE_DAYS)} days ago. Check it again, or a person must decide.`,
        ),
      ];
    case 'needs_review':
      return emailCheckSchema.safeParse(facts.emailCheck).data?.status ===
        'risky'
        ? [review('email_risky', decision.reason)]
        : [review('email_unknown', decision.reason)];
    case 'blocked':
      return [block('email_invalid', decision.reason)];
    case 'unverified':
      return [
        block(
          'email_not_verified',
          "The address hasn't been checked. Check it before anything is sent.",
        ),
      ];
  }
}

function sourceReasons(
  sources: readonly SendPolicySource[],
  policy: SendPolicy | null,
): SendEligibilityReason[] {
  if (sources.length === 0) {
    return [
      review(
        'source_unknown',
        "Where this person's details came from isn't recorded.",
      ),
    ];
  }
  if (policy === null) {
    return [
      review(
        'source_policy_unknown',
        "The workspace hasn't said whether contacts from its sources may be emailed.",
      ),
    ];
  }
  const reasons: SendEligibilityReason[] = [];
  for (const source of [...new Set(sources)].sort()) {
    const label = SEND_POLICY_SOURCE_LABELS[source];
    const action = policy.sources[source];
    if (action === 'BLOCK') {
      reasons.push(
        block(
          'source_blocked',
          `The workspace doesn't allow emailing contacts from ${label}.`,
        ),
      );
    } else if (action === 'REVIEW') {
      reasons.push(
        review(
          'source_review',
          `The workspace asks a person to decide for contacts from ${label}.`,
        ),
      );
    } else if (action === undefined) {
      reasons.push(
        review(
          'source_policy_unknown',
          `The workspace hasn't said whether contacts from ${label} may be emailed.`,
        ),
      );
    }
  }
  return reasons;
}

/**
 * The recipient's own country decides (the company's country never grants permission); a
 * company country the policy blocks also blocks.
 */
function regionReasons(
  facts: z.output<typeof sendEligibilityFactsSchema>,
): SendEligibilityReason[] {
  const policy = facts.workspace.policy;
  if (policy === null) {
    return [
      review(
        'region_policy_unknown',
        "The workspace hasn't set which countries may be emailed.",
      ),
    ];
  }
  const { countries, otherCountries } = policy.regions;
  const reasons: SendEligibilityReason[] = [];
  const country = facts.contact.countryCode;
  const other = (code: SendEligibilityReasonCode, message: string) =>
    otherCountries === 'BLOCK' ? block(code, message) : review(code, message);
  if (country === null) {
    reasons.push(other('country_unknown', "The person's country isn't known."));
  } else {
    const action = countries[country];
    if (action === 'BLOCK') {
      reasons.push(
        block(
          'region_blocked',
          `The workspace doesn't allow emailing people in ${country}.`,
        ),
      );
    } else if (action === 'REVIEW') {
      reasons.push(
        review(
          'region_review',
          `The workspace asks a person to decide for people in ${country}.`,
        ),
      );
    } else if (action === undefined) {
      reasons.push(
        other(
          'region_not_listed',
          `The workspace's policy doesn't name ${country}.`,
        ),
      );
    }
  }
  const companyCountry = facts.contact.organization?.countryCode ?? null;
  if (
    companyCountry !== null &&
    companyCountry !== country &&
    countries[companyCountry] === 'BLOCK'
  ) {
    reasons.push(
      block(
        'company_region_blocked',
        `The person's company is in ${companyCountry}, which the workspace doesn't allow emailing.`,
      ),
    );
  }
  return reasons;
}

/**
 * Whether a campaign may email a person now, with every reason. Takes no score: fit can't
 * change eligibility. Facts out of shape are refused (thrown), never guessed.
 */
export function evaluateSendEligibility(
  raw: SendEligibilityFacts,
): SendEligibilityResult {
  const facts = sendEligibilityFactsSchema.parse(raw);
  const reasons: Reasons = {
    workspace: [],
    campaign: [],
    sender: [],
    contact: [],
    suppression: [],
    exclusions: [],
    verification: [],
    source: [],
    region: [],
  };
  const { workspace, campaign, contact } = facts;

  if (!workspace.outboundSendingEnabled) {
    reasons.workspace.push(
      block('sending_disabled', 'Sending is turned off for this workspace.'),
    );
  }
  if (!workspace.planEntitled) {
    reasons.workspace.push(
      block('no_entitled_plan', 'This workspace has no active plan.'),
    );
  } else if (workspace.emailsPerPeriod <= 0) {
    reasons.workspace.push(
      block(
        'plan_excludes_email',
        "The workspace's plan doesn't include sending email.",
      ),
    );
  }

  if (campaign.status !== 'ACTIVE') {
    reasons.campaign.push(
      block(
        'campaign_not_active',
        `The campaign isn't running (it is ${campaign.status.toLowerCase()}).`,
      ),
    );
  }
  if (campaign.sender === null) {
    reasons.sender.push(
      block('sender_missing', 'The campaign has no sending mailbox.'),
    );
  } else if (
    campaign.sender.status !== 'ACTIVE' ||
    !campaign.sender.hasCredentials
  ) {
    reasons.sender.push(
      block(
        'sender_not_ready',
        "The campaign's mailbox isn't connected and active.",
      ),
    );
  }

  if (contact.status === 'ARCHIVED') {
    reasons.contact.push(block('contact_archived', 'The person is archived.'));
  }

  const email = contact.email;
  const domains = [
    ...new Set(
      [
        email === null ? null : domainOf(email),
        contact.organization?.domain ?? null,
      ].filter((value): value is string => value !== null),
    ),
  ];
  if (email !== null && facts.suppressions.emails.includes(email)) {
    reasons.suppression.push(
      block('suppressed_email', 'The address is on the do-not-contact list.'),
    );
  }
  if (domains.some((domain) => facts.suppressions.domains.includes(domain))) {
    reasons.suppression.push(
      block(
        'suppressed_domain',
        "The person's domain is on the do-not-contact list.",
      ),
    );
  }

  const { exclusions } = campaign;
  if (email !== null && exclusions.emails.includes(email)) {
    reasons.exclusions.push(
      block('excluded_email', 'The campaign leaves out this address.'),
    );
  }
  if (domains.some((domain) => exclusions.domains.includes(domain))) {
    reasons.exclusions.push(
      block('excluded_domain', "The campaign leaves out the person's domain."),
    );
  }
  if (facts.leadListIds.some((id) => exclusions.leadListIds.includes(id))) {
    reasons.exclusions.push(
      block(
        'excluded_lead_list',
        'The person is on a lead list the campaign leaves out.',
      ),
    );
  }
  if (
    exclusions.skipContactsInOtherCampaigns &&
    facts.otherCampaignEnrollments > 0
  ) {
    reasons.exclusions.push(
      block(
        'in_other_campaign',
        'The person is already in another campaign, and this campaign leaves such people out.',
      ),
    );
  }

  reasons.verification.push(...verificationReasons(facts));
  reasons.source.push(...sourceReasons(facts.sources, workspace.policy));
  reasons.region.push(...regionReasons(facts));

  const checks = SEND_ELIGIBILITY_CHECKS.map((check) => {
    const list = reasons[check.key];
    return {
      key: check.key,
      label: check.label,
      scope: check.scope,
      status: list.some((reason) => reason.status === 'blocked')
        ? ('blocked' as const)
        : list.length > 0
          ? ('review' as const)
          : ('pass' as const),
      reasons: list,
    };
  });
  return {
    rules: SEND_ELIGIBILITY_RULES,
    status: checks.some((check) => check.status === 'blocked')
      ? 'blocked'
      : checks.some((check) => check.status === 'review')
        ? 'review'
        : 'eligible',
    evaluatedAt: facts.asOf,
    checks,
  };
}

// ─── Fit and eligibility together ────────────────────────────────────────────

/** A lead's fit: its current lead score (task 10A). */
export const leadFitSchema = z.strictObject({
  scoreId: z.uuid(),
  version: z.int().min(1),
  value: z.int().min(0).max(100),
  band: z.enum(LEAD_SCORE_BANDS),
  scoredAt: z.iso.datetime(),
});

export type LeadFit = z.output<typeof leadFitSchema>;

export interface LeadSendDecision {
  /** How well the person fits, or null when they haven't been scored. */
  readonly fit: LeadFit | null;
  /** Whether the campaign may email them, decided without the score. */
  readonly eligibility: SendEligibilityResult;
  /** Only eligibility decides: true only when every check passes. */
  readonly sendPermitted: boolean;
  /** A review reason and no block: a person must decide (task 10C). */
  readonly needsPerson: boolean;
}

/**
 * Puts the two results side by side. The fit is reported, never used: a score of 100 doesn't
 * permit sending to a person who is blocked or needs review.
 */
export function leadSendDecision(
  fit: LeadFit | null,
  eligibility: SendEligibilityResult,
): LeadSendDecision {
  return {
    fit,
    eligibility,
    sendPermitted: eligibility.status === 'eligible',
    needsPerson: eligibility.status === 'review',
  };
}

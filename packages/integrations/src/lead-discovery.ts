// LeadDiscoveryService (task 07A, docs/decisions.md D-07A-03): finds companies for an ICP
// through an OrganizationSearchProvider. It plans the search first (nothing is requested for a
// search that can't run), pages through the provider up to the requested number, validates
// every record (provider data is untrusted), normalizes company identities, drops duplicates
// within the run, and keeps where each company came from. It finds companies only: people
// search and contact enrichment are separate steps. Persisting results is the caller's job.
import {
  IdentityNormalizationError,
  normalizeCompanyIdentity,
  planOrganizationSearch,
  type CompanyIdentity,
  type DiscoveryProvider,
  type OrganizationSearchPlan,
  type PlanIssue,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type {
  OrganizationSearchProvider,
  ProviderOrganization,
  ProviderQuota,
} from './providers.js';

/** The search can't run as asked; `issues` say why, per field. */
export class DiscoveryPlanError extends Error {
  override readonly name = 'DiscoveryPlanError';

  constructor(readonly issues: readonly PlanIssue[]) {
    super('The search cannot run as asked');
  }
}

/** A company found by a search, ready to be saved (by 07C). */
export interface DiscoveredOrganization {
  readonly identity: CompanyIdentity;
  readonly websiteUrl: string | null;
  readonly industry: string | null;
  readonly employeeCount: number | null;
  readonly countryCode: string | null;
  /** Provenance: which provider, which record, when, under which attribution. */
  readonly source: {
    readonly provider: DiscoveryProvider;
    readonly externalId: string;
    readonly retrievedAt: Date;
    readonly attribution: string;
  };
  /** The record as received. Untrusted: never executed, escaped when shown. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** A provider record that couldn't be used: its id if it had one, and what was received. */
export interface RejectedRecord {
  readonly externalId: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface DiscoveryPage {
  /** 1-based. */
  readonly number: number;
  readonly organizations: readonly DiscoveredOrganization[];
  /** Records the provider returned on this page. */
  readonly received: number;
  /** Records of a company already found in this run (same identity). */
  readonly duplicates: number;
  /** Records that failed validation or had no usable name. */
  readonly invalid: number;
  /** Those records, so they can be reported (untrusted; never executed). */
  readonly rejected: readonly RejectedRecord[];
  /** Where the next page starts; null when the search is done. Saved to resume. */
  readonly nextPageToken: string | null;
  readonly retrievedAt: Date;
  readonly quota: ProviderQuota | null;
  readonly creditsUsed: number | null;
}

export interface DiscoveryResult {
  readonly provider: DiscoveryProvider;
  readonly attribution: string;
  readonly organizations: readonly DiscoveredOrganization[];
  readonly pages: number;
  readonly received: number;
  readonly duplicates: number;
  readonly invalid: number;
  /** Summed over pages; null when the provider never reported a cost. */
  readonly creditsUsed: number | null;
  /** As of the last page. */
  readonly quota: ProviderQuota | null;
}

/** What a provider record must look like before it is used. */
const providerOrganizationSchema = z
  .object({
    externalId: z.string().trim().min(1).max(200),
    name: z.string().max(300),
    domain: z.string().max(2048).nullable(),
    websiteUrl: z.string().max(2048).nullable(),
    industry: z.string().trim().max(200).nullable(),
    employeeCount: z.number().int().min(0).max(10_000_000).nullable(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    raw: z.record(z.string(), z.unknown()),
  })
  .strict();

/** What can be kept of a record that failed validation. */
function rejectedOf(record: unknown): RejectedRecord {
  const value =
    typeof record === 'object' && record !== null
      ? (record as Record<string, unknown>)
      : {};
  const externalId = value['externalId'];
  const raw = value['raw'];
  return {
    externalId:
      typeof externalId === 'string' && externalId.trim() !== ''
        ? externalId.slice(0, 200)
        : null,
    raw:
      typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {},
  };
}

const safeWebsite = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

export class LeadDiscoveryService {
  constructor(private readonly provider: OrganizationSearchProvider) {}

  /** The search for these criteria, or DiscoveryPlanError. Requests nothing. */
  plan(criteria: unknown, maxResults: number): OrganizationSearchPlan {
    const planned = planOrganizationSearch(
      criteria,
      maxResults,
      this.provider.capabilities,
    );
    if (!planned.ok) {
      throw new DiscoveryPlanError(planned.issues);
    }
    return planned.plan;
  }

  /**
   * Pages of new companies until `plan.maxResults` are found or the provider has no more.
   * `resume` continues an interrupted run: the token to start from and the identities already
   * found. Provider errors (ProviderError) end the iteration; the caller records them.
   */
  async *pages(
    plan: OrganizationSearchPlan,
    resume: {
      readonly pageToken?: string | null;
      readonly seen?: Iterable<string>;
      readonly found?: number;
    } = {},
  ): AsyncGenerator<DiscoveryPage> {
    const { capabilities, source } = this.provider;
    const seen = new Set(resume.seen ?? []);
    let found = resume.found ?? 0;
    let pageToken = resume.pageToken ?? null;
    // A provider that keeps returning pages without new companies must still end.
    const maxPages =
      Math.ceil(plan.maxResults / capabilities.maxPageSize) * 2 + 2;
    for (
      let number = 1;
      number <= maxPages && found < plan.maxResults;
      number += 1
    ) {
      const page = await this.provider.searchOrganizations({
        filters: plan.filters,
        pageSize: Math.min(capabilities.maxPageSize, plan.maxResults - found),
        pageToken,
      });
      const organizations: DiscoveredOrganization[] = [];
      const rejected: RejectedRecord[] = [];
      let duplicates = 0;
      let invalid = 0;
      for (const record of page.organizations) {
        const discovered = this.normalize(record, page.retrievedAt, source);
        if (discovered === null) {
          invalid += 1;
          rejected.push(rejectedOf(record));
        } else if (seen.has(discovered.identity.key)) {
          duplicates += 1;
        } else if (found < plan.maxResults) {
          seen.add(discovered.identity.key);
          organizations.push(discovered);
          found += 1;
        }
      }
      pageToken = page.nextPageToken;
      yield {
        number,
        organizations,
        received: page.organizations.length,
        duplicates,
        invalid,
        rejected,
        nextPageToken: found < plan.maxResults ? pageToken : null,
        retrievedAt: page.retrievedAt,
        quota: page.quota,
        creditsUsed: page.creditsUsed,
      };
      if (pageToken === null || page.organizations.length === 0) {
        return;
      }
    }
  }

  /** The whole search at once (small searches and tests). */
  async run(plan: OrganizationSearchPlan): Promise<DiscoveryResult> {
    const organizations: DiscoveredOrganization[] = [];
    let pages = 0;
    let received = 0;
    let duplicates = 0;
    let invalid = 0;
    let creditsUsed: number | null = null;
    let quota: ProviderQuota | null = null;
    for await (const page of this.pages(plan)) {
      organizations.push(...page.organizations);
      pages += 1;
      received += page.received;
      duplicates += page.duplicates;
      invalid += page.invalid;
      if (page.creditsUsed !== null) {
        creditsUsed = (creditsUsed ?? 0) + page.creditsUsed;
      }
      quota = page.quota ?? quota;
    }
    return {
      provider: this.provider.source,
      attribution: this.provider.capabilities.attribution,
      organizations,
      pages,
      received,
      duplicates,
      invalid,
      creditsUsed,
      quota,
    };
  }

  /** A validated, normalized company, or null for a record that can't be used. */
  private normalize(
    record: ProviderOrganization,
    retrievedAt: Date,
    provider: DiscoveryProvider,
  ): DiscoveredOrganization | null {
    const parsed = providerOrganizationSchema.safeParse(record);
    if (!parsed.success) {
      return null;
    }
    const value = parsed.data;
    let identity: CompanyIdentity;
    try {
      identity = normalizeCompanyIdentity({
        name: value.name,
        domain: value.domain,
        website: value.websiteUrl,
      });
    } catch (error) {
      if (error instanceof IdentityNormalizationError) {
        return null;
      }
      throw error;
    }
    return {
      identity,
      websiteUrl: safeWebsite(value.websiteUrl),
      industry: value.industry === '' ? null : value.industry,
      employeeCount: value.employeeCount,
      countryCode: value.countryCode,
      source: {
        provider,
        externalId: value.externalId,
        retrievedAt,
        attribution: this.provider.capabilities.attribution,
      },
      raw: value.raw,
    };
  }
}

// Saving companies found by a search or read from a CSV file (task 07C, docs/decisions.md
// D-07C-02): one place for the suppression check, the identity match and the fill-in of
// missing details, inside the caller's transaction. Writes to a workspace's organizations are
// serialized (a transaction-scoped advisory lock), so two runs can never create the same
// company twice. Every query is filtered by the tenant.
import type { CompanyIdentity } from '@lead-fennec-ai/shared';
import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/** A company to save: identity from normalizeCompanyIdentity, details as received. */
export interface IncomingOrganization {
  readonly identity: CompanyIdentity;
  readonly websiteUrl: string | null;
  readonly industry: string | null;
  readonly employeeCount: number | null;
  readonly countryCode: string | null;
}

export interface SavedIssue {
  readonly field: 'domain';
  readonly message: string;
}

export type SaveOutcome =
  | {
      readonly outcome: 'CREATED' | 'MATCHED';
      readonly organizationId: string;
    }
  | { readonly outcome: 'EXCLUDED'; readonly issues: readonly SavedIssue[] };

/** The domain and its parents, without the bare top-level label: a.b.example → b.example. */
export function domainAndParents(domain: string): string[] {
  const labels = domain.split('.');
  const result: string[] = [];
  for (let i = 0; i < labels.length - 1; i += 1) {
    result.push(labels.slice(i).join('.'));
  }
  return result;
}

const SELECT = {
  id: true,
  normalizedDomain: true,
  nameKey: true,
  websiteUrl: true,
  industry: true,
  employeeCount: true,
  countryCode: true,
} as const;

type Existing = Prisma.OrganizationGetPayload<{ select: typeof SELECT }>;

/** Only details the organization doesn't have yet: what someone saved is never overwritten. */
function missingDetails(
  existing: Existing,
  incoming: IncomingOrganization,
): Prisma.OrganizationUpdateInput {
  const fill: Prisma.OrganizationUpdateInput = {};
  if (existing.nameKey === null) {
    fill.nameKey = incoming.identity.nameKey;
  }
  if (existing.websiteUrl === null && incoming.websiteUrl !== null) {
    fill.websiteUrl = incoming.websiteUrl;
  }
  if (existing.industry === null && incoming.industry !== null) {
    fill.industry = incoming.industry;
  }
  if (existing.employeeCount === null && incoming.employeeCount !== null) {
    fill.employeeCount = incoming.employeeCount;
  }
  if (existing.countryCode === null && incoming.countryCode !== null) {
    fill.countryCode = incoming.countryCode;
  }
  return fill;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * Saves companies in order and says what happened to each:
 * - EXCLUDED: its domain, or a parent domain, is on the workspace's suppression list;
 * - MATCHED: the workspace already has it (same domain, or, without a domain, the same name
 *   key among companies without one); missing details are filled in;
 * - CREATED: new.
 * A later entry with the same identity as an earlier one is MATCHED to it.
 */
export async function saveOrganizations(
  tx: Tx,
  tenantId: string,
  incoming: readonly IncomingOrganization[],
): Promise<SaveOutcome[]> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`organizations:${tenantId}`}, 0))`;
  const domains = unique(
    incoming.flatMap((o) =>
      o.identity.domain === null ? [] : [o.identity.domain],
    ),
  );
  const nameKeys = unique(
    incoming
      .filter((o) => o.identity.domain === null)
      .map((o) => o.identity.nameKey),
  );
  const checked = unique(domains.flatMap(domainAndParents));
  const suppressed = new Set(
    checked.length === 0
      ? []
      : (
          await tx.suppression.findMany({
            where: { tenantId, normalizedDomain: { in: checked } },
            select: { normalizedDomain: true },
          })
        ).flatMap((row) =>
          row.normalizedDomain === null ? [] : [row.normalizedDomain],
        ),
  );
  const byDomain = new Map<string, Existing>();
  if (domains.length > 0) {
    for (const row of await tx.organization.findMany({
      where: { tenantId, normalizedDomain: { in: domains } },
      select: SELECT,
    })) {
      if (row.normalizedDomain !== null) {
        byDomain.set(row.normalizedDomain, row);
      }
    }
  }
  const byName = new Map<string, Existing>();
  if (nameKeys.length > 0) {
    for (const row of await tx.organization.findMany({
      where: { tenantId, normalizedDomain: null, nameKey: { in: nameKeys } },
      orderBy: { id: 'asc' },
      select: SELECT,
    })) {
      if (row.nameKey !== null && !byName.has(row.nameKey)) {
        byName.set(row.nameKey, row);
      }
    }
  }

  const outcomes: SaveOutcome[] = [];
  for (const organization of incoming) {
    const { identity } = organization;
    if (identity.domain !== null) {
      const hit = domainAndParents(identity.domain).find((d) =>
        suppressed.has(d),
      );
      if (hit !== undefined) {
        outcomes.push({
          outcome: 'EXCLUDED',
          issues: [
            {
              field: 'domain',
              message: `The domain ${hit} is on this workspace's suppression list.`,
            },
          ],
        });
        continue;
      }
    }
    const existing =
      identity.domain === null
        ? byName.get(identity.nameKey)
        : byDomain.get(identity.domain);
    if (existing !== undefined) {
      const fill = missingDetails(existing, organization);
      if (Object.keys(fill).length > 0) {
        const updated = await tx.organization.update({
          where: { tenantId_id: { tenantId, id: existing.id } },
          data: fill,
          select: SELECT,
        });
        Object.assign(existing, updated);
      }
      outcomes.push({ outcome: 'MATCHED', organizationId: existing.id });
      continue;
    }
    const created = await tx.organization.create({
      data: {
        tenantId,
        name: identity.name,
        normalizedDomain: identity.domain,
        nameKey: identity.nameKey,
        websiteUrl: organization.websiteUrl,
        industry: organization.industry,
        employeeCount: organization.employeeCount,
        countryCode: organization.countryCode,
      },
      select: SELECT,
    });
    if (identity.domain === null) {
      byName.set(identity.nameKey, created);
    } else {
      byDomain.set(identity.domain, created);
    }
    outcomes.push({ outcome: 'CREATED', organizationId: created.id });
  }
  return outcomes;
}

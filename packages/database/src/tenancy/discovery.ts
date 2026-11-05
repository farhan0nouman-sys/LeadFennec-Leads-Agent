// Lead discovery requests (task 07A, docs/decisions.md D-07A-*). A request turns one of the
// workspace's ICPs into an organization search: the filters are checked against what the
// provider declares it supports, then the request is stored as an import (inputs and source
// metadata) together with a durable job task, in one transaction. Running the search and
// saving companies are the job's work (07C); nothing here contacts a provider or touches
// contacts. Reads and requests need imports.create.
import {
  DISCOVERY_DEFAULT_RESULTS,
  DISCOVERY_PROVIDERS,
  discoveryRequestSchema,
  organizationSearchFiltersSchema,
  PEOPLE_FILTER_KEYS,
  planOrganizationSearch,
  type DiscoveryProvider,
  type ImportRun,
  type OrganizationSearchCapabilities,
  type PlanIssue,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type { Import, PrismaClient } from '../generated/prisma/client.js';
import { payloadSha256 } from '../payload-hash.js';
import { uuidSchema, type TenantActor } from './actors.js';
import { writeAuditRecord } from './audit.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermission,
} from './authorization.js';

/** The job a request queues; its payload is only the import id. */
export const DISCOVERY_TASK_TYPE = 'lead_discovery.search';

/** The request can't become a search; `issues` say why, per field. */
export class DiscoveryRequestError extends Error {
  constructor(readonly issues: readonly PlanIssue[]) {
    super('The discovery request is not valid');
    this.name = 'DiscoveryRequestError';
  }
}

/** The configured provider, as the request sees it: who it is and what it supports. */
export interface DiscoveryProviderInfo {
  readonly source: DiscoveryProvider;
  readonly capabilities: OrganizationSearchCapabilities;
}

/** A run as the contract describes it, with Date timestamps. */
export type DiscoveryRun = Omit<
  ImportRun,
  'createdAt' | 'startedAt' | 'completedAt'
> & {
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
};

export interface DiscoveryRepository {
  /** Creates a PENDING search import and its queued task (imports.create, members only). */
  request(
    input: z.input<typeof discoveryRequestSchema>,
    provider: DiscoveryProviderInfo,
  ): Promise<DiscoveryRun>;
  /** One import of the workspace (imports.create). */
  get(runId: string): Promise<DiscoveryRun>;
}

/** What source_metadata holds; read back through this schema. */
const sourceMetadataSchema = z
  .object({
    attribution: z.string(),
    ignoredCriteria: z.array(z.enum(PEOPLE_FILTER_KEYS)),
    capabilities: z
      .object({
        supportedFilters: z.array(z.string()),
        maxPageSize: z.number().int().min(1),
        maxResultsPerSearch: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

const NOT_FOUND = 'Not found in this workspace.';

function toRun(row: Import): DiscoveryRun {
  let search: DiscoveryRun['search'] = null;
  if (row.source === 'ORGANIZATION_SEARCH') {
    const metadata = sourceMetadataSchema.parse(row.sourceMetadata);
    search = {
      icpId: z.uuid().parse(row.icpId),
      provider: z.enum(DISCOVERY_PROVIDERS).parse(row.searchProvider),
      filters: organizationSearchFiltersSchema.parse(row.searchFilters),
      maxResults: z.number().int().min(1).parse(row.resultLimit),
      ignoredCriteria: metadata.ignoredCriteria,
      attribution: metadata.attribution,
    };
  }
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    search,
    counts: {
      found: row.totalRows,
      saved: row.importedRows,
      skipped: row.skippedRows,
      failed: row.failedRows,
    },
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export function createDiscoveryRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
): DiscoveryRepository {
  return {
    async request(rawInput, provider) {
      const member = requirePermission(actor, 'imports.create');
      const input = discoveryRequestSchema.parse(rawInput);
      const maxResults = input.maxResults ?? DISCOVERY_DEFAULT_RESULTS;
      return prisma.$transaction(async (tx) => {
        const icp = await tx.icp.findUnique({
          where: { tenantId_id: { tenantId, id: input.icpId } },
          select: { id: true, status: true, criteria: true },
        });
        // Another workspace's ICP reads exactly like a missing one.
        if (icp === null) {
          throw new DiscoveryRequestError([
            { path: 'icpId', message: NOT_FOUND },
          ]);
        }
        if (icp.status === 'ARCHIVED') {
          throw new DiscoveryRequestError([
            {
              path: 'icpId',
              message: 'This ideal customer profile is archived.',
            },
          ]);
        }
        const planned = planOrganizationSearch(
          icp.criteria,
          maxResults,
          provider.capabilities,
        );
        if (!planned.ok) {
          throw new DiscoveryRequestError(planned.issues);
        }
        const { plan } = planned;
        const { capabilities } = provider;
        const row = await tx.import.create({
          data: {
            tenantId,
            source: 'ORGANIZATION_SEARCH',
            icpId: icp.id,
            searchProvider: provider.source,
            searchFilters: plan.filters,
            resultLimit: plan.maxResults,
            querySha256: payloadSha256({
              provider: provider.source,
              filters: plan.filters,
              maxResults: plan.maxResults,
            }),
            sourceMetadata: {
              attribution: capabilities.attribution,
              ignoredCriteria: [...plan.ignoredCriteria],
              capabilities: {
                supportedFilters: [...capabilities.supportedFilters],
                maxPageSize: capabilities.maxPageSize,
                maxResultsPerSearch: capabilities.maxResultsPerSearch,
              },
            },
          },
        });
        // The durable task; a queue message will name only its id (D-04B-05).
        await tx.jobTask.create({
          data: {
            tenantId,
            taskType: DISCOVERY_TASK_TYPE,
            idempotencyKey: `import:${row.id}`,
            payload: { importId: row.id },
          },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'lead_discovery.requested',
          targetType: 'import',
          targetId: row.id,
          metadata: {
            icpId: icp.id,
            provider: provider.source,
            maxResults: plan.maxResults,
          },
        });
        return toRun(row);
      });
    },

    async get(rawId) {
      requireReadPermission(actor, 'imports.create');
      const parsed = uuidSchema.safeParse(rawId);
      if (!parsed.success) {
        throw new RecordNotFoundError('import');
      }
      const row = await prisma.import.findUnique({
        where: { tenantId_id: { tenantId, id: parsed.data } },
      });
      if (row === null) {
        throw new RecordNotFoundError('import');
      }
      return toRun(row);
    },
  };
}

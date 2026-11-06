// Lead discovery (tasks 07A and 07C, docs/decisions.md D-07A-* and D-07C-*). Members request
// organization searches from the workspace's ICPs and import companies from CSV files; the
// search worker runs a request page by page. Every run is an `imports` row; every record it
// received is a `source_records` row with its outcome (created, matched, excluded, failed),
// so the counts and the results always agree. Companies are saved through saveOrganizations
// (suppression check, identity match, no duplicates). Nothing here touches contacts.
import {
  CsvError,
  DISCOVERY_DEFAULT_RESULTS,
  DISCOVERY_MAX_RESULTS,
  DISCOVERY_PROVIDERS,
  IMPORT_RESULT_OUTCOMES,
  ORGANIZATION_IMPORT_FIELDS,
  ORGANIZATION_IMPORT_LIMITS,
  PEOPLE_FILTER_KEYS,
  cancelImportRequestSchema,
  csvImportRequestSchema,
  discoveryRequestSchema,
  importResultsQuerySchema,
  normalizeImportRow,
  organizationSearchFiltersSchema,
  parseCsv,
  planOrganizationSearch,
  type DiscoveryProvider,
  type ImportOptions,
  type ImportResult,
  type ImportRun,
  type OrganizationImportField,
  type OrganizationSearchCapabilities,
  type OrganizationSearchPlan,
  type PlanIssue,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type {
  Import,
  ImportStatus,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client.js';
import { paginate, type Page, type PageRequest } from '../pagination.js';
import { payloadSha256 } from '../payload-hash.js';
import {
  ActorNotAllowedError,
  uuidSchema,
  type TenantActor,
} from './actors.js';
import { writeAuditRecord } from './audit.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermission,
} from './authorization.js';
import {
  saveOrganizations,
  type IncomingOrganization,
  type SaveOutcome,
} from './organization-store.js';

/** The job a request queues; its payload is only the import id. */
export const DISCOVERY_TASK_TYPE = 'lead_discovery.search';

/** The request can't become a search; `issues` say why, per field. */
export class DiscoveryRequestError extends Error {
  constructor(readonly issues: readonly PlanIssue[]) {
    super('The discovery request is not valid');
    this.name = 'DiscoveryRequestError';
  }
}

/** The CSV file or its mapping can't be imported; `issues` say why. */
export class CsvImportError extends Error {
  constructor(readonly issues: readonly PlanIssue[]) {
    super('The CSV import is not valid');
    this.name = 'CsvImportError';
  }
}

/** The import already finished: it can't be cancelled. */
export class ImportNotCancellableError extends Error {
  constructor() {
    super('The import already finished');
    this.name = 'ImportNotCancellableError';
  }
}

/** The configured provider, as a request sees it: who it is and what it supports. */
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

/** One page of a search, as the worker hands it over (LeadDiscoveryService's DiscoveryPage). */
export interface SearchPageInput {
  readonly organizations: readonly (IncomingOrganization & {
    readonly source: {
      readonly provider: DiscoveryProvider;
      readonly externalId: string;
      readonly retrievedAt: Date;
    };
    readonly raw: Readonly<Record<string, unknown>>;
  })[];
  /** Records the provider sent that couldn't be used. */
  readonly rejected: readonly {
    readonly externalId: string | null;
    readonly raw: Readonly<Record<string, unknown>>;
  }[];
  /** Records on the page, repeats included. */
  readonly received: number;
  readonly nextPageToken: string | null;
}

/** Where a search stands when the worker picks it up. */
export type SearchStart =
  | {
      readonly state: 'run';
      readonly provider: DiscoveryProvider;
      readonly plan: OrganizationSearchPlan;
      readonly resume: {
        readonly pageToken: string | null;
        readonly seen: readonly string[];
        readonly found: number;
      };
      readonly pagesFetched: number;
    }
  /** Every page is saved; only finishing is left. */
  | { readonly state: 'finish' }
  /** Not to be run: cancelled, finished, or not a search. */
  | { readonly state: 'stopped'; readonly status: ImportStatus };

export interface DiscoveryRepository {
  /** Creates a PENDING search import and its queued task (imports.create, members only). */
  request(
    input: z.input<typeof discoveryRequestSchema>,
    provider: DiscoveryProviderInfo,
  ): Promise<DiscoveryRun>;
  /** One import of the workspace (imports.create). */
  get(runId: string): Promise<DiscoveryRun>;
  /** The workspace's imports and searches, newest first (imports.create). */
  list(page: PageRequest): Promise<Page<DiscoveryRun>>;
  /** What happened to each record of a run, in order (imports.create). */
  results(
    runId: string,
    query: z.input<typeof importResultsQuerySchema>,
  ): Promise<Page<ImportResult>>;
  /** What the import screens offer (imports.create). */
  options(provider: DiscoveryProviderInfo): Promise<ImportOptions>;
  /** Stops a queued or running search (imports.create, members only); repeatable. */
  cancel(
    runId: string,
    input?: z.input<typeof cancelImportRequestSchema>,
  ): Promise<DiscoveryRun>;
  /** Imports companies from a CSV file with a column mapping (imports.create, members only). */
  importCsv(
    input: z.input<typeof csvImportRequestSchema>,
  ): Promise<DiscoveryRun>;
  /** Workers: marks the search PROCESSING (or resumes it) and says how to run it. */
  beginSearch(runId: string): Promise<SearchStart>;
  /** Workers: saves one page and its counts and resume token, all or nothing. */
  saveSearchPage(
    runId: string,
    page: SearchPageInput,
  ): Promise<{ readonly state: 'continue' | 'done' | 'stopped' }>;
  /** Workers: marks a running search COMPLETED. */
  finishSearch(runId: string): Promise<DiscoveryRun>;
  /** Workers: records why a search stopped; `final` marks it FAILED, else it will be retried. */
  failSearch(runId: string, errorCode: string, final: boolean): Promise<void>;
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

/** What every result's payload carries for display; the rest stays as received. */
const displaySchema = z.looseObject({
  name: z.string().nullish(),
  domain: z.string().nullish(),
});

const issuesSchema = z.array(
  z
    .object({
      field: z.enum([...ORGANIZATION_IMPORT_FIELDS, 'row']),
      message: z.string(),
    })
    .strict(),
);

const errorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

const NOT_FOUND = 'Not found in this workspace.';

/** A provider record as plain JSON (a round trip drops anything that isn't data). */
const asJson = (
  value: Readonly<Record<string, unknown>>,
): Prisma.InputJsonObject =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
const REJECTED_RECORD = {
  field: 'row',
  message: 'The provider sent a record without a usable name or id.',
} as const;

function toRun(row: Import, created: number): DiscoveryRun {
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
  const handled = row.importedRows + row.skippedRows + row.failedRows;
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    search,
    fileName: row.fileName,
    counts: {
      found: row.totalRows,
      saved: row.importedRows,
      created,
      excluded: row.skippedRows,
      failed: row.failedRows,
      repeated: Math.max(0, row.totalRows - handled),
    },
    pagesFetched: row.pagesFetched,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

/** Where saved outcomes go in source_records. */
function recordOf(outcome: SaveOutcome) {
  return outcome.outcome === 'EXCLUDED'
    ? {
        outcome: 'EXCLUDED' as const,
        organizationId: null,
        issues: outcome.issues.map((issue) => ({ ...issue })),
      }
    : {
        outcome: outcome.outcome,
        organizationId: outcome.organizationId,
        issues: undefined,
      };
}

export function createDiscoveryRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): DiscoveryRepository {
  const worker = (operation: string) => {
    if (actor.kind !== 'system') {
      throw new ActorNotAllowedError(operation);
    }
  };

  const idOrNotFound = (rawId: string) => {
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new RecordNotFoundError('import');
    }
    return parsed.data;
  };

  async function createdCounts(
    db: Prisma.TransactionClient | PrismaClient,
    ids: readonly string[],
  ): Promise<Map<string, number>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await db.sourceRecord.groupBy({
      by: ['importId'],
      where: { tenantId, importId: { in: [...ids] }, outcome: 'CREATED' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.importId ?? '', r._count._all]));
  }

  async function runOf(
    db: Prisma.TransactionClient | PrismaClient,
    row: Import,
  ): Promise<DiscoveryRun> {
    const created = await createdCounts(db, [row.id]);
    return toRun(row, created.get(row.id) ?? 0);
  }

  /** The import row, locked for this transaction; not found otherwise. */
  async function locked(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Import> {
    await tx.$queryRaw`SELECT id FROM imports WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const row = await tx.import.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
    if (row === null) {
      throw new RecordNotFoundError('import');
    }
    return row;
  }

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
        // The durable task; the worker's relay publishes { v: 1, taskId } (D-07C-01).
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
        return toRun(row, 0);
      });
    },

    async get(rawId) {
      requireReadPermission(actor, 'imports.create');
      const id = idOrNotFound(rawId);
      const row = await prisma.import.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (row === null) {
        throw new RecordNotFoundError('import');
      }
      return runOf(prisma, row);
    },

    async list(page) {
      requireReadPermission(actor, 'imports.create');
      const result = await paginate(page, (keyset) =>
        prisma.import.findMany({
          where: { tenantId, ...keyset.cursorWhere },
          orderBy: keyset.orderBy,
          take: keyset.take,
        }),
      );
      const created = await createdCounts(
        prisma,
        result.items.map((row) => row.id),
      );
      return {
        nextCursor: result.nextCursor,
        items: result.items.map((row) => toRun(row, created.get(row.id) ?? 0)),
      };
    },

    async results(rawId, rawQuery) {
      requireReadPermission(actor, 'imports.create');
      const id = idOrNotFound(rawId);
      const query = importResultsQuerySchema.parse(rawQuery);
      const exists = await prisma.import.findUnique({
        where: { tenantId_id: { tenantId, id } },
        select: { id: true },
      });
      if (exists === null) {
        throw new RecordNotFoundError('import');
      }
      const page = await paginate(
        {
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        },
        (keyset) =>
          prisma.sourceRecord.findMany({
            where: {
              tenantId,
              importId: id,
              outcome: query.outcome ?? { in: [...IMPORT_RESULT_OUTCOMES] },
              ...keyset.cursorWhere,
            },
            orderBy: keyset.orderBy,
            take: keyset.take,
            select: {
              id: true,
              importRowNumber: true,
              outcome: true,
              payload: true,
              externalId: true,
              organizationId: true,
              issues: true,
            },
          }),
        'oldest',
      );
      return {
        nextCursor: page.nextCursor,
        items: page.items.map((row) => {
          const display = displaySchema.safeParse(row.payload);
          return {
            id: row.id,
            position: row.importRowNumber ?? 1,
            outcome: z.enum(IMPORT_RESULT_OUTCOMES).parse(row.outcome),
            name: display.success ? (display.data.name ?? null) : null,
            domain: display.success ? (display.data.domain ?? null) : null,
            externalId: row.externalId,
            organizationId: row.organizationId,
            issues: row.issues === null ? [] : issuesSchema.parse(row.issues),
          };
        }),
      };
    },

    async options(provider) {
      requireReadPermission(actor, 'imports.create');
      const icps = await prisma.icp.findMany({
        where: { tenantId, status: { not: 'ARCHIVED' } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 200,
        select: { id: true, name: true },
      });
      const maxResults = Math.min(
        DISCOVERY_MAX_RESULTS,
        provider.capabilities.maxResultsPerSearch,
      );
      return {
        icps,
        search: {
          provider: provider.source,
          supportedFilters: [...provider.capabilities.supportedFilters],
          maxResults,
          defaultResults: Math.min(DISCOVERY_DEFAULT_RESULTS, maxResults),
          attribution: provider.capabilities.attribution,
        },
        csv: {
          maxBytes: ORGANIZATION_IMPORT_LIMITS.maxChars,
          maxRows: ORGANIZATION_IMPORT_LIMITS.maxRows,
          fields: [...ORGANIZATION_IMPORT_FIELDS],
        },
      };
    },

    async cancel(rawId, input = {}) {
      const member = requirePermission(actor, 'imports.create');
      cancelImportRequestSchema.parse(input);
      const id = idOrNotFound(rawId);
      return prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status === 'CANCELLED') {
          return runOf(tx, row);
        }
        if (row.status === 'COMPLETED' || row.status === 'FAILED') {
          throw new ImportNotCancellableError();
        }
        const updated = await tx.import.update({
          where: { tenantId_id: { tenantId, id } },
          data: { status: 'CANCELLED', completedAt: now(), cursor: null },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'lead_discovery.cancelled',
          targetType: 'import',
          targetId: id,
          metadata: { saved: updated.importedRows },
        });
        return runOf(tx, updated);
      });
    },

    async importCsv(rawInput) {
      const member = requirePermission(actor, 'imports.create');
      const input = csvImportRequestSchema.parse(rawInput);
      let table;
      try {
        table = parseCsv(input.content, ORGANIZATION_IMPORT_LIMITS);
      } catch (error) {
        if (error instanceof CsvError) {
          throw new CsvImportError([
            { path: 'content', message: error.message },
          ]);
        }
        throw error;
      }
      const columns = new Map(
        table.headers.map((name, index) => [name.toLowerCase(), index]),
      );
      const issues: PlanIssue[] = [];
      const picks: [OrganizationImportField, number][] = [];
      for (const field of ORGANIZATION_IMPORT_FIELDS) {
        const header = input.mapping[field];
        if (header === undefined) {
          continue;
        }
        const index = columns.get(header.toLowerCase());
        if (index === undefined) {
          issues.push({
            path: `mapping.${field}`,
            message: `The file has no column "${header}".`,
          });
        } else {
          picks.push([field, index]);
        }
      }
      if (table.rows.length === 0) {
        issues.push({
          path: 'content',
          message: 'The file has no rows below the header.',
        });
      }
      if (issues.length > 0) {
        throw new CsvImportError(issues);
      }

      // Each row: the mapped cells only (unmapped columns are not kept), then a company or
      // the reasons it can't be one.
      const rows = table.rows.map((cells, i) => {
        const mapped: Partial<Record<OrganizationImportField, string>> = {};
        for (const [field, index] of picks) {
          mapped[field] = cells[index] ?? '';
        }
        return {
          line: table.lines[i] ?? i + 2,
          mapped,
          result: normalizeImportRow(mapped),
        };
      });

      return prisma.$transaction(
        async (tx) => {
          const startedAt = now();
          const row = await tx.import.create({
            data: {
              tenantId,
              source: 'CSV',
              status: 'PROCESSING',
              fileName: input.fileName,
              startedAt,
            },
          });
          const good = rows.flatMap((r) =>
            r.result.ok ? [r.result.organization] : [],
          );
          const saved = await saveOrganizations(tx, tenantId, good);
          let next = 0;
          const records = rows.map((r) => {
            const payload = {
              ...r.mapped,
              ...(r.result.ok
                ? {
                    name: r.result.organization.identity.name,
                    domain: r.result.organization.identity.domain,
                  }
                : {
                    name: r.mapped.name ?? null,
                    domain: r.mapped.domain ?? null,
                  }),
            };
            const base = {
              tenantId,
              provider: 'CSV_IMPORT' as const,
              importId: row.id,
              importRowNumber: r.line,
              payload,
              payloadSha256: payloadSha256(payload),
              fetchedAt: startedAt,
            };
            if (!r.result.ok) {
              return {
                ...base,
                outcome: 'FAILED' as const,
                organizationId: null,
                issues: r.result.issues.map((issue) => ({ ...issue })),
              };
            }
            const outcome = saved[next];
            next += 1;
            if (outcome === undefined) {
              throw new Error('saveOrganizations returned too few outcomes');
            }
            const record = recordOf(outcome);
            return {
              ...base,
              outcome: record.outcome,
              organizationId: record.organizationId,
              ...(record.issues === undefined ? {} : { issues: record.issues }),
            };
          });
          await tx.sourceRecord.createMany({ data: records });
          const count = (o: string) =>
            records.filter((r) => r.outcome === o).length;
          const savedCount = count('CREATED') + count('MATCHED');
          const completed = await tx.import.update({
            where: { tenantId_id: { tenantId, id: row.id } },
            data: {
              status: 'COMPLETED',
              completedAt: startedAt,
              totalRows: rows.length,
              importedRows: savedCount,
              skippedRows: count('EXCLUDED'),
              failedRows: count('FAILED'),
            },
          });
          await writeAuditRecord(tx, tenantId, member, {
            action: 'organization_import.completed',
            targetType: 'import',
            targetId: row.id,
            metadata: {
              rows: rows.length,
              saved: savedCount,
              excluded: count('EXCLUDED'),
              failed: count('FAILED'),
            },
          });
          return toRun(completed, count('CREATED'));
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    },

    async beginSearch(rawId) {
      worker('lead_discovery.run');
      const id = idOrNotFound(rawId);
      return prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.source !== 'ORGANIZATION_SEARCH') {
          return { state: 'stopped', status: row.status } as const;
        }
        if (row.status !== 'PENDING' && row.status !== 'PROCESSING') {
          return { state: 'stopped', status: row.status } as const;
        }
        if (
          row.status === 'PROCESSING' &&
          row.pagesFetched > 0 &&
          row.cursor === null
        ) {
          return { state: 'finish' } as const;
        }
        if (row.status === 'PENDING') {
          await tx.import.update({
            where: { tenantId_id: { tenantId, id } },
            data: { status: 'PROCESSING', startedAt: now(), errorCode: null },
          });
        }
        const metadata = sourceMetadataSchema.parse(row.sourceMetadata);
        // Companies this run already saved, so a resumed run doesn't count them again.
        const linked = await tx.sourceRecord.findMany({
          where: {
            tenantId,
            importId: id,
            outcome: { in: ['CREATED', 'MATCHED'] },
          },
          select: {
            organization: { select: { normalizedDomain: true, nameKey: true } },
          },
        });
        const seen = linked.flatMap(({ organization }) => {
          if (organization === null) {
            return [];
          }
          if (organization.normalizedDomain !== null) {
            return [`domain:${organization.normalizedDomain}`];
          }
          return organization.nameKey === null
            ? []
            : [`name:${organization.nameKey}`];
        });
        return {
          state: 'run',
          provider: z.enum(DISCOVERY_PROVIDERS).parse(row.searchProvider),
          plan: {
            filters: organizationSearchFiltersSchema.parse(row.searchFilters),
            maxResults: z.number().int().min(1).parse(row.resultLimit),
            ignoredCriteria: metadata.ignoredCriteria,
          },
          resume: {
            pageToken: row.cursor,
            seen,
            found: row.importedRows + row.skippedRows,
          },
          pagesFetched: row.pagesFetched,
        } as const;
      });
    },

    async saveSearchPage(rawId, page) {
      worker('lead_discovery.run');
      const id = idOrNotFound(rawId);
      return prisma.$transaction(
        async (tx) => {
          const row = await locked(tx, id);
          if (row.status !== 'PROCESSING') {
            // Cancelled (or finished) meanwhile: the page is dropped.
            return { state: 'stopped' } as const;
          }
          const saved = await saveOrganizations(
            tx,
            tenantId,
            page.organizations,
          );
          let position = row.importedRows + row.skippedRows + row.failedRows;
          const records = [
            ...page.organizations.map((organization, i) => {
              const outcome = saved[i];
              if (outcome === undefined) {
                throw new Error('saveOrganizations returned too few outcomes');
              }
              const record = recordOf(outcome);
              const payload = {
                name: organization.identity.name,
                domain: organization.identity.domain,
                received: asJson(organization.raw),
              };
              position += 1;
              return {
                tenantId,
                provider: organization.source.provider,
                externalId: organization.source.externalId,
                importId: id,
                importRowNumber: position,
                payload,
                payloadSha256: payloadSha256(payload),
                fetchedAt: organization.source.retrievedAt,
                outcome: record.outcome,
                organizationId: record.organizationId,
                ...(record.issues === undefined
                  ? {}
                  : { issues: record.issues }),
              };
            }),
            ...page.rejected.map((rejected) => {
              const payload = {
                name: null,
                domain: null,
                received: asJson(rejected.raw),
              };
              position += 1;
              return {
                tenantId,
                provider: z.enum(DISCOVERY_PROVIDERS).parse(row.searchProvider),
                externalId: rejected.externalId,
                importId: id,
                importRowNumber: position,
                payload,
                payloadSha256: payloadSha256(payload),
                fetchedAt: now(),
                outcome: 'FAILED' as const,
                organizationId: null,
                issues: [{ ...REJECTED_RECORD }],
              };
            }),
          ];
          if (records.length > 0) {
            await tx.sourceRecord.createMany({ data: records });
          }
          const count = (o: string) =>
            records.filter((r) => r.outcome === o).length;
          await tx.import.update({
            where: { tenantId_id: { tenantId, id } },
            data: {
              totalRows: { increment: page.received },
              importedRows: { increment: count('CREATED') + count('MATCHED') },
              skippedRows: { increment: count('EXCLUDED') },
              failedRows: { increment: count('FAILED') },
              pagesFetched: { increment: 1 },
              cursor: page.nextPageToken,
              errorCode: null,
            },
          });
          return {
            state: page.nextPageToken === null ? 'done' : 'continue',
          } as const;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },

    async finishSearch(rawId) {
      worker('lead_discovery.run');
      const id = idOrNotFound(rawId);
      return prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status !== 'PROCESSING') {
          return runOf(tx, row);
        }
        const updated = await tx.import.update({
          where: { tenantId_id: { tenantId, id } },
          data: { status: 'COMPLETED', completedAt: now(), cursor: null },
        });
        await writeAuditRecord(tx, tenantId, actor, {
          action: 'lead_discovery.completed',
          targetType: 'import',
          targetId: id,
          metadata: {
            found: updated.totalRows,
            saved: updated.importedRows,
            excluded: updated.skippedRows,
            failed: updated.failedRows,
          },
        });
        return runOf(tx, updated);
      });
    },

    async failSearch(rawId, rawCode, final) {
      worker('lead_discovery.run');
      const id = idOrNotFound(rawId);
      const errorCode = errorCodeSchema.parse(rawCode);
      await prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status !== 'PROCESSING' && row.status !== 'PENDING') {
          return;
        }
        await tx.import.update({
          where: { tenantId_id: { tenantId, id } },
          data: final
            ? {
                status: 'FAILED',
                errorCode,
                completedAt: now(),
                startedAt: row.startedAt ?? now(),
              }
            : { errorCode },
        });
        if (final) {
          await writeAuditRecord(tx, tenantId, actor, {
            action: 'lead_discovery.failed',
            targetType: 'import',
            targetId: id,
            metadata: { errorCode },
          });
        }
      });
    },
  };
}

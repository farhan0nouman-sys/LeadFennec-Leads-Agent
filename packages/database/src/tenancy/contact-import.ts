// People imports from a CSV file (task 11C, docs/decisions.md D-11C-01). A member's file is parsed
// and every row checked in the request: one source record per row, failed rows with their reasons
// right away, valid rows waiting (outcome NULL) for the worker. The worker saves the waiting rows
// in batches of CONTACT_IMPORT_BATCH_ROWS, one transaction each, and the run's counts move with
// every batch, so its progress can be followed and an interrupted run resumes at the next waiting
// row. Each person goes through the same rules as found people:
// - an address on the do-not-contact list (or its domain) is EXCLUDED before anything is saved,
//   and a known person is checked with the address the workspace has for them (saveContacts);
// - companies through saveOrganizations (a suppressed domain excludes its people too);
// - people through saveContacts (identity match, never a second contact for a known person).
// People with an address go on the named lead list, unless their address is known to be invalid.
// Every query filters by tenantId.
import {
  CONTACT_IMPORT_BATCH_ROWS,
  CONTACT_IMPORT_FIELDS,
  CONTACT_IMPORT_LIMITS,
  CsvError,
  contactImportPayload,
  contactImportRequestSchema,
  normalizeContactImportRow,
  parseCsv,
  type ContactImportField,
  type ImportIssue,
  type PlanIssue,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type {
  Import,
  ImportStatus,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client.js';
import { payloadSha256 } from '../payload-hash.js';
import {
  ActorNotAllowedError,
  uuidSchema,
  type TenantActor,
} from './actors.js';
import { writeAuditRecord } from './audit.js';
import { RecordNotFoundError, requirePermission } from './authorization.js';
import {
  saveContacts,
  suppressedAddresses,
  type ContactSaveOutcome,
  type IncomingContact,
} from './contact-store.js';
import { CsvImportError, runView, type DiscoveryRun } from './discovery.js';
import { saveOrganizations } from './organization-store.js';

/** The job a people import queues; its payload is only the import id. */
export const CONTACT_IMPORT_TASK_TYPE = 'contact_import.run';

export type ContactImportStart =
  | { readonly state: 'run' }
  | { readonly state: 'stopped'; readonly status: ImportStatus };

export interface ContactImportRepository {
  /**
   * Checks a people file and queues its valid rows (imports.create and contacts.write, members
   * only; lead_lists.write to name a lead list).
   */
  request(
    input: z.input<typeof contactImportRequestSchema>,
  ): Promise<DiscoveryRun>;
  /** Workers: marks the import PROCESSING (or resumes it), or says why not to run it. */
  begin(runId: string): Promise<ContactImportStart>;
  /** Workers: saves the next batch of waiting rows and the counts, all or nothing. */
  saveBatch(
    runId: string,
  ): Promise<{ readonly state: 'continue' | 'done' | 'stopped' }>;
  /** Workers: marks a running import COMPLETED. */
  finish(runId: string): Promise<DiscoveryRun>;
  /** Workers: records why an import stopped; `final` marks it FAILED, else it will be retried. */
  fail(runId: string, errorCode: string, final: boolean): Promise<void>;
}

const NOT_FOUND = 'Not found in this workspace.';
const SUPPRESSED: ImportIssue = {
  field: 'email',
  message: 'This address is on the do-not-contact list.',
};
const COMPANY_SUPPRESSED: ImportIssue = {
  field: 'companyDomain',
  message: "The company's domain is on the do-not-contact list.",
};
const NOT_LISTED_NO_ADDRESS: ImportIssue = {
  field: 'email',
  message: 'No email address: not added to the lead list.',
};
const NOT_LISTED_INVALID: ImportIssue = {
  field: 'email',
  message: 'The address was found invalid: not added to the lead list.',
};

/** Plain JSON (a round trip drops anything that isn't data). */
const asJson = (value: object): Prisma.InputJsonObject =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

type SavedOutcome = Extract<
  ContactSaveOutcome,
  { readonly outcome: 'CREATED' | 'MATCHED' }
>;
const isSaved = (outcome: ContactSaveOutcome): outcome is SavedOutcome =>
  outcome.outcome === 'CREATED' || outcome.outcome === 'MATCHED';

const errorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const payloadCellsSchema = z.looseObject({
  cells: z.record(z.string(), z.string()),
});

const fieldsOf = (cells: Readonly<Record<string, string>>) => {
  const picked: Partial<Record<ContactImportField, string>> = {};
  for (const field of CONTACT_IMPORT_FIELDS) {
    const value = cells[field];
    if (value !== undefined) {
      picked[field] = value;
    }
  }
  return picked;
};

export function createContactImportRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): ContactImportRepository {
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
    async request(rawInput) {
      const member = requirePermission(actor, 'imports.create');
      requirePermission(actor, 'contacts.write');
      const input = contactImportRequestSchema.parse(rawInput);
      if (input.leadListId !== undefined) {
        requirePermission(actor, 'lead_lists.write');
      }
      let table;
      try {
        table = parseCsv(input.content, CONTACT_IMPORT_LIMITS);
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
      const picks: [ContactImportField, number][] = [];
      for (const field of CONTACT_IMPORT_FIELDS) {
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
      // Each row: the mapped cells only (unmapped columns are never kept), then a person or the
      // reasons it can't be one.
      const rows = table.rows.map((cells, i) => {
        const mapped: Partial<Record<ContactImportField, string>> = {};
        for (const [field, index] of picks) {
          mapped[field] = cells[index] ?? '';
        }
        return {
          line: table.lines[i] ?? i + 2,
          mapped,
          result: normalizeContactImportRow(mapped),
        };
      });
      const failed = rows.filter((r) => !r.result.ok).length;
      const waiting = rows.length - failed;

      return prisma.$transaction(
        async (tx) => {
          if (input.leadListId !== undefined) {
            const list = await tx.leadList.findUnique({
              where: { tenantId_id: { tenantId, id: input.leadListId } },
              select: { status: true },
            });
            // Another workspace's list reads exactly like a missing one.
            if (list === null) {
              throw new CsvImportError([
                { path: 'leadListId', message: NOT_FOUND },
              ]);
            }
            if (list.status !== 'ACTIVE') {
              throw new CsvImportError([
                {
                  path: 'leadListId',
                  message: 'This lead list is archived.',
                },
              ]);
            }
          }
          const at = now();
          const row = await tx.import.create({
            data: {
              tenantId,
              source: 'CONTACT_CSV',
              // A file whose every row failed is done when it is accepted.
              status: waiting === 0 ? 'COMPLETED' : 'PENDING',
              fileName: input.fileName,
              leadListId: input.leadListId ?? null,
              totalRows: rows.length,
              failedRows: failed,
              ...(waiting === 0 ? { startedAt: at, completedAt: at } : {}),
            },
          });
          await tx.sourceRecord.createMany({
            data: rows.map((r) => {
              const payload = contactImportPayload(
                r.mapped,
                r.result.ok ? r.result.contact : null,
              );
              return {
                tenantId,
                provider: 'CSV_IMPORT' as const,
                importId: row.id,
                importRowNumber: r.line,
                payload: asJson(payload),
                payloadSha256: payloadSha256(payload),
                fetchedAt: at,
                ...(r.result.ok
                  ? {}
                  : {
                      outcome: 'FAILED' as const,
                      issues: r.result.issues
                        .slice(0, 20)
                        .map((issue) => ({ ...issue })),
                    }),
              };
            }),
          });
          if (waiting > 0) {
            // The durable task; the worker's relay publishes { v: 1, taskId } (D-07C-01).
            await tx.jobTask.create({
              data: {
                tenantId,
                taskType: CONTACT_IMPORT_TASK_TYPE,
                idempotencyKey: `import:${row.id}`,
                payload: { importId: row.id },
              },
            });
          }
          await writeAuditRecord(tx, tenantId, member, {
            action: 'contact_import.requested',
            targetType: 'import',
            targetId: row.id,
            metadata: {
              rows: rows.length,
              failed,
              leadList: input.leadListId !== undefined,
            },
          });
          return runView(tx, tenantId, row);
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },

    async begin(rawId) {
      worker('contact_import.run');
      const id = idOrNotFound(rawId);
      return prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (
          row.source !== 'CONTACT_CSV' ||
          (row.status !== 'PENDING' && row.status !== 'PROCESSING')
        ) {
          return { state: 'stopped', status: row.status } as const;
        }
        if (row.status === 'PENDING') {
          await tx.import.update({
            where: { tenantId_id: { tenantId, id } },
            data: { status: 'PROCESSING', startedAt: now(), errorCode: null },
          });
        }
        return { state: 'run' } as const;
      });
    },

    async saveBatch(rawId) {
      worker('contact_import.run');
      const id = idOrNotFound(rawId);
      return prisma.$transaction(
        async (tx) => {
          const row = await locked(tx, id);
          if (row.status !== 'PROCESSING') {
            // Cancelled (or finished) meanwhile: nothing more is saved.
            return { state: 'stopped' } as const;
          }
          const batch = await tx.sourceRecord.findMany({
            where: { tenantId, importId: id, outcome: null },
            orderBy: { importRowNumber: 'asc' },
            take: CONTACT_IMPORT_BATCH_ROWS,
            select: { id: true, payload: true },
          });
          if (batch.length === 0) {
            return { state: 'done' } as const;
          }
          const at = now();
          // The rows again, from what was kept (the same check as when the file was accepted).
          const rows = batch.map((record) => {
            const parsed = payloadCellsSchema.safeParse(record.payload);
            const result = normalizeContactImportRow(
              parsed.success ? fieldsOf(parsed.data.cells) : {},
            );
            return { id: record.id, result };
          });
          type Decided =
            | {
                readonly outcome: 'CREATED' | 'MATCHED';
                readonly contactId: string;
                readonly organizationId: string;
                readonly issues: readonly ImportIssue[];
              }
            | {
                readonly outcome: 'EXCLUDED' | 'FAILED';
                readonly organizationId: string | null;
                readonly issues: readonly ImportIssue[];
              };
          const decided = new Map<string, Decided>();

          // 1. People on the do-not-contact list: excluded before their company is saved.
          const suppressed = await suppressedAddresses(
            tx,
            tenantId,
            rows.flatMap((r) =>
              r.result.ok && r.result.contact.identity.email !== null
                ? [r.result.contact.identity.email]
                : [],
            ),
          );
          const people = rows.flatMap((r) => {
            if (!r.result.ok) {
              decided.set(r.id, {
                outcome: 'FAILED',
                organizationId: null,
                issues: r.result.issues,
              });
              return [];
            }
            const { contact } = r.result;
            if (
              contact.identity.email !== null &&
              suppressed.has(contact.identity.email)
            ) {
              decided.set(r.id, {
                outcome: 'EXCLUDED',
                organizationId: null,
                issues: [SUPPRESSED],
              });
              return [];
            }
            return [{ id: r.id, contact }];
          });

          // 2. Their companies (a suppressed domain excludes the company's people).
          const companies = await saveOrganizations(
            tx,
            tenantId,
            people.map(({ contact }) => ({
              identity: contact.company,
              websiteUrl: null,
              industry: null,
              employeeCount: null,
              countryCode: null,
            })),
          );
          const toSave: { id: string; incoming: IncomingContact }[] = [];
          people.forEach(({ id: recordId, contact }, i) => {
            const company = companies[i];
            if (company === undefined) {
              throw new Error('saveOrganizations returned too few outcomes');
            }
            if (company.outcome === 'EXCLUDED') {
              decided.set(recordId, {
                outcome: 'EXCLUDED',
                organizationId: null,
                issues: [COMPANY_SUPPRESSED],
              });
              return;
            }
            toSave.push({
              id: recordId,
              incoming: {
                kind: 'found',
                identity: contact.identity,
                title: contact.title,
                organizationId: company.organizationId,
                countryCode: contact.countryCode,
                source: { provider: 'CSV_IMPORT', externalId: null },
              },
            });
          });

          // 3. The people: matched or created, never twice (saveContacts checks the list again,
          // with the address the workspace already has for a known person).
          const saved = await saveContacts(
            tx,
            tenantId,
            toSave.map((s) => s.incoming),
            null,
          );
          const listed: string[] = [];
          for (const [i, { id: recordId, incoming }] of toSave.entries()) {
            const outcome = saved[i];
            if (outcome === undefined) {
              throw new Error('saveContacts returned too few outcomes');
            }
            if (!isSaved(outcome)) {
              decided.set(recordId, {
                outcome: outcome.outcome,
                organizationId: incoming.organizationId,
                issues: outcome.issues.map((issue) => ({
                  field: issue.field === 'email' ? 'email' : 'person',
                  message: issue.message,
                })),
              });
              continue;
            }
            const issues: ImportIssue[] = [];
            if (row.leadListId !== null) {
              if (outcome.email === null) {
                issues.push(NOT_LISTED_NO_ADDRESS);
              } else {
                const check = await tx.verification.findFirst({
                  where: {
                    tenantId,
                    contactId: outcome.contactId,
                    normalizedEmail: outcome.email,
                  },
                  orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
                  select: { status: true },
                });
                if (check?.status === 'INVALID') {
                  issues.push(NOT_LISTED_INVALID);
                } else {
                  listed.push(outcome.contactId);
                }
              }
            }
            decided.set(recordId, {
              outcome: outcome.outcome,
              contactId: outcome.contactId,
              organizationId: incoming.organizationId,
              issues,
            });
          }

          // 4. The rows' outcomes, the lead list and the counts, in this one transaction.
          const counts = { saved: 0, excluded: 0, failed: 0 };
          for (const { id: recordId } of rows) {
            const decision = decided.get(recordId);
            if (decision === undefined) {
              throw new Error('A row of the batch was not decided');
            }
            if (
              decision.outcome === 'CREATED' ||
              decision.outcome === 'MATCHED'
            ) {
              counts.saved += 1;
            } else if (decision.outcome === 'EXCLUDED') {
              counts.excluded += 1;
            } else {
              counts.failed += 1;
            }
            await tx.sourceRecord.update({
              where: { tenantId_id: { tenantId, id: recordId } },
              data: {
                outcome: decision.outcome,
                organizationId: decision.organizationId,
                contactId: 'contactId' in decision ? decision.contactId : null,
                ...(decision.issues.length === 0
                  ? {}
                  : {
                      issues: decision.issues
                        .slice(0, 20)
                        .map((issue) => ({ ...issue })),
                    }),
              },
            });
          }
          if (listed.length > 0 && row.leadListId !== null) {
            await tx.leadListMember.createMany({
              data: [...new Set(listed)].map((contactId) => ({
                tenantId,
                leadListId: row.leadListId ?? '',
                contactId,
                addedAt: at,
              })),
              skipDuplicates: true,
            });
          }
          await tx.import.update({
            where: { tenantId_id: { tenantId, id } },
            data: {
              importedRows: { increment: counts.saved },
              skippedRows: { increment: counts.excluded },
              failedRows: { increment: counts.failed },
              pagesFetched: { increment: 1 },
              errorCode: null,
            },
          });
          const left = await tx.sourceRecord.count({
            where: { tenantId, importId: id, outcome: null },
          });
          return { state: left === 0 ? 'done' : 'continue' } as const;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },

    async finish(rawId) {
      worker('contact_import.run');
      const id = idOrNotFound(rawId);
      return prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status !== 'PROCESSING') {
          return runView(tx, tenantId, row);
        }
        const updated = await tx.import.update({
          where: { tenantId_id: { tenantId, id } },
          data: { status: 'COMPLETED', completedAt: now() },
        });
        await writeAuditRecord(tx, tenantId, actor, {
          action: 'contact_import.completed',
          targetType: 'import',
          targetId: id,
          metadata: {
            rows: updated.totalRows,
            saved: updated.importedRows,
            excluded: updated.skippedRows,
            failed: updated.failedRows,
          },
        });
        return runView(tx, tenantId, updated);
      });
    },

    async fail(rawId, rawCode, final) {
      worker('contact_import.run');
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
            action: 'contact_import.failed',
            targetType: 'import',
            targetId: id,
            metadata: { errorCode },
          });
        }
      });
    },
  };
}

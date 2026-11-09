// Lead exports (task 11C, docs/decisions.md D-11C-*): a CSV file of a lead search, made on
// request for one member, bounded, spreadsheet-safe (every cell through toCsv), and downloadable
// only by that member, with the permission, until it expires. An expired file's content is
// deleted. Pure zod: safe for web, API and worker.
import { z } from 'zod';
import { toCsv } from '../csv.js';
import { leadSearchQuerySchema, type LeadSearchItem } from './leads.js';

export const EXPORT_ROUTES = {
  exports: (workspaceId: string) => `/workspaces/${workspaceId}/exports`,
  download: (workspaceId: string, exportId: string) =>
    `/workspaces/${workspaceId}/exports/${exportId}/download`,
} as const;

export const EXPORT_LIMITS = {
  /** Most leads in one file: more matches are cut, and the export says so. */
  maxRows: 2000,
  /** Most bytes in one file. */
  maxBytes: 4 * 1024 * 1024,
  /** How long a file can be downloaded, from when it was made. */
  ttlHours: 24,
  /** Files a member may have waiting (not expired) at once. */
  maxLivePerMember: 10,
  /** Leads read per page while the file is made. */
  pageSize: 100,
} as const;

export const EXPORT_KINDS = ['LEADS'] as const;
export const EXPORT_STATUSES = [
  /** Made, and downloadable until it expires. */
  'READY',
  /** Past its time: the content is deleted. */
  'EXPIRED',
] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** A file of the leads a search finds, from the first one (no cursor or page size). */
export const leadExportRequestSchema = z
  .strictObject({ filters: leadSearchQuerySchema })
  .superRefine((request, ctx) => {
    for (const key of ['cursor', 'limit'] as const) {
      if (request.filters[key] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['filters', key],
          message:
            'An export starts from the first lead: leave out the page and its size.',
        });
      }
    }
  });

const iso = z.iso.datetime();
const count = z.number().int().min(0);

export const exportSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(EXPORT_KINDS),
    status: z.enum(EXPORT_STATUSES),
    fileName: z.string(),
    /** Leads in the file. */
    rowCount: count,
    /** More leads matched than the file holds (EXPORT_LIMITS.maxRows). */
    truncated: z.boolean(),
    byteSize: count,
    /** The search the file was made from. */
    filters: z.record(z.string(), z.string()),
    createdAt: iso,
    /** After this the file can't be downloaded, and its content is deleted. */
    expiresAt: iso,
    downloadedAt: iso.nullable(),
    downloadCount: count,
  })
  .strict();

export type LeadExport = z.output<typeof exportSchema>;

export const exportPageSchema = z
  .object({
    items: z.array(exportSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const EXPORT_ERROR_CODES = [
  /** 409: the member already has the most files waiting; one must expire first. */
  'export_limit_reached',
  /** 410: the file expired; its content is deleted. */
  'export_expired',
] as const;

/** The file's columns, in order. */
export const LEAD_EXPORT_COLUMNS = [
  'Lead ID',
  'Name',
  'Title',
  'Email',
  'Address check',
  'Address checked at',
  'Company',
  'Company domain',
  'Industry',
  'Country',
  'Score',
  'Score band',
  'Qualification',
  'Eligibility',
  'Sources',
  'Created',
  'Last activity',
] as const;

/** One lead as a row of the file (untrusted text stays text: toCsv protects formulas). */
export function leadExportRow(
  item: LeadSearchItem,
): (string | number | null)[] {
  return [
    item.id,
    item.name,
    item.title,
    item.email,
    item.verification?.status ??
      (item.email === null ? 'no address' : 'unchecked'),
    item.verification?.checkedAt ?? null,
    item.company?.name ?? null,
    item.company?.domain ?? null,
    item.company?.industry ?? null,
    item.countryCode,
    item.score?.value ?? null,
    item.score?.band ?? null,
    item.qualification?.state ?? null,
    item.qualification?.eligibilityStatus ?? null,
    item.sources.join(' '),
    item.createdAt,
    item.lastActivityAt,
  ];
}

/** A byte-order mark, so spreadsheets read the file as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** The whole file: a header row, then one row per lead; every cell through toCsv. */
export function leadExportCsv(items: readonly LeadSearchItem[]): string {
  return BOM + toCsv([[...LEAD_EXPORT_COLUMNS], ...items.map(leadExportRow)]);
}

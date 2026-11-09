// Organization imports and discovery results (task 07C, docs/decisions.md D-07C-*): the CSV
// import request with its column mapping and limits, the safe normalization of one row, the
// per-record results of a run (saved, excluded, failed), run lists, options and cancellation.
// Pure zod: safe for web, API and worker.
import { z } from 'zod';
import type { CsvLimits } from '../csv.js';
import {
  IdentityNormalizationError,
  normalizeCompanyIdentity,
  normalizeDomain,
  type CompanyIdentity,
} from '../identity.js';
import { DISCOVERY_PROVIDERS, importRunSchema } from './lead-discovery.js';

export const IMPORT_ROUTES = {
  imports: (workspaceId: string) => `/workspaces/${workspaceId}/imports`,
  options: (workspaceId: string) =>
    `/workspaces/${workspaceId}/imports/options`,
  csv: (workspaceId: string) => `/workspaces/${workspaceId}/imports/csv`,
  results: (workspaceId: string, importId: string) =>
    `/workspaces/${workspaceId}/imports/${importId}/results`,
  cancel: (workspaceId: string, importId: string) =>
    `/workspaces/${workspaceId}/imports/${importId}/cancel`,
} as const;

/** One CSV import: at most 256 KB of text, 1000 rows, 30 columns, 1000 characters a cell. */
export const ORGANIZATION_IMPORT_LIMITS = {
  maxChars: 262_144,
  maxRows: 1000,
  maxColumns: 30,
  maxCellChars: 1000,
} as const satisfies CsvLimits;

/** What a column can be mapped to. Only `name` is required. */
export const ORGANIZATION_IMPORT_FIELDS = [
  'name',
  'domain',
  'website',
  'industry',
  'employees',
  'country',
] as const;
export type OrganizationImportField =
  (typeof ORGANIZATION_IMPORT_FIELDS)[number];

/**
 * What a column of a people file can be mapped to (task 11C, contact-import.ts). First name, last
 * name and company are required.
 */
export const CONTACT_IMPORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'linkedinUrl',
  'title',
  'company',
  'companyDomain',
  'country',
] as const;
export type ContactImportField = (typeof CONTACT_IMPORT_FIELDS)[number];

/** What an import result's issue can name: a mapped field, the person, or the row. */
export const IMPORT_ISSUE_FIELDS = [
  ...ORGANIZATION_IMPORT_FIELDS,
  'firstName',
  'lastName',
  'email',
  'linkedinUrl',
  'title',
  'company',
  'companyDomain',
  'person',
  'row',
] as const;
export type ImportIssueField = (typeof IMPORT_ISSUE_FIELDS)[number];

export const ORGANIZATION_IMPORT_FIELD_LABELS: Readonly<
  Record<OrganizationImportField, string>
> = {
  name: 'Company name',
  domain: 'Domain',
  website: 'Website',
  industry: 'Industry',
  employees: 'Employees',
  country: 'Country (two-letter code)',
};

const header = z
  .string()
  .trim()
  .min(1, 'Choose a column.')
  .max(200, 'Use at most 200 characters.');

/** Field → the file's column header. Each column is used at most once. */
export const importMappingSchema = z
  .strictObject({
    name: header,
    domain: header.optional(),
    website: header.optional(),
    industry: header.optional(),
    employees: header.optional(),
    country: header.optional(),
  })
  .superRefine((mapping, ctx) => {
    const used = new Map<string, string>();
    for (const field of ORGANIZATION_IMPORT_FIELDS) {
      const column = mapping[field]?.toLowerCase();
      if (column === undefined) {
        continue;
      }
      if (used.has(column)) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'This column is already used for another field.',
        });
      }
      used.set(column, field);
    }
  });

export type ImportMapping = z.output<typeof importMappingSchema>;

export const csvImportRequestSchema = z
  .strictObject({
    fileName: z
      .string('Choose a file.')
      .trim()
      .min(1, 'Choose a file.')
      .max(255, 'Use a file name of at most 255 characters.'),
    content: z
      .string('Choose a file.')
      .min(1, 'The file is empty.')
      .max(
        ORGANIZATION_IMPORT_LIMITS.maxChars,
        'The file is larger than 256 KB. Split it into smaller files.',
      ),
    mapping: importMappingSchema,
  })
  .strict();

export interface ImportIssue {
  /** A mapped field, the person, or "row" for the row as a whole. */
  readonly field: ImportIssueField;
  readonly message: string;
}

/** A row turned into a company, ready to be saved. */
export interface ImportedOrganization {
  readonly identity: CompanyIdentity;
  readonly websiteUrl: string | null;
  readonly industry: string | null;
  readonly employeeCount: number | null;
  readonly countryCode: string | null;
}

// C0 and C1 control characters and bidirectional overrides: removed from every value.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** A cell as text: control characters and bidirectional overrides removed, spaces collapsed. */
export const cleanImportCell = (value: string | undefined): string =>
  (value ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
const clean = cleanImportCell;

export function websiteOf(value: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * One CSV row (field → cell, already picked by the mapping) → a company, or the reasons it
 * can't be one. Values are cleaned (control characters, extra spaces) and checked; nothing in
 * a cell is evaluated. Company identity comes only from normalizeCompanyIdentity.
 */
export function normalizeImportRow(
  cells: Readonly<Partial<Record<OrganizationImportField, string>>>,
):
  | { readonly ok: true; readonly organization: ImportedOrganization }
  | { readonly ok: false; readonly issues: readonly ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const name = clean(cells.name);
  const domainText = clean(cells.domain);
  const websiteText = clean(cells.website);

  let domain: string | null = null;
  if (domainText !== '') {
    try {
      domain = normalizeDomain(domainText);
    } catch {
      issues.push({ field: 'domain', message: 'This is not a domain.' });
    }
  }
  let websiteUrl: string | null = null;
  if (websiteText !== '') {
    websiteUrl = websiteOf(websiteText);
    if (websiteUrl === null) {
      issues.push({
        field: 'website',
        message: 'Use a web address, such as https://example.com.',
      });
    }
  }

  const industry = clean(cells.industry);
  if (industry.length > 200) {
    issues.push({
      field: 'industry',
      message: 'Use at most 200 characters.',
    });
  }

  let employeeCount: number | null = null;
  const employeesText = clean(cells.employees).replace(/[,\s_]/g, '');
  if (employeesText !== '') {
    if (
      /^\d{1,8}$/.test(employeesText) &&
      Number(employeesText) <= 10_000_000
    ) {
      employeeCount = Number(employeesText);
    } else {
      issues.push({
        field: 'employees',
        message: 'Use a whole number of employees, such as 120.',
      });
    }
  }

  let countryCode: string | null = null;
  const countryText = clean(cells.country).toUpperCase();
  if (countryText !== '') {
    if (/^[A-Z]{2}$/.test(countryText)) {
      countryCode = countryText;
    } else {
      issues.push({
        field: 'country',
        message: 'Use a two-letter country code, such as US.',
      });
    }
  }

  let identity: CompanyIdentity | null = null;
  if (name === '') {
    issues.push({ field: 'name', message: 'Enter a company name.' });
  } else {
    try {
      identity = normalizeCompanyIdentity({
        name,
        domain,
        website: websiteUrl,
      });
    } catch (error) {
      if (!(error instanceof IdentityNormalizationError)) {
        throw error;
      }
      issues.push({
        field: 'name',
        message:
          name.length > 300
            ? 'Use at most 300 characters.'
            : 'Use a name with letters or digits.',
      });
    }
  }
  if (issues.length > 0 || identity === null) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    organization: {
      identity,
      websiteUrl,
      industry: industry === '' ? null : industry,
      employeeCount,
      countryCode,
    },
  };
}

/** What happened to one received record. */
export const IMPORT_RESULT_OUTCOMES = [
  /** A new organization (or person) was saved. */
  'CREATED',
  /** The organization (or person) was already in the workspace; it was kept, not duplicated. */
  'MATCHED',
  /** The domain (or address) is on the workspace's do-not-contact list: not saved. */
  'EXCLUDED',
  /** The record couldn't be used: not saved. */
  'FAILED',
] as const;
export type ImportResultOutcome = (typeof IMPORT_RESULT_OUTCOMES)[number];

const issueSchema = z
  .object({
    field: z.enum(IMPORT_ISSUE_FIELDS),
    message: z.string(),
  })
  .strict();

export const importResultSchema = z
  .object({
    id: z.uuid(),
    /** The CSV row number (the header is row 1), or the position in the search results. */
    position: z.number().int().min(1),
    /** A company (company imports and searches) or a person (people imports, task 11C). */
    kind: z.enum(['company', 'person']),
    outcome: z.enum(IMPORT_RESULT_OUTCOMES),
    /** The company, or the person's name, as received (untrusted text: escape it when shown). */
    name: z.string().nullable(),
    /** The company's domain. */
    domain: z.string().nullable(),
    /** People: their address and their company's name, as received; null for companies. */
    email: z.string().nullable(),
    company: z.string().nullable(),
    /** The provider's id for the record (searches). */
    externalId: z.string().nullable(),
    /** The saved organization (CREATED, MATCHED; a person's company). */
    organizationId: z.uuid().nullable(),
    /** The saved person (people imports, CREATED or MATCHED). */
    contactId: z.uuid().nullable(),
    issues: z.array(issueSchema),
  })
  .strict();

export type ImportResult = z.output<typeof importResultSchema>;

export const importResultPageSchema = z
  .object({
    items: z.array(importResultSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const importResultsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().max(200).optional(),
    outcome: z.enum(IMPORT_RESULT_OUTCOMES).optional(),
  })
  .strict();

export const importRunPageSchema = z
  .object({
    items: z.array(importRunSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

/** Stopping a queued or running import; repeating it changes nothing. */
export const cancelImportRequestSchema = z.strictObject({});

/** What the import screens offer: usable ICPs, the search provider, the CSV limits. */
export const importOptionsSchema = z
  .object({
    icps: z.array(z.object({ id: z.uuid(), name: z.string() }).strict()),
    search: z
      .object({
        provider: z.enum(DISCOVERY_PROVIDERS),
        supportedFilters: z.array(z.string()),
        maxResults: z.number().int().min(1),
        defaultResults: z.number().int().min(1),
        attribution: z.string(),
      })
      .strict(),
    csv: z
      .object({
        maxBytes: z.number().int().min(1),
        maxRows: z.number().int().min(1),
        fields: z.array(z.enum(ORGANIZATION_IMPORT_FIELDS)),
      })
      .strict(),
    /**
     * People imports (task 11C): the same limits, the fields, and the lead lists a file can be
     * added to (with lead_lists.write; empty otherwise). Null without contacts.write.
     */
    contacts: z
      .object({
        maxBytes: z.number().int().min(1),
        maxRows: z.number().int().min(1),
        rowsPerBatch: z.number().int().min(1),
        fields: z.array(z.enum(CONTACT_IMPORT_FIELDS)),
        leadLists: z.array(
          z.object({ id: z.uuid(), name: z.string() }).strict(),
        ),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type ImportOptions = z.output<typeof importOptionsSchema>;

export const IMPORT_ERROR_CODES = [
  /** 409: the import already finished (completed or failed); it can't be cancelled. */
  'import_not_cancellable',
] as const;

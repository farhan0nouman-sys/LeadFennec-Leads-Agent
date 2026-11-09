// People imports from a CSV file (task 11C, docs/decisions.md D-11C-*): the request with its
// column mapping, the limits, and the safe normalization of one row into a person and their
// company. A file is checked in the request (every row failing validation is reported there) and
// its valid rows are imported by the worker in batches, so its progress can be followed. Pure
// zod: safe for web, API and worker.
import { z } from 'zod';
import {
  IdentityNormalizationError,
  normalizeCompanyIdentity,
  normalizeContactIdentity,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
  type CompanyIdentity,
  type ContactIdentity,
} from '../identity.js';
import {
  CONTACT_IMPORT_FIELDS,
  ORGANIZATION_IMPORT_LIMITS,
  cleanImportCell,
  type ContactImportField,
  type ImportIssue,
} from './organization-import.js';

export const CONTACT_IMPORT_ROUTES = {
  contacts: (workspaceId: string) =>
    `/workspaces/${workspaceId}/imports/contacts`,
} as const;

/** The same file limits as a company import: 256 KB, 1000 rows, 30 columns, 1000 a cell. */
export const CONTACT_IMPORT_LIMITS = ORGANIZATION_IMPORT_LIMITS;

/** Rows the worker imports in one transaction: the run's progress moves by batches. */
export const CONTACT_IMPORT_BATCH_ROWS = 100;

/** The fields a mapping must name. */
export const CONTACT_IMPORT_REQUIRED_FIELDS = [
  'firstName',
  'lastName',
  'company',
] as const satisfies readonly ContactImportField[];

export const CONTACT_IMPORT_FIELD_LABELS: Readonly<
  Record<ContactImportField, string>
> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email address',
  linkedinUrl: 'LinkedIn profile',
  title: 'Title',
  company: 'Company name',
  companyDomain: 'Company domain',
  country: 'Country (two-letter code)',
};

const header = z
  .string()
  .trim()
  .min(1, 'Choose a column.')
  .max(200, 'Use at most 200 characters.');

/** Field → the file's column header. Each column is used at most once. */
export const contactImportMappingSchema = z
  .strictObject({
    firstName: header,
    lastName: header,
    company: header,
    email: header.optional(),
    linkedinUrl: header.optional(),
    title: header.optional(),
    companyDomain: header.optional(),
    country: header.optional(),
  })
  .superRefine((mapping, ctx) => {
    const used = new Set<string>();
    for (const field of CONTACT_IMPORT_FIELDS) {
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
      used.add(column);
    }
  });

export type ContactImportMapping = z.output<typeof contactImportMappingSchema>;

export const contactImportRequestSchema = z.strictObject({
  fileName: z
    .string('Choose a file.')
    .trim()
    .min(1, 'Choose a file.')
    .max(255, 'Use a file name of at most 255 characters.'),
  content: z
    .string('Choose a file.')
    .min(1, 'The file is empty.')
    .max(
      CONTACT_IMPORT_LIMITS.maxChars,
      'The file is larger than 256 KB. Split it into smaller files.',
    ),
  mapping: contactImportMappingSchema,
  /** A lead list of the workspace that receives the people who may be emailed one day. */
  leadListId: z.uuid('Not found in this workspace.').optional(),
});

/** A row turned into a person and their company, ready to be saved. */
export interface ImportedContact {
  readonly identity: ContactIdentity;
  readonly title: string | null;
  readonly countryCode: string | null;
  readonly company: CompanyIdentity;
}

/**
 * What a people row's source record keeps: the mapped cells as received, and the values the
 * results and a deletion request use (the person's name, their address, normalized when it is
 * one, and their company). Unmapped columns are never kept.
 */
export interface ContactImportPayload {
  readonly kind: 'person';
  readonly name: string | null;
  readonly email: string | null;
  readonly company: string | null;
  readonly domain: string | null;
  readonly cells: Readonly<Partial<Record<ContactImportField, string>>>;
}

const NO_IDENTITY: ImportIssue = {
  field: 'person',
  message:
    'Add an email address, a LinkedIn profile or a company domain to identify this person.',
};

/**
 * One people row (field → cell, already picked by the mapping) → a person and their company, or
 * the reasons it can't be one, by field. Values are cleaned (control characters, extra spaces)
 * and checked; nothing in a cell is evaluated. Identities come only from
 * normalizeContactIdentity and normalizeCompanyIdentity.
 */
export function normalizeContactImportRow(
  cells: Readonly<Partial<Record<ContactImportField, string>>>,
):
  | { readonly ok: true; readonly contact: ImportedContact }
  | { readonly ok: false; readonly issues: readonly ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const firstName = cleanImportCell(cells.firstName);
  const lastName = cleanImportCell(cells.lastName);
  const companyName = cleanImportCell(cells.company);
  const emailText = cleanImportCell(cells.email);
  const linkedinText = cleanImportCell(cells.linkedinUrl);
  const domainText = cleanImportCell(cells.companyDomain);
  const title = cleanImportCell(cells.title);
  const countryText = cleanImportCell(cells.country).toUpperCase();

  if (firstName === '') {
    issues.push({ field: 'firstName', message: 'Enter a first name.' });
  } else if (firstName.length > 100) {
    issues.push({ field: 'firstName', message: 'Use at most 100 characters.' });
  }
  if (lastName === '') {
    issues.push({ field: 'lastName', message: 'Enter a last name.' });
  } else if (lastName.length > 100) {
    issues.push({ field: 'lastName', message: 'Use at most 100 characters.' });
  }
  let email: string | null = null;
  if (emailText !== '') {
    try {
      email = normalizeEmail(emailText).email;
    } catch {
      issues.push({
        field: 'email',
        message: 'This is not an email address.',
      });
    }
  }
  let linkedinUrl: string | null = null;
  if (linkedinText !== '') {
    try {
      linkedinUrl = normalizeLinkedinUrl(linkedinText);
    } catch {
      issues.push({
        field: 'linkedinUrl',
        message:
          'Use a LinkedIn profile address, such as https://www.linkedin.com/in/name.',
      });
    }
  }
  let domain: string | null = null;
  if (domainText !== '') {
    try {
      domain = normalizeDomain(domainText);
    } catch {
      issues.push({ field: 'companyDomain', message: 'This is not a domain.' });
    }
  }
  if (title.length > 200) {
    issues.push({ field: 'title', message: 'Use at most 200 characters.' });
  }
  let countryCode: string | null = null;
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
  let company: CompanyIdentity | null = null;
  if (companyName === '') {
    issues.push({ field: 'company', message: 'Enter the company name.' });
  } else {
    try {
      company = normalizeCompanyIdentity({
        name: companyName,
        domain,
        website: null,
      });
    } catch (error) {
      if (!(error instanceof IdentityNormalizationError)) {
        throw error;
      }
      issues.push({
        field: 'company',
        message:
          companyName.length > 300
            ? 'Use at most 300 characters.'
            : 'Use a name with letters or digits.',
      });
    }
  }
  if (issues.length > 0 || company === null) {
    return { ok: false, issues };
  }
  if (email === null && linkedinUrl === null && domain === null) {
    return { ok: false, issues: [NO_IDENTITY] };
  }
  let identity: ContactIdentity;
  try {
    identity = normalizeContactIdentity({
      firstName,
      lastName,
      email,
      linkedinUrl,
      organizationDomain: domain,
    });
  } catch (error) {
    if (!(error instanceof IdentityNormalizationError)) {
      throw error;
    }
    return {
      ok: false,
      issues: [
        { field: 'person', message: 'Use a name with letters or digits.' },
      ],
    };
  }
  return {
    ok: true,
    contact: {
      identity,
      title: title === '' ? null : title,
      countryCode,
      company,
    },
  };
}

/** An address in its normalized form when it is one, else as written. */
function addressOf(text: string): string | null {
  if (text === '') {
    return null;
  }
  try {
    return normalizeEmail(text).email;
  } catch {
    return text;
  }
}

/**
 * The source record's payload of a people row (see ContactImportPayload). A failed row keeps its
 * address normalized whenever it is one, so a deletion request finds it too.
 */
export function contactImportPayload(
  cells: Readonly<Partial<Record<ContactImportField, string>>>,
  contact: ImportedContact | null,
): ContactImportPayload {
  const name = [
    cleanImportCell(cells.firstName),
    cleanImportCell(cells.lastName),
  ]
    .filter((part) => part !== '')
    .join(' ');
  const company = cleanImportCell(cells.company);
  const domain = cleanImportCell(cells.companyDomain);
  if (contact !== null) {
    return {
      kind: 'person',
      name: `${contact.identity.firstName} ${contact.identity.lastName}`,
      email: contact.identity.email,
      company: contact.company.name,
      domain: contact.company.domain,
      cells: { ...cells },
    };
  }
  return {
    kind: 'person',
    name: name === '' ? null : name,
    email: addressOf(cleanImportCell(cells.email)),
    company: company === '' ? null : company,
    domain: domain === '' ? null : domain,
    cells: { ...cells },
  };
}

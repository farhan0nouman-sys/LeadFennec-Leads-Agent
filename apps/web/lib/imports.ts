// Import and discovery screens (task 07C, docs/decisions.md D-07C-06): what a run's error code
// means, a first guess of the column mapping, and the error report a person downloads. The
// report is built with the shared toCsv, so no cell can run as a spreadsheet formula. People
// files (task 11C) get their own mapping guess, progress and report columns.
import {
  CONTACT_IMPORT_FIELDS,
  CONTACT_IMPORT_FIELD_LABELS,
  ORGANIZATION_IMPORT_FIELDS,
  ORGANIZATION_IMPORT_FIELD_LABELS,
  toCsv,
  type ContactImportField,
  type ContactImportMapping,
  type ImportMapping,
  type ImportResult,
  type ImportRun,
  type OrganizationImportField,
} from '@lead-fennec-ai/shared';

/** Why a run stopped, in words. Unknown codes get a generic sentence. */
export const RUN_ERROR_TEXT: Readonly<Record<string, string>> = {
  unauthorized:
    'The search provider did not accept the workspace’s credentials.',
  forbidden: 'The search provider account may not run this search.',
  quota_exceeded: 'The search provider’s quota is used up for now.',
  rate_limited: 'The search provider asked to slow down.',
  invalid_request: 'The search provider refused the search.',
  unavailable: 'The search provider could not be reached.',
  timeout: 'The search provider did not answer in time.',
  bad_response: 'The search provider’s answer could not be read.',
  usage_limit_reached:
    'The workspace’s plan has no search credits left for this period.',
  no_entitled_plan: 'The workspace has no plan that includes paid searches.',
  provider_mismatch:
    'The search was asked of a provider this environment does not use.',
  invalid_payload: 'The queued search was not valid.',
  internal_error: 'Something went wrong while searching.',
  provider_unavailable: 'The people provider isn’t set up in this environment.',
};

/** Why a people import stopped (task 11C). */
const PEOPLE_ERROR_TEXT: Readonly<Record<string, string>> = {
  internal_error: 'Something went wrong while importing the file.',
  invalid_payload: 'The queued import was not valid.',
};

export function runErrorText(code: string, people = false): string {
  if (people) {
    return PEOPLE_ERROR_TEXT[code] ?? 'The import stopped because of an error.';
  }
  return RUN_ERROR_TEXT[code] ?? 'The search stopped because of an error.';
}

export const isRunning = (run: Pick<ImportRun, 'status'>) =>
  run.status === 'PENDING' || run.status === 'PROCESSING';

/** What a run is, in a few words: the file, or a search. */
export function runTitle(run: ImportRun): string {
  if (run.source === 'CSV') {
    return run.fileName === null ? 'CSV import' : `CSV import: ${run.fileName}`;
  }
  if (run.source === 'CONTACT_CSV') {
    return run.fileName === null
      ? 'People import'
      : `People import: ${run.fileName}`;
  }
  if (run.source === 'CONTACT_ENRICHMENT') {
    return 'People search';
  }
  return run.search === null ? 'Import' : 'Company search';
}

/** A finished company run whose people can be looked for (task 08C). */
export const canFindPeople = (run: ImportRun) =>
  run.source !== 'CONTACT_ENRICHMENT' &&
  run.source !== 'CONTACT_CSV' &&
  !isRunning(run) &&
  run.counts.saved > 0;

const HEADER_PATTERNS: Readonly<Record<OrganizationImportField, RegExp>> = {
  name: /^(company( name)?|name|organi[sz]ation( name)?|account( name)?|business( name)?)$/i,
  domain: /^(company )?domain( name)?$/i,
  website: /^(website|web site|url|homepage|home page|site|web)$/i,
  industry: /^(industry|sector)$/i,
  employees: /^(employees|employee count|headcount|staff|size|company size)$/i,
  country: /^(country|country code)$/i,
};

/**
 * A first guess: each field takes the first column whose header looks like it, a column at most
 * once. The person checks and changes it before importing.
 */
export function guessMapping(
  headers: readonly string[],
): Partial<Record<OrganizationImportField, string>> {
  const used = new Set<string>();
  const mapping: Partial<Record<OrganizationImportField, string>> = {};
  for (const field of ORGANIZATION_IMPORT_FIELDS) {
    const header = headers.find(
      (h) => !used.has(h) && HEADER_PATTERNS[field].test(h.trim()),
    );
    if (header !== undefined) {
      mapping[field] = header;
      used.add(header);
    }
  }
  return mapping;
}

const PEOPLE_PATTERNS: Readonly<Record<ContactImportField, RegExp>> = {
  firstName: /^(first[ _]?name|given[ _]?name|first|forename)$/i,
  lastName: /^(last[ _]?name|surname|family[ _]?name|last)$/i,
  email: /^(e-?mail( address)?|work e-?mail|business e-?mail)$/i,
  linkedinUrl: /^(linkedin( url| profile)?|linkedin profile url)$/i,
  title: /^(title|job title|position|role)$/i,
  company:
    /^(company( name)?|organi[sz]ation( name)?|account( name)?|employer)$/i,
  companyDomain: /^(company )?(domain|website)( name)?$/i,
  country: /^(country|country code)$/i,
};

/** A first guess for a people file, like guessMapping: each column at most once. */
export function guessContactMapping(
  headers: readonly string[],
): Partial<Record<ContactImportField, string>> {
  const used = new Set<string>();
  const mapping: Partial<Record<ContactImportField, string>> = {};
  for (const field of CONTACT_IMPORT_FIELDS) {
    const header = headers.find(
      (h) => !used.has(h) && PEOPLE_PATTERNS[field].test(h.trim()),
    );
    if (header !== undefined) {
      mapping[field] = header;
      used.add(header);
    }
  }
  return mapping;
}

/** A people mapping as the API wants it, or null while a required column isn't chosen. */
export function contactMappingFrom(
  choice: Partial<Record<ContactImportField, string>>,
): ContactImportMapping | null {
  const mapping: Record<string, string> = {};
  for (const field of CONTACT_IMPORT_FIELDS) {
    const column = choice[field];
    if (column !== undefined && column !== '') {
      mapping[field] = column;
    }
  }
  return mapping['firstName'] === undefined ||
    mapping['lastName'] === undefined ||
    mapping['company'] === undefined
    ? null
    : (mapping as ContactImportMapping);
}

/** The mapping as the API wants it, or null while no column is chosen for the name. */
export function mappingFrom(
  choice: Partial<Record<OrganizationImportField, string>>,
): ImportMapping | null {
  if (choice.name === undefined || choice.name === '') {
    return null;
  }
  const mapping: Record<string, string> = { name: choice.name };
  for (const field of ORGANIZATION_IMPORT_FIELDS) {
    const column = choice[field];
    if (field !== 'name' && column !== undefined && column !== '') {
      mapping[field] = column;
    }
  }
  return mapping as ImportMapping;
}

const OUTCOME_TEXT: Readonly<Record<ImportResult['outcome'], string>> = {
  CREATED: 'Saved (new)',
  MATCHED: 'Saved (already in the workspace)',
  EXCLUDED: 'Excluded',
  FAILED: 'Failed',
};

const isField = (field: string): field is OrganizationImportField =>
  (ORGANIZATION_IMPORT_FIELDS as readonly string[]).includes(field);
const isPeopleField = (field: string): field is ContactImportField =>
  (CONTACT_IMPORT_FIELDS as readonly string[]).includes(field);

const fieldText = (field: string) =>
  isPeopleField(field)
    ? CONTACT_IMPORT_FIELD_LABELS[field]
    : isField(field)
      ? ORGANIZATION_IMPORT_FIELD_LABELS[field]
      : field === 'person'
        ? 'Person'
        : 'Row';

/**
 * The error report: one line per reason of every excluded or failed record. Every cell goes
 * through toCsv, which keeps formulas as text (task 07C, D-07C-05).
 */
export function errorReportCsv(
  results: readonly ImportResult[],
  people = false,
): string {
  const rows: (string | number | null)[][] = [
    people
      ? ['Row', 'Outcome', 'Person', 'Email', 'Company', 'Field', 'Reason']
      : ['Row', 'Outcome', 'Company', 'Domain', 'Field', 'Reason'],
  ];
  for (const result of results) {
    if (result.outcome !== 'EXCLUDED' && result.outcome !== 'FAILED') {
      continue;
    }
    const issues =
      result.issues.length === 0
        ? [{ field: 'row', message: '' }]
        : result.issues;
    for (const issue of issues) {
      rows.push(
        people
          ? [
              result.position,
              OUTCOME_TEXT[result.outcome],
              result.name,
              result.email,
              result.company,
              fieldText(issue.field),
              issue.message,
            ]
          : [
              result.position,
              OUTCOME_TEXT[result.outcome],
              result.name,
              result.domain,
              fieldText(issue.field),
              issue.message,
            ],
      );
    }
  }
  return toCsv(rows);
}

export const outcomeText = (outcome: ImportResult['outcome']) =>
  OUTCOME_TEXT[outcome];

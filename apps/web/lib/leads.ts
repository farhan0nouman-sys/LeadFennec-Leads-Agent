// The lead screens' words and helpers (tasks 11A and 11B, docs/decisions.md D-11A-*, D-11B-*).
// Pure: no React, no fetch. The API decides everything; this module only shapes what a person
// typed into the API's requests and names things.
import {
  LEAD_CORRECTION_FIELDS,
  type ContactSourceProvider,
  type LeadCorrectionField,
  type LeadDetail,
} from '@lead-fennec-ai/shared';

export const leadListHref = (workspaceId: string) =>
  `/workspaces/${workspaceId}/leads`;

export const leadProfileHref = (workspaceId: string, contactId: string) =>
  `${leadListHref(workspaceId)}/${contactId}`;

export const SOURCE_LABELS: Readonly<Record<ContactSourceProvider, string>> = {
  APOLLO: 'Apollo',
  CSV_IMPORT: 'CSV import',
  MANUAL: 'Entered by a person',
  WEBSITE: 'Company website',
  FAKE: 'Development data (synthetic)',
};

export const CORRECTION_LABELS: Readonly<Record<LeadCorrectionField, string>> =
  {
    firstName: 'First name',
    lastName: 'Last name',
    title: 'Title',
    email: 'Email address',
    countryCode: 'Country (two letters)',
    linkedinUrl: 'LinkedIn profile',
  };

export type CorrectionForm = Readonly<Record<LeadCorrectionField, string>>;

/** The form's starting values: the lead as it is. */
export function correctionForm(lead: LeadDetail): CorrectionForm {
  return {
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    title: lead.title ?? '',
    email: lead.email ?? '',
    // The person's own country (the lead's may be the company's).
    countryCode: '',
    linkedinUrl: lead.linkedinUrl ?? '',
  };
}

/**
 * Only the fields a person changed, as the correction request wants them: empty text clears a
 * field (names can't be cleared: the API says so). Comparison ignores case for the address and
 * the country, as the API does.
 */
export function correctionChanges(
  start: CorrectionForm,
  form: CorrectionForm,
): Partial<Record<LeadCorrectionField, string | null>> {
  const changes: Partial<Record<LeadCorrectionField, string | null>> = {};
  for (const field of LEAD_CORRECTION_FIELDS) {
    const before = start[field].trim();
    const after = form[field].trim();
    const same =
      field === 'email' || field === 'countryCode'
        ? before.toLowerCase() === after.toLowerCase()
        : before === after;
    if (same) {
      continue;
    }
    changes[field] =
      after === '' && field !== 'firstName' && field !== 'lastName'
        ? null
        : after;
  }
  return changes;
}

/** Tags typed as text, comma-separated. The API normalizes and checks them. */
export function tagsFromText(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

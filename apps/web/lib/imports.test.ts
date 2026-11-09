import {
  parseCsv,
  ORGANIZATION_IMPORT_LIMITS,
  type ImportRun,
} from '@lead-fennec-ai/shared';
import { describe, expect, it } from 'vitest';
import {
  canFindPeople,
  contactMappingFrom,
  errorReportCsv,
  guessContactMapping,
  guessMapping,
  mappingFrom,
  runErrorText,
  runTitle,
} from './imports';

// The import screens' logic (task 07C).
describe('import screens', () => {
  it('guesses a mapping from common headers, each column once', () => {
    expect(
      guessMapping([
        'Company Name',
        'Website',
        'Domain',
        'Headcount',
        'Country',
        'Notes',
      ]),
    ).toEqual({
      name: 'Company Name',
      domain: 'Domain',
      website: 'Website',
      employees: 'Headcount',
      country: 'Country',
    });
    expect(guessMapping(['Foo', 'Bar'])).toEqual({});
    expect(mappingFrom({ domain: 'Domain' })).toBeNull();
    expect(
      mappingFrom({ name: 'Company', domain: '', country: 'Land' }),
    ).toEqual({ name: 'Company', country: 'Land' });
  });

  it('writes an error report a spreadsheet can only read as text', () => {
    const csv = errorReportCsv([
      {
        id: '00000000-0000-7000-8000-000000000001',
        position: 2,
        outcome: 'CREATED',
        name: 'Saved Co',
        domain: 'saved.example',
        kind: 'company',
        email: null,
        company: null,
        contactId: null,
        externalId: null,
        organizationId: '00000000-0000-7000-8000-000000000002',
        issues: [],
      },
      {
        id: '00000000-0000-7000-8000-000000000003',
        position: 5,
        outcome: 'FAILED',
        name: '=HYPERLINK("http://evil.example","x")',
        domain: '@evil.example',
        kind: 'company',
        email: null,
        company: null,
        contactId: null,
        externalId: null,
        organizationId: null,
        issues: [
          { field: 'domain', message: 'This is not a domain.' },
          {
            field: 'country',
            message: 'Use a two-letter country code, such as US.',
          },
        ],
      },
      {
        id: '00000000-0000-7000-8000-000000000004',
        position: 6,
        outcome: 'EXCLUDED',
        name: 'Rival, Inc.',
        domain: 'rival.example',
        kind: 'company',
        email: null,
        company: null,
        contactId: null,
        externalId: null,
        organizationId: null,
        issues: [
          {
            field: 'domain',
            message:
              "The domain rival.example is on this workspace's suppression list.",
          },
        ],
      },
    ]);
    const table = parseCsv(csv, ORGANIZATION_IMPORT_LIMITS);
    expect(table.headers).toEqual([
      'Row',
      'Outcome',
      'Company',
      'Domain',
      'Field',
      'Reason',
    ]);
    expect(table.rows).toEqual([
      [
        '5',
        'Failed',
        `'=HYPERLINK("http://evil.example","x")`,
        "'@evil.example",
        'Domain',
        'This is not a domain.',
      ],
      [
        '5',
        'Failed',
        `'=HYPERLINK("http://evil.example","x")`,
        "'@evil.example",
        'Country (two-letter code)',
        'Use a two-letter country code, such as US.',
      ],
      [
        '6',
        'Excluded',
        'Rival, Inc.',
        'rival.example',
        'Domain',
        "The domain rival.example is on this workspace's suppression list.",
      ],
    ]);
    expect(runErrorText('timeout')).toBe(
      'The search provider did not answer in time.',
    );
    expect(runErrorText('something_new')).toBe(
      'The search stopped because of an error.',
    );
  });
});

// People files (task 11C): a mapping guess, the required columns, and a report of people whose
// cells stay text in a spreadsheet.
describe('people imports', () => {
  it('guesses a people mapping and needs a first, a last and a company name', () => {
    const guess = guessContactMapping([
      'First Name',
      'Surname',
      'Work Email',
      'Job Title',
      'Company',
      'Website',
      'LinkedIn',
      'Notes',
    ]);
    expect(guess).toEqual({
      firstName: 'First Name',
      lastName: 'Surname',
      email: 'Work Email',
      title: 'Job Title',
      company: 'Company',
      companyDomain: 'Website',
      linkedinUrl: 'LinkedIn',
    });
    expect(contactMappingFrom({ firstName: 'First Name', lastName: '' })).toBe(
      null,
    );
    expect(
      contactMappingFrom({
        firstName: 'First Name',
        lastName: 'Surname',
        company: 'Company',
        email: '',
      }),
    ).toEqual({
      firstName: 'First Name',
      lastName: 'Surname',
      company: 'Company',
    });
  });

  it('writes a people report a spreadsheet can only read as text', () => {
    const csv = errorReportCsv(
      [
        {
          id: '00000000-0000-7000-8000-000000000011',
          position: 3,
          kind: 'person',
          outcome: 'EXCLUDED',
          name: 'Pat Doe',
          domain: 'acme.example',
          email: 'pat@acme.example',
          company: '=cmd|calc',
          externalId: null,
          organizationId: null,
          contactId: null,
          issues: [
            {
              field: 'email',
              message: 'This address is on the do-not-contact list.',
            },
          ],
        },
      ],
      true,
    );
    expect(csv.split('\r\n')).toEqual([
      'Row,Outcome,Person,Email,Company,Field,Reason',
      "3,Excluded,Pat Doe,pat@acme.example,'=cmd|calc,Email address,This address is on the do-not-contact list.",
      '',
    ]);
    expect(runErrorText('internal_error', true)).toBe(
      'Something went wrong while importing the file.',
    );
  });
});

// Finding people for a run's companies (task 08C).
describe('people search', () => {
  const run = (overrides: Partial<ImportRun>): ImportRun => ({
    id: '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10',
    source: 'ORGANIZATION_SEARCH',
    status: 'COMPLETED',
    enrichment: null,
    contactImport: null,
    search: null,
    fileName: null,
    counts: {
      found: 3,
      saved: 3,
      created: 3,
      excluded: 0,
      failed: 0,
      repeated: 0,
    },
    pagesFetched: 1,
    errorCode: null,
    createdAt: '2026-11-08T09:00:00.000Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  });

  it('is offered for finished runs that saved companies, never for people searches', () => {
    expect(canFindPeople(run({}))).toBe(true);
    expect(canFindPeople(run({ source: 'CSV', status: 'COMPLETED' }))).toBe(
      true,
    );
    expect(canFindPeople(run({ status: 'PROCESSING' }))).toBe(false);
    expect(
      canFindPeople(
        run({
          counts: {
            found: 2,
            saved: 0,
            created: 0,
            excluded: 2,
            failed: 0,
            repeated: 0,
          },
        }),
      ),
    ).toBe(false);
    expect(canFindPeople(run({ source: 'CONTACT_ENRICHMENT' }))).toBe(false);
    expect(runTitle(run({ source: 'CONTACT_ENRICHMENT' }))).toBe(
      'People search',
    );
    expect(runErrorText('provider_unavailable')).toMatch(/people provider/);
  });
});

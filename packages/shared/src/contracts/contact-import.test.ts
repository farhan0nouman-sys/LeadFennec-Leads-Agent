import { describe, expect, it } from 'vitest';
import {
  contactImportMappingSchema,
  contactImportPayload,
  contactImportRequestSchema,
  normalizeContactImportRow,
} from './contact-import.js';

// People imports (task 11C): the mapping, the request, and one row's safe normalization.
describe('people import rows', () => {
  it('turns a row into a person and their company, values cleaned', () => {
    const result = normalizeContactImportRow({
      firstName: '  Nora ',
      lastName: 'Field\u0007',
      email: 'Nora.Field@Field.Example',
      title: '=SUM(A1)',
      company: 'Field   Co',
      companyDomain: 'https://www.field.example/',
      country: 'de',
    });
    expect(result).toMatchObject({
      ok: true,
      contact: {
        identity: {
          firstName: 'Nora',
          lastName: 'Field',
          email: 'nora.field@field.example',
          organizationDomain: 'field.example',
        },
        // A formula is kept as text: nothing in a cell is evaluated.
        title: '=SUM(A1)',
        countryCode: 'DE',
        company: { name: 'Field Co', domain: 'field.example' },
      },
    });
  });

  it('says why a row is refused, by field', () => {
    const refused = (
      cells: Parameters<typeof normalizeContactImportRow>[0],
    ) => {
      const result = normalizeContactImportRow(cells);
      return result.ok ? [] : result.issues.map((issue) => issue.field);
    };
    expect(
      refused({
        firstName: '',
        lastName: 'x'.repeat(101),
        email: 'not-an-address',
        linkedinUrl: 'https://example.com/in/x',
        title: 't'.repeat(201),
        company: '',
        companyDomain: 'not a domain',
        country: 'Germany',
      }),
    ).toEqual([
      'firstName',
      'lastName',
      'email',
      'linkedinUrl',
      'companyDomain',
      'title',
      'country',
      'company',
    ]);
    // Nothing identifies the person: no address, profile or company domain.
    expect(
      refused({ firstName: 'No', lastName: 'Identity', company: 'Nameless' }),
    ).toEqual(['person']);
  });

  it('keeps only the mapped cells in the payload, with the address normalized', () => {
    expect(
      contactImportPayload(
        {
          firstName: 'Bad',
          lastName: 'Row',
          email: ' Pat@Acme.Example ',
          company: 'Acme',
        },
        null,
      ),
    ).toEqual({
      kind: 'person',
      name: 'Bad Row',
      email: 'pat@acme.example',
      company: 'Acme',
      domain: null,
      cells: {
        firstName: 'Bad',
        lastName: 'Row',
        email: ' Pat@Acme.Example ',
        company: 'Acme',
      },
    });
  });

  it('needs the first name, last name and company columns, each column once', () => {
    expect(
      contactImportMappingSchema.safeParse({ firstName: 'F', lastName: 'L' })
        .success,
    ).toBe(false);
    expect(
      contactImportMappingSchema.safeParse({
        firstName: 'Name',
        lastName: 'name',
        company: 'Company',
      }).error?.issues[0]?.message,
    ).toBe('This column is already used for another field.');
    expect(
      contactImportRequestSchema.safeParse({
        fileName: 'x.csv',
        content: 'a',
        mapping: { firstName: 'F', lastName: 'L', company: 'C' },
        leadListId: 'not-an-id',
      }).error?.issues[0]?.message,
    ).toBe('Not found in this workspace.');
  });
});

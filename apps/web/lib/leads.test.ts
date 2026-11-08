import { describe, expect, it } from 'vitest';
import {
  correctionChanges,
  leadProfileHref,
  tagsFromText,
  type CorrectionForm,
} from './leads';

// The lead screens' helpers (task 11B).
const start: CorrectionForm = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  title: 'VP Sales',
  email: 'Ada@Acme.example',
  countryCode: '',
  linkedinUrl: '',
};

describe('lead screens', () => {
  it('sends only the fields a person changed', () => {
    expect(correctionChanges(start, start)).toEqual({});
    expect(
      correctionChanges(start, {
        ...start,
        email: 'ada@acme.example',
        title: ' VP Sales ',
      }),
    ).toEqual({});
    expect(
      correctionChanges(start, {
        ...start,
        title: '',
        countryCode: 'de',
        linkedinUrl: 'https://www.linkedin.com/in/ada',
      }),
    ).toEqual({
      title: null,
      countryCode: 'de',
      linkedinUrl: 'https://www.linkedin.com/in/ada',
    });
    // A name can't be cleared: the empty text goes to the API, which says so.
    expect(correctionChanges(start, { ...start, lastName: '' })).toEqual({
      lastName: '',
    });
  });

  it('reads tags from text and links to a profile', () => {
    expect(tagsFromText(' vip, warm lead ,, ')).toEqual(['vip', 'warm lead']);
    expect(tagsFromText('')).toEqual([]);
    expect(leadProfileHref('w1', 'c1')).toBe('/workspaces/w1/leads/c1');
  });
});

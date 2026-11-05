import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_BOUNDS,
  CAMPAIGN_ERROR_CODES,
  campaignReadiness,
  createCampaignRequestSchema,
  updateCampaignRequestSchema,
} from './campaigns.js';
import { API, API_ERROR_STATUS } from './endpoints.js';

const ID = '0b7f4e2a-3c1d-4e5f-8a9b-1c2d3e4f5a6b';
const save = (change: Record<string, unknown>) =>
  updateCampaignRequestSchema.safeParse({ version: 1, ...change });
const ok = (change: Record<string, unknown>) => {
  const result = save(change);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return result.data;
};
const issuesOf = (change: Record<string, unknown>) => {
  const result = save(change);
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
};

describe('campaign configuration contract (task 06A)', () => {
  it('normalizes the time zone, exclusions and country codes', () => {
    expect(ok({ timezone: ' europe/berlin ' })?.timezone).toBe('Europe/Berlin');
    expect(
      ok({
        exclusions: {
          domains: ['WWW.Example.COM', 'example.com', 'b.example.org'],
          emails: ['Ann@Example.COM', 'ann@example.com'],
          leadListIds: [ID, ID],
        },
      })?.exclusions,
    ).toEqual({
      domains: ['b.example.org', 'example.com'],
      emails: ['ann@example.com'],
      leadListIds: [ID],
    });
    expect(
      ok({ audience: { filters: { countries: ['de', ' at '] } } })?.audience
        ?.filters?.countries,
    ).toEqual(['DE', 'AT']);
  });

  it('accepts a partial section while the draft is incomplete', () => {
    expect(ok({ businessProfile: { companyName: 'Only a name' } })).toEqual({
      version: 1,
      businessProfile: { companyName: 'Only a name' },
    });
    expect(ok({ leadLimits: { dailyNewLeads: 10 } })?.leadLimits).toEqual({
      dailyNewLeads: 10,
    });
    // Clearing a section, or choosing no mailbox yet, is a valid save.
    expect(
      ok({ businessProfile: null, sender: { emailAccountId: null } }),
    ).toEqual({
      version: 1,
      businessProfile: null,
      sender: { emailAccountId: null },
    });
  });

  it('checks every bound', () => {
    const B = CAMPAIGN_BOUNDS;
    expect(
      issuesOf({ leadLimits: { dailyNewLeads: B.dailyNewLeads + 1 } }),
    ).toEqual(['leadLimits.dailyNewLeads']);
    expect(issuesOf({ leadLimits: { maxLeads: 0 } })).toEqual([
      'leadLimits.maxLeads',
    ]);
    expect(
      issuesOf({ leadLimits: { dailyNewLeads: 50, maxLeads: 49 } }),
    ).toEqual(['leadLimits.dailyNewLeads']);
    expect(
      issuesOf({
        sequence: {
          steps: Array.from({ length: B.steps + 1 }, () => ({
            delayMinutes: 0,
          })),
        },
      }),
    ).toEqual(['sequence.steps']);
    expect(
      issuesOf({
        sequence: { steps: [{ delayMinutes: B.stepDelayMinutes + 1 }] },
      }),
    ).toEqual(['sequence.steps.0.delayMinutes']);
    expect(
      issuesOf({
        schedule: {
          weekdays: [1, 1],
          windowStartMinute: 0,
          windowEndMinute: 60,
        },
      }),
    ).toEqual(['schedule.weekdays']);
    expect(
      issuesOf({
        schedule: {
          weekdays: [8],
          windowStartMinute: 600,
          windowEndMinute: 540,
        },
      }),
    ).toEqual(['schedule.weekdays.0', 'schedule.windowEndMinute']);
    expect(
      issuesOf({
        audience: { filters: { employeeCountMin: 500, employeeCountMax: 50 } },
      }),
    ).toEqual(['audience.filters.employeeCountMax']);
    expect(issuesOf({ audience: { filters: { countries: ['USA'] } } })).toEqual(
      ['audience.filters.countries.0'],
    );
    expect(
      issuesOf({
        exclusions: {
          domains: Array.from(
            { length: B.excludedEntries + 1 },
            (_, i) => `d${String(i)}.example.com`,
          ),
        },
      }),
    ).toEqual(['exclusions.domains']);
    expect(issuesOf({ exclusions: { emails: ['not-an-address'] } })).toEqual([
      'exclusions.emails.0',
    ]);
    expect(issuesOf({ offer: { name: 'x'.repeat(B.shortText + 1) } })).toEqual([
      'offer.name',
    ]);
    expect(issuesOf({ offer: { name: '   ' } })).toEqual(['offer.name']);
    expect(issuesOf({ timezone: 'Atlantis/Lost' })).toEqual(['timezone']);
  });

  it('accepts only web addresses for the website', () => {
    for (const website of [
      'javascript:alert(1)',
      'ftp://example.com',
      'example.com',
      'https://localhost',
    ]) {
      expect(issuesOf({ businessProfile: { website } }), website).toEqual([
        'businessProfile.website',
      ]);
    }
    expect(
      ok({ businessProfile: { website: 'https://www.example.com/about' } }),
    ).toBeDefined();
  });

  it('refuses unknown fields, a status change and an empty save', () => {
    // An unknown field, and nothing to change: both at the top level.
    expect([...new Set(issuesOf({ status: 'ACTIVE' }))]).toEqual(['']);
    expect(issuesOf({ offer: { price: 10 } })).toEqual(['offer']);
    expect(issuesOf({})).toEqual(['']);
    expect(
      updateCampaignRequestSchema.safeParse({ version: 0, name: 'x' }).success,
    ).toBe(false);
    expect(createCampaignRequestSchema.safeParse({ name: '' }).success).toBe(
      false,
    );
  });

  it('says what a campaign still needs', () => {
    const empty = {
      businessProfile: null,
      offer: null,
      audience: { icpId: null, leadListId: null },
      leadLimits: { dailyNewLeads: null, maxLeads: null },
      sender: { emailAccountId: null },
      stepCount: 0,
    };
    expect(campaignReadiness(empty).missing).toHaveLength(6);
    expect(
      campaignReadiness({
        businessProfile: { companyName: 'A' },
        offer: { name: 'B', description: 'C' },
        audience: { icpId: ID, leadListId: null },
        leadLimits: { dailyNewLeads: 1, maxLeads: 1 },
        sender: { emailAccountId: ID },
        stepCount: 1,
      }),
    ).toEqual({ complete: false, missing: ['businessProfile'] });
  });

  it('declares its errors and its endpoints', () => {
    for (const code of CAMPAIGN_ERROR_CODES) {
      expect(API_ERROR_STATUS[code]).toBe(409);
    }
    expect(API.campaigns.update.errors).toContain('version_conflict');
    expect(API.campaigns.update.permission).toBe('campaigns.write');
    expect(API.campaigns.get.permission).toBe('campaigns.read');
    expect(API.campaigns.duplicate.invalidates).toContain('campaigns');
  });
});

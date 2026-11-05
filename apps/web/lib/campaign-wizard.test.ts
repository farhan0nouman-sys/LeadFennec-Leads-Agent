import {
  CAMPAIGN_SETUP_STAGES,
  campaignSchema,
  type Campaign,
} from '@lead-fennec-ai/shared';
import { describe, expect, it } from 'vitest';
import {
  audienceForm,
  businessProfileForm,
  checkSave,
  filtersForm,
  isDirty,
  mailboxForm,
  mapIssues,
  minutesOf,
  offerForm,
  reviewForm,
  scheduleForm,
  sequenceForm,
  stageFromParam,
  stageState,
  WIZARD_STAGES,
  type StageForm,
} from './campaign-wizard';

const ID = (n: number) =>
  `0b7f4e2a-3c1d-4e5f-8a9b-${String(n).padStart(12, '0')}`;

/** A campaign as the API returns it (validated with the contract's own schema). */
const campaign = (overrides: Partial<Campaign> = {}): Campaign =>
  campaignSchema.parse({
    id: ID(1),
    name: 'Spring outreach',
    description: null,
    status: 'DRAFT',
    version: 4,
    approvalMode: 'HUMAN',
    businessProfile: null,
    offer: null,
    audience: { icpId: null, leadListId: null, filters: {} },
    exclusions: {
      domains: [],
      emails: [],
      leadListIds: [],
      skipContactsInOtherCampaigns: true,
    },
    leadLimits: { dailyNewLeads: null, maxLeads: null },
    timezone: 'UTC',
    schedule: {
      weekdays: [1, 2, 3, 4, 5],
      windowStartMinute: 540,
      windowEndMinute: 1020,
    },
    sender: { emailAccountId: null },
    sequence: { steps: [] },
    readiness: {
      complete: false,
      missing: [
        'businessProfile',
        'offer',
        'audience',
        'leadLimits',
        'sender',
        'sequence',
      ],
    },
    createdAt: '2026-11-04T09:00:00.000Z',
    updatedAt: '2026-11-04T09:00:00.000Z',
    ...overrides,
  });

const full = campaign({
  description: 'Second quarter',
  businessProfile: {
    companyName: 'Example Co',
    website: 'https://example.com',
    description: 'We build examples.',
    valueProposition: 'Fast and friendly.',
  },
  offer: {
    name: 'Audit',
    description: 'A free audit.',
    callToAction: 'Book a call',
    proofPoints: ['Used by 40 teams', 'Two-week setup'],
  },
  audience: {
    icpId: ID(2),
    leadListId: ID(3),
    filters: {
      countries: ['DE', 'AT'],
      industries: ['Software'],
      titles: ['Head of Sales', 'CRO'],
      employeeCountMin: 10,
      employeeCountMax: 500,
    },
  },
  exclusions: {
    domains: ['example.org'],
    emails: ['someone@example.net'],
    leadListIds: [ID(4)],
    skipContactsInOtherCampaigns: false,
  },
  leadLimits: { dailyNewLeads: 25, maxLeads: 500 },
  timezone: 'Europe/Vienna',
  schedule: {
    weekdays: [1, 3, 5],
    windowStartMinute: 480,
    windowEndMinute: 1440,
  },
  sender: { emailAccountId: ID(5) },
  sequence: {
    steps: [
      { id: ID(6), position: 1, delayMinutes: 0, templateId: ID(7) },
      { id: ID(8), position: 2, delayMinutes: 2970, templateId: null },
    ],
  },
});

/** A stage form with its value type erased, for tables of cases. */
const erase = <V>(form: StageForm<V>) => ({
  rules: form.rules,
  stored: (subject: Campaign) => form.toChange(form.initial(subject), subject),
  dirty: (subject: Campaign) => isDirty(form, form.initial(subject), subject),
  initial: (subject: Campaign) => form.initial(subject) as unknown,
  from: (values: unknown, subject: Campaign) =>
    form.toChange(values as V, subject),
});

const FORMS = {
  'business-profile': erase(businessProfileForm),
  audience: erase(audienceForm),
  offer: erase(offerForm),
  filters: erase(filtersForm),
  mailbox: erase(mailboxForm),
  sequence: erase(sequenceForm),
  schedule: erase(scheduleForm),
  review: erase(reviewForm),
};

describe('campaign wizard (task 06B)', () => {
  it('has the eight stages, in order', () => {
    expect(WIZARD_STAGES.map((stage) => stage.label)).toEqual([
      'Business profile',
      'Target audience',
      'Offer',
      'Lead filters',
      'Mailbox',
      'Sequence',
      'Schedule',
      'Review',
    ]);
    // The activation checks (06C) link to these keys.
    expect(WIZARD_STAGES.map((stage) => stage.key)).toEqual([
      ...CAMPAIGN_SETUP_STAGES,
    ]);
    expect(stageFromParam('mailbox')).toBe('mailbox');
    expect(stageFromParam('../admin')).toBe('business-profile');
    expect(stageFromParam(null)).toBe('business-profile');
  });

  it('gives back exactly what is stored when nothing changed (nothing is lost on reopening)', () => {
    for (const subject of [full, campaign()]) {
      for (const [stage, form] of Object.entries(FORMS)) {
        const change = form.stored(subject);
        // An unchanged stage is a valid save, complete or not.
        expect(checkSave(subject.version, change).ok, stage).toBe(true);
        expect(form.dirty(subject), stage).toBe(false);
      }
    }
    const values = (form: (typeof FORMS)[keyof typeof FORMS]) =>
      form.stored(full);
    expect(values(FORMS['business-profile'])).toEqual({
      businessProfile: full.businessProfile,
    });
    expect(values(FORMS.offer)).toEqual({
      offer: full.offer,
    });
    expect(values(FORMS.audience)).toEqual({
      audience: full.audience,
    });
    expect(values(FORMS.filters)).toEqual({
      audience: full.audience,
      exclusions: full.exclusions,
      leadLimits: full.leadLimits,
    });
    expect(values(FORMS.mailbox)).toEqual({
      sender: full.sender,
    });
    expect(values(FORMS.sequence)).toEqual({
      sequence: {
        steps: full.sequence.steps.map(({ delayMinutes, templateId }) => ({
          delayMinutes,
          templateId,
        })),
      },
    });
    expect(values(FORMS.schedule)).toEqual({
      timezone: full.timezone,
      schedule: full.schedule,
    });
    expect(values(FORMS.review)).toEqual({
      name: full.name,
      description: full.description,
    });
  });

  it('saves a stage with some fields left blank (an incomplete draft)', () => {
    const empty = campaign();
    const offer = offerForm.toChange(
      {
        name: 'Audit',
        description: '',
        callToAction: '  ',
        proofPoints: '\n\n',
      },
      empty,
    );
    expect(offer).toEqual({ offer: { name: 'Audit' } });
    expect(checkSave(empty.version, offer).ok).toBe(true);
    // Everything blank clears the section.
    expect(
      businessProfileForm.toChange(
        { companyName: '', website: '', description: '', valueProposition: '' },
        empty,
      ),
    ).toEqual({ businessProfile: null });
  });

  it('puts every message the API would give next to its field, in the same words', () => {
    const cases: readonly [
      (typeof FORMS)[keyof typeof FORMS],
      unknown,
      string,
      string,
    ][] = [
      [
        FORMS['business-profile'],
        {
          companyName: 'A',
          website: 'javascript:alert(1)',
          description: '',
          valueProposition: '',
        },
        'website',
        'Enter a web address starting with http:// or https://.',
      ],
      [
        FORMS.offer,
        {
          name: 'x'.repeat(201),
          description: '',
          callToAction: '',
          proofPoints: '',
        },
        'name',
        'Use at most 200 characters.',
      ],
      [
        FORMS.offer,
        {
          name: '',
          description: '',
          callToAction: '',
          proofPoints: `ok\n${'p'.repeat(301)}`,
        },
        'proofPoints',
        'Line 2: Use at most 300 characters.',
      ],
      [
        FORMS.filters,
        { ...filtersForm.initial(full), countries: 'DE, USA' },
        'countries',
        'Entry 2: Use two-letter country codes, such as US.',
      ],
      [
        FORMS.filters,
        { ...filtersForm.initial(full), dailyNewLeads: '501' },
        'dailyNewLeads',
        'Use at most 500 a day.',
      ],
      [
        FORMS.filters,
        { ...filtersForm.initial(full), dailyNewLeads: '2.5' },
        'dailyNewLeads',
        'Use a whole number.',
      ],
      [
        FORMS.filters,
        {
          ...filtersForm.initial(full),
          excludedEmails: 'ok@example.com\nnope',
        },
        'excludedEmails',
        'Line 2: Enter an email address.',
      ],
      [
        FORMS.filters,
        {
          ...filtersForm.initial(full),
          employeeCountMin: '50',
          employeeCountMax: '10',
        },
        'employeeCountMax',
        'Use a maximum at least as large as the minimum.',
      ],
      [
        FORMS.sequence,
        {
          steps: [
            { key: 'a', days: '0', hours: '0', templateId: '' },
            { key: 'b', days: '366', hours: '0', templateId: '' },
          ],
        },
        'steps.1.delay',
        'Use a delay of at most one year.',
      ],
      [
        FORMS.sequence,
        { steps: [{ key: 'a', days: '-1', hours: '0', templateId: '' }] },
        'steps.0.delay',
        'Use a delay of zero or more.',
      ],
      [
        FORMS.schedule,
        {
          timezone: 'UTC',
          weekdays: [1],
          windowStartMinute: '600',
          windowEndMinute: '540',
        },
        'windowEndMinute',
        'End the sending window after it starts.',
      ],
      [
        FORMS.schedule,
        {
          timezone: 'UTC',
          weekdays: [],
          windowStartMinute: '0',
          windowEndMinute: '60',
        },
        'weekdays',
        'Choose at least one day.',
      ],
      [
        FORMS.schedule,
        {
          timezone: 'Atlantis/Lost',
          weekdays: [1],
          windowStartMinute: '0',
          windowEndMinute: '60',
        },
        'timezone',
        'Choose a time zone such as Europe/Berlin.',
      ],
      [
        FORMS.review,
        { name: '   ', description: '' },
        'name',
        'Enter a name for the campaign.',
      ],
    ];
    for (const [form, values, field, message] of cases) {
      const checked = checkSave(full.version, form.from(values, full));
      expect(checked.ok, field).toBe(false);
      if (!checked.ok) {
        const mapped = mapIssues(form.rules, checked.issues);
        expect(mapped.other, field).toEqual([]);
        expect(mapped.fields[field], field).toBe(message);
      }
    }
  });

  it("maps the API's reference issues to the stage's fields", () => {
    const notFound = 'Not found in this workspace.';
    expect(
      mapIssues(audienceForm.rules, [
        { path: 'audience.leadListId', message: notFound },
      ]).fields,
    ).toEqual({ leadListId: notFound });
    expect(
      mapIssues(filtersForm.rules, [
        { path: 'exclusions.leadListIds.1', message: notFound },
      ]).fields,
    ).toEqual({ excludedLeadListIds: `Entry 2: ${notFound}` });
    expect(
      mapIssues(sequenceForm.rules, [
        { path: 'sequence.steps.0.templateId', message: notFound },
      ]).fields,
    ).toEqual({ 'steps.0.template': notFound });
    expect(
      mapIssues(mailboxForm.rules, [
        {
          path: 'sender.emailAccountId',
          message: 'This mailbox is disconnected.',
        },
      ]).fields,
    ).toEqual({ emailAccountId: 'This mailbox is disconnected.' });
    // Something of another stage is shown above the form, never dropped.
    expect(
      mapIssues(filtersForm.rules, [
        { path: 'audience.icpId', message: notFound },
      ]),
    ).toEqual({ fields: {}, other: [notFound] });
  });

  it('turns days and hours into minutes', () => {
    expect(minutesOf({ days: '1', hours: '2' })).toBe(1560);
    expect(minutesOf({ days: '', hours: '' })).toBe(0);
    expect(minutesOf({ days: '0', hours: '0.1' })).toBe(6);
    expect(Number.isNaN(minutesOf({ days: 'x', hours: '' }))).toBe(true);
  });

  it('marks the stages that are done', () => {
    const state = (subject: Campaign) =>
      WIZARD_STAGES.map((stage) => stageState(stage, subject));
    expect(state(campaign())).toEqual([
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
      'done',
      'todo',
    ]);
    expect(
      state(campaign({ readiness: { complete: true, missing: [] } })),
    ).toEqual(Array<string>(8).fill('done'));
  });
});

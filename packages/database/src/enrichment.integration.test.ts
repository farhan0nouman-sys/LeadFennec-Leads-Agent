import { randomUUID } from 'node:crypto';
import {
  normalizeCompanyIdentity,
  parseContactEnrichmentOutput,
  type AcceptedContact,
  type EmailVerificationStatus,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { memberScope, systemScope } from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
} from './tenancy/authorization.js';
import { RECHECK_TASK_TYPE } from './tenancy/contact-quality.js';
import {
  ENRICHMENT_TASK_TYPE,
  EnrichmentRequestError,
  NoEmailAddressError,
  RecheckLimitError,
  VerificationUnavailableError,
  type CheckInput,
  type PersonInput,
} from './tenancy/enrichment.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Contact enrichment (task 08C, docs/decisions.md D-08C-*) on real PostgreSQL: a request copies
// its inputs and is bounded; each company is saved once, with its people, their checks and the
// usage it paid for; repeated enrichment matches people instead of duplicating them and reuses
// recent lookups; people who can't be emailed are kept with the reasons and stay off the
// campaign's lead list; quality is judged from stored facts; rechecks are limited and fail
// closed; and every run stays in its workspace. Runs only when TEST_DATABASE_URL is set;
// otherwise it is reported as skipped.
const db = new MigratedSchema('t08c');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
let clock = new Date('2026-11-08T09:00:00Z');
const now = () => clock;
const tag = randomUUID().slice(0, 6);
const ACME = `acme-${tag}.example`;
const GLOBEX = `globex-${tag}.example`;
const INITECH = `initech-${tag}.example`;
const CAPABILITIES = {
  supportedFilters: [
    'industries',
    'countries',
    'employees',
    'keywords',
    'technologies',
    'annualRevenue',
  ] as const,
  maxPageSize: 25,
  maxResultsPerSearch: 100,
  attribution: 'Synthetic companies.',
};
const PEOPLE = { source: 'FAKE', attribution: 'Synthetic people.' } as const;

describe.runIf(testDatabaseUrl !== undefined)(
  'contact enrichment on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let icpId: string;
    let sourceRunId: string;
    let runId: string;
    const orgs: Record<'acme' | 'globex' | 'initech', string> = {
      acme: '',
      globex: '',
      initech: '',
    };
    const people: Record<string, string> = {};

    const admin = () =>
      memberScope(
        prisma,
        { tenantId: alpha.tenant, userId: FIXTURE_USERS.alphaAdmin.id },
        { now },
      );
    const member = () =>
      memberScope(
        prisma,
        { tenantId: alpha.tenant, userId: FIXTURE_USERS.sharedMember.id },
        { now },
      );
    const worker = (tenantId = alpha.tenant) =>
      systemScope(prisma, { tenantId, name: 'contact_enrichment' }, { now });

    /** People as the agent accepts them (application code ranks them), by provider id. */
    function accepted(
      company: { id: string; name: string; domain: string },
      list: readonly {
        id: string;
        first: string;
        last: string;
        title: string;
        email: string | null;
      }[],
    ): Map<string, AcceptedContact> {
      const input = {
        organization: company,
        targeting: { titles: ['VP Sales', 'Head of Revenue'], seniorities: [] },
        maxContacts: 5,
      };
      const provenance = (id: string) => ({
        provider: 'FAKE' as const,
        externalId: id,
        retrievedAt: clock.toISOString(),
        attribution: 'Synthetic people.',
      });
      const parsed = parseContactEnrichmentOutput(
        {
          contacts: list.map((p) => ({
            firstName: p.first,
            lastName: p.last,
            title: p.title,
            seniority: null,
            linkedinUrl: null,
            email:
              p.email === null
                ? null
                : { address: p.email, provenance: provenance(p.id) },
            provenance: provenance(p.id),
          })),
        },
        input,
      );
      if (!parsed.ok) {
        throw new Error('not accepted');
      }
      return new Map(
        parsed.contacts.map((c) => [c.provenance.externalId ?? '', c]),
      );
    }

    const checked = (
      address: string,
      status: EmailVerificationStatus,
    ): CheckInput => ({
      kind: 'checked',
      check: {
        address,
        status,
        reason: status === 'invalid' ? 'no_mailbox' : null,
        provider: 'FAKE',
        checkedAt: clock.toISOString(),
      },
    });

    const person = (
      contact: AcceptedContact | undefined,
      check: CheckInput,
    ): PersonInput => {
      if (contact === undefined) {
        throw new Error('missing contact');
      }
      return {
        kind: 'accepted',
        contact,
        received: {
          search: { synthetic: true },
          enrichment: { synthetic: true },
          providerClaim: 'provider_verified',
          emailDropped: null,
        },
        check,
      };
    };

    const ledger = async () =>
      (
        await prisma.usageLedgerEntry.aggregate({
          where: { tenantId: alpha.tenant, metric: 'LEAD_ENRICHMENTS' },
          _sum: { quantity: true },
        })
      )._sum.quantity ?? 0n;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      // An ICP that targets revenue leaders in the US; a finished search that saved three
      // companies (one in the US, one in Germany, one whose country is unknown).
      const icp = await prisma.icp.create({
        data: {
          tenantId: alpha.tenant,
          name: `US revenue leaders ${tag}`,
          criteria: {
            industries: ['software'],
            countries: ['US'],
            titles: ['VP Sales', 'Head of Revenue'],
          },
        },
      });
      icpId = icp.id;
      const search = await (
        await admin()
      ).discovery.request(
        { icpId, maxResults: 10 },
        { source: 'FAKE', capabilities: CAPABILITIES },
      );
      sourceRunId = search.id;
      const discovery = systemScope(
        prisma,
        { tenantId: alpha.tenant, name: 'lead_discovery' },
        { now },
      ).discovery;
      await discovery.beginSearch(sourceRunId);
      const company = (
        name: string,
        domain: string,
        countryCode: string | null,
      ) => ({
        identity: normalizeCompanyIdentity({ name, domain }),
        websiteUrl: `https://${domain}/`,
        industry: 'software',
        employeeCount: 100,
        countryCode,
        source: {
          provider: 'FAKE' as const,
          externalId: `org-${domain}`,
          retrievedAt: clock,
        },
        raw: { synthetic: true },
      });
      await discovery.saveSearchPage(sourceRunId, {
        organizations: [
          company('Acme', ACME, 'US'),
          company('Globex', GLOBEX, 'DE'),
          company('Initech', INITECH, null),
        ],
        rejected: [],
        received: 3,
        nextPageToken: null,
      });
      await discovery.finishSearch(sourceRunId);
      for (const [key, domain] of [
        ['acme', ACME],
        ['globex', GLOBEX],
        ['initech', INITECH],
      ] as const) {
        const row = await prisma.organization.findUniqueOrThrow({
          where: {
            tenantId_normalizedDomain: {
              tenantId: alpha.tenant,
              normalizedDomain: domain,
            },
          },
        });
        orgs[key] = row.id;
      }
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('refuses requests it can not run, and anyone but a member', async () => {
      const scope = await admin();
      // The fixture search is still queued.
      const running = await scope.enrichment
        .request(alpha.importSearch, {}, PEOPLE)
        .catch((error: unknown) => error);
      expect(running).toBeInstanceOf(EnrichmentRequestError);
      expect(
        (running as EnrichmentRequestError).issues.map((issue) => issue.path),
      ).toContain('importId');
      // Another workspace's run reads like a missing one.
      await expect(
        scope.enrichment.request(beta.importSearch, {}, PEOPLE),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      const foreign = await scope.enrichment
        .request(sourceRunId, { campaignId: beta.campaign }, PEOPLE)
        .catch((error: unknown) => error);
      expect(foreign).toBeInstanceOf(EnrichmentRequestError);
      expect((foreign as EnrichmentRequestError).issues).toContainEqual({
        path: 'campaignId',
        message: 'Not found in this workspace.',
      });
      await expect(
        worker().enrichment.request(sourceRunId, {}, PEOPLE),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
      await expect(
        scope.enrichment.request(
          sourceRunId,
          { maxContactsPerCompany: 9 },
          PEOPLE,
        ),
      ).rejects.toThrow();
    });

    it('queues a bounded run with its inputs copied in', async () => {
      const run = await (
        await member()
      ).enrichment.request(
        sourceRunId,
        { campaignId: alpha.campaign, maxContactsPerCompany: 3 },
        PEOPLE,
      );
      runId = run.id;
      expect(run).toMatchObject({
        source: 'CONTACT_ENRICHMENT',
        status: 'PENDING',
        search: null,
        enrichment: {
          sourceImportId: sourceRunId,
          icpId,
          campaignId: alpha.campaign,
          leadListId: alpha.leadList,
          provider: 'FAKE',
          targeting: {
            titles: ['VP Sales', 'Head of Revenue'],
            seniorities: [],
            countries: ['US'],
          },
          maxContactsPerCompany: 3,
          companies: { total: 3, done: 0, skipped: 0, beyondLimit: 0 },
        },
      });
      const task = await prisma.jobTask.findFirstOrThrow({
        where: { tenantId: alpha.tenant, taskType: ENRICHMENT_TASK_TYPE },
      });
      expect(task.payload).toEqual({ importId: runId });
      expect(
        await prisma.auditRecord.count({
          where: {
            tenantId: alpha.tenant,
            action: 'contact_enrichment.requested',
            targetId: runId,
          },
        }),
      ).toBe(1);
      // What was asked, and where people go, never changes.
      await expect(
        prisma.$executeRaw`UPDATE imports SET search_filters = '{"titles":[],"seniorities":[],"countries":[]}'::jsonb WHERE id = ${runId}::uuid`,
      ).rejects.toThrow();
      await expect(
        prisma.$executeRaw`UPDATE imports SET lead_list_id = NULL WHERE id = ${runId}::uuid`,
      ).rejects.toThrow();
    });

    it('saves a company once, with its people, their checks, reasons and usage', async () => {
      const scope = worker();
      expect(await scope.enrichment.begin(runId)).toMatchObject({
        state: 'run',
        provider: 'FAKE',
        maxContactsPerCompany: 3,
      });
      const step = await scope.enrichment.nextCompany(runId);
      expect(step).toMatchObject({
        state: 'company',
        index: 0,
        organization: { id: orgs.acme, domain: ACME },
        skip: null,
      });
      await prisma.suppression.create({
        data: {
          tenantId: alpha.tenant,
          normalizedEmail: `alan.turing@${ACME}`,
          reason: 'OPT_OUT',
          source: 'MANUAL',
        },
      });
      const found = accepted({ id: orgs.acme, name: 'Acme', domain: ACME }, [
        {
          id: 'p-ada',
          first: 'Ada',
          last: 'Lovelace',
          title: 'VP Sales',
          email: `ada.lovelace@${ACME}`,
        },
        {
          id: 'p-grace',
          first: 'Grace',
          last: 'Hopper',
          title: 'Head of Revenue',
          email: `grace.hopper@${ACME}`,
        },
        {
          id: 'p-alan',
          first: 'Alan',
          last: 'Turing',
          title: 'VP Sales',
          email: `alan.turing@${ACME}`,
        },
      ]);
      const company: PersonInput[] = [
        person(found.get('p-ada'), checked(`ada.lovelace@${ACME}`, 'verified')),
        person(
          found.get('p-grace'),
          checked(`grace.hopper@${ACME}`, 'invalid'),
        ),
        person(found.get('p-alan'), { kind: 'none' }),
        {
          kind: 'rejected',
          externalId: 'p-partial',
          name: 'Linus',
          title: 'VP Sales',
          retrievedAt: clock,
          issues: [{ path: 'contacts.3.lastName', message: 'Required' }],
          received: {
            search: { synthetic: true },
            enrichment: null,
            providerClaim: null,
            emailDropped: null,
          },
        },
      ];
      const hold = await scope.usage.reserve({
        metric: 'LEAD_ENRICHMENTS',
        quantity: 3,
        idempotencyKey: `contact_enrichment:${runId}:${orgs.acme}:1`,
        purpose: 'contact_enrichment.company',
      });
      const before = await ledger();
      expect(
        await scope.enrichment.saveCompany(runId, 0, {
          kind: 'enriched',
          people: company,
          holds: [{ reservationId: hold.id, used: 2 }],
        }),
      ).toEqual({ state: 'continue' });

      const contacts = await prisma.contact.findMany({
        where: { tenantId: alpha.tenant, organizationId: orgs.acme },
        orderBy: { firstName: 'asc' },
      });
      expect(contacts.map((c) => c.normalizedEmail)).toEqual([
        `ada.lovelace@${ACME}`,
        `grace.hopper@${ACME}`,
      ]);
      for (const contact of contacts) {
        people[contact.firstName ?? ''] = contact.id;
      }
      const records = await prisma.sourceRecord.findMany({
        where: { tenantId: alpha.tenant, importId: runId },
        orderBy: { importRowNumber: 'asc' },
      });
      expect(
        records.map((r) => [r.outcome, r.externalId, r.contactId !== null]),
      ).toEqual([
        ['CREATED', 'p-ada', true],
        ['CREATED', 'p-grace', true],
        ['EXCLUDED', 'p-alan', false],
        ['FAILED', 'p-partial', false],
      ]);
      // Kept with reasons: the suppressed person isn't saved, the invalid address is noted.
      expect(records[2]?.issues).toEqual([
        {
          field: 'email',
          message: 'This address is on the do-not-contact list.',
        },
      ]);
      expect(JSON.stringify(records[1]?.issues)).toContain(
        "doesn't accept email",
      );
      expect(records[0]?.confidence).toBeGreaterThan(0);
      const checks = await prisma.verification.findMany({
        where: {
          tenantId: alpha.tenant,
          contactId: { in: contacts.map((c) => c.id) },
        },
        orderBy: { normalizedEmail: 'asc' },
      });
      expect(
        checks.map((c) => [c.normalizedEmail, c.status, c.provider]),
      ).toEqual([
        [`ada.lovelace@${ACME}`, 'VALID', 'fake'],
        [`grace.hopper@${ACME}`, 'INVALID', 'fake'],
      ]);
      // Only people who may be emailed one day join the campaign's lead list.
      const listed = await prisma.leadListMember.findMany({
        where: {
          tenantId: alpha.tenant,
          leadListId: alpha.leadList,
          contactId: { in: contacts.map((c) => c.id) },
        },
      });
      expect(listed.map((m) => m.contactId)).toEqual([people['Ada']]);
      // The usage is counted with the company: once.
      expect(await ledger()).toBe(before + 2n);
      expect(
        await prisma.usageReservation.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: alpha.tenant, id: hold.id } },
        }),
      ).toMatchObject({ status: 'COMMITTED', committedQuantity: 2n });

      // A repeated save (a retry after a lost answer) saves and charges nothing again.
      const again = await scope.usage.reserve({
        metric: 'LEAD_ENRICHMENTS',
        quantity: 3,
        idempotencyKey: `contact_enrichment:${runId}:${orgs.acme}:2`,
        purpose: 'contact_enrichment.company',
      });
      expect(
        await scope.enrichment.saveCompany(runId, 0, {
          kind: 'enriched',
          people: company,
          holds: [{ reservationId: again.id, used: 2 }],
        }),
      ).toEqual({ state: 'continue' });
      expect(
        await prisma.contact.count({
          where: { tenantId: alpha.tenant, organizationId: orgs.acme },
        }),
      ).toBe(2);
      expect(
        await prisma.sourceRecord.count({
          where: { tenantId: alpha.tenant, importId: runId },
        }),
      ).toBe(4);
      expect(await ledger()).toBe(before + 2n);
      expect(
        (
          await prisma.usageReservation.findUniqueOrThrow({
            where: { tenantId_id: { tenantId: alpha.tenant, id: again.id } },
          })
        ).status,
      ).toBe('RELEASED');

      // Retained but never sendable: eligibility blocks the invalid address.
      const decision = await (
        await admin()
      ).eligibility.evaluate(alpha.campaign, people['Grace'] ?? '');
      expect(decision.sendPermitted).toBe(false);
      expect(decision.eligibility.status).toBe('blocked');
      expect(JSON.stringify(decision.eligibility.checks)).toContain(
        'email_invalid',
      );
    });

    it('skips companies outside the countries and on the do-not-contact list', async () => {
      const scope = worker();
      const globex = await scope.enrichment.nextCompany(runId);
      expect(globex).toMatchObject({
        state: 'company',
        index: 1,
        skip: {
          outcome: 'EXCLUDED',
          issues: [
            {
              field: 'country',
              message: 'The company is in DE, outside the targeted countries.',
            },
          ],
        },
      });
      if (globex.state !== 'company' || globex.skip === null) {
        throw new Error('expected a skip');
      }
      await scope.enrichment.saveCompany(runId, 1, {
        kind: 'skipped',
        skip: globex.skip,
      });
      await prisma.suppression.create({
        data: {
          tenantId: alpha.tenant,
          normalizedDomain: INITECH,
          reason: 'MANUAL',
          source: 'MANUAL',
        },
      });
      const initech = await scope.enrichment.nextCompany(runId);
      expect(initech).toMatchObject({
        index: 2,
        skip: { outcome: 'EXCLUDED', issues: [{ field: 'company' }] },
      });
      if (initech.state !== 'company' || initech.skip === null) {
        throw new Error('expected a skip');
      }
      expect(
        await scope.enrichment.saveCompany(runId, 2, {
          kind: 'skipped',
          skip: initech.skip,
        }),
      ).toEqual({ state: 'done' });
      expect(await scope.enrichment.nextCompany(runId)).toEqual({
        state: 'done',
      });
      const finished = await scope.enrichment.finish(runId);
      expect(finished).toMatchObject({
        status: 'COMPLETED',
        counts: { found: 4, saved: 2, created: 2, excluded: 1, failed: 1 },
        enrichment: { companies: { total: 3, done: 3, skipped: 2 } },
      });
      const results = await (await admin()).enrichment.results(runId, {});
      expect(results.items.map((r) => [r.kind, r.outcome])).toEqual([
        ['person', 'CREATED'],
        ['person', 'CREATED'],
        ['person', 'EXCLUDED'],
        ['person', 'FAILED'],
        ['company', 'EXCLUDED'],
        ['company', 'EXCLUDED'],
      ]);
      expect(results.items[0]).toMatchObject({
        company: { id: orgs.acme, name: 'Acme', domain: ACME },
        person: {
          name: 'Ada Lovelace',
          contactId: people['Ada'],
          reused: false,
          check: 'verified',
        },
      });
    });

    it('matches people again instead of duplicating them, and reuses recent lookups', async () => {
      const second = await (
        await admin()
      ).enrichment.request(sourceRunId, { campaignId: alpha.campaign }, PEOPLE);
      const scope = worker();
      await scope.enrichment.begin(second.id);
      const known = await scope.enrichment.knownPeople('FAKE', [
        'p-ada',
        'p-grace',
        'p-alan',
        'p-new',
      ]);
      // Saved people are known; the suppressed one was never saved.
      expect(Object.fromEntries(known)).toEqual({
        'p-ada': people['Ada'],
        'p-grace': people['Grace'],
      });
      expect(
        await scope.enrichment.freshChecks([
          `ada.lovelace@${ACME}`,
          `nobody@${ACME}`,
        ]),
      ).toEqual(new Set([`ada.lovelace@${ACME}`]));
      const found = accepted({ id: orgs.acme, name: 'Acme', domain: ACME }, [
        // Another provider id with Grace's address: the same person.
        {
          id: 'p-grace-2',
          first: 'Grace',
          last: 'Hopper',
          title: 'Head of Revenue',
          email: `grace.hopper@${ACME}`,
        },
      ]);
      const before = await ledger();
      const hold = await scope.usage.reserve({
        metric: 'LEAD_ENRICHMENTS',
        quantity: 3,
        idempotencyKey: `contact_enrichment:${second.id}:${orgs.acme}:1`,
        purpose: 'contact_enrichment.company',
      });
      await scope.enrichment.saveCompany(second.id, 0, {
        kind: 'enriched',
        people: [
          {
            kind: 'reused',
            contactId: people['Ada'] ?? '',
            externalId: 'p-ada',
            name: 'Ada Lovelace',
            title: 'VP Sales',
            relevance: {
              score: 100,
              matchedTitle: 'VP Sales',
              seniority: 'vp',
              seniorityMatches: false,
              reasons: [],
            },
            retrievedAt: clock,
            search: { synthetic: true },
          },
          person(found.get('p-grace-2'), { kind: 'fresh' }),
        ],
        // Nobody was looked up: nothing was used.
        holds: [{ reservationId: hold.id, used: 0 }],
      });
      expect(
        await prisma.contact.count({
          where: { tenantId: alpha.tenant, organizationId: orgs.acme },
        }),
      ).toBe(2);
      expect(await ledger()).toBe(before);
      const results = await (await admin()).enrichment.results(second.id, {});
      expect(
        results.items.map((r) => [
          r.outcome,
          r.person?.contactId,
          r.person?.reused,
        ]),
      ).toEqual([
        ['MATCHED', people['Ada'], true],
        ['MATCHED', people['Grace'], false],
      ]);
      // A reused record doesn't make the data fresher.
      expect(
        Object.fromEntries(
          await scope.enrichment.knownPeople('FAKE', ['p-ada']),
        ),
      ).toEqual({ 'p-ada': people['Ada'] });
    });

    it('judges contact quality from stored facts, in the lead view too', async () => {
      const qualities = await (
        await admin()
      ).enrichment.quality([
        people['Ada'] ?? '',
        people['Grace'] ?? '',
        alpha.contactNoEmail,
      ]);
      expect(qualities.get(people['Ada'] ?? '')).toMatchObject({
        level: 'good',
        source: { provider: 'FAKE', fresh: true },
        email: {
          state: 'eligible',
          providerClaim: 'provider_verified',
          check: { status: 'verified', provider: 'FAKE' },
        },
      });
      expect(qualities.get(people['Grace'] ?? '')).toMatchObject({
        level: 'unusable',
        email: { state: 'blocked' },
      });
      expect(qualities.get(alpha.contactNoEmail)).toMatchObject({
        level: 'unusable',
        email: null,
      });
      const view = await (
        await admin()
      ).qualification.view(alpha.campaign, people['Ada'] ?? '');
      expect(view.quality.level).toBe('good');
      const list = await (
        await admin()
      ).qualification.list(alpha.campaign, {
        limit: 100,
      });
      expect(
        list.items.find((item) => item.id === people['Ada'])?.quality,
      ).toEqual({ level: 'good', emailState: 'eligible' });
    });

    it('limits rechecks, fails closed without a verifier, and saves the result', async () => {
      const scope = await admin();
      const ada = people['Ada'] ?? '';
      await expect(
        (await member()).enrichment.requestRecheck(ada, {}, true),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        scope.enrichment.requestRecheck(alpha.contactNoEmail, {}, true),
      ).rejects.toBeInstanceOf(NoEmailAddressError);
      await expect(
        scope.enrichment.requestRecheck(ada, {}, false),
      ).rejects.toBeInstanceOf(VerificationUnavailableError);
      await expect(
        scope.enrichment.requestRecheck(beta.contactOwn, {}, true),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      expect(await scope.enrichment.requestRecheck(ada, {}, true)).toEqual({
        contactId: ada,
        status: 'queued',
      });
      expect(await scope.enrichment.requestRecheck(ada, {}, true)).toEqual({
        contactId: ada,
        status: 'already_queued',
      });
      expect(
        (await scope.enrichment.quality([ada])).get(ada)?.recheck.pending,
      ).toBe(true);

      // The worker checks it; the result is a new check of the address.
      const work = worker();
      expect(await work.enrichment.beginRecheck(ada)).toBe(
        `ada.lovelace@${ACME}`,
      );
      clock = new Date(clock.getTime() + 60_000);
      await work.enrichment.saveRecheck(
        ada,
        {
          address: `ada.lovelace@${ACME}`,
          status: 'risky',
          reason: 'catch_all',
          provider: 'FAKE',
          checkedAt: clock.toISOString(),
        },
        null,
      );
      await prisma.jobTask.updateMany({
        where: { tenantId: alpha.tenant, taskType: RECHECK_TASK_TYPE },
        data: { status: 'SUCCEEDED', startedAt: clock, finishedAt: clock },
      });
      const after = (await scope.enrichment.quality([ada])).get(ada);
      expect(after).toMatchObject({
        level: 'review',
        email: {
          state: 'needs_review',
          check: { status: 'risky', reason: 'catch_all' },
        },
        recheck: { pending: false },
      });
      expect(after?.recheck.availableAt).not.toBeNull();

      // Once a contact in 24 hours…
      const limited = await scope.enrichment
        .requestRecheck(ada, {}, true)
        .catch((error: unknown) => error);
      expect(limited).toBeInstanceOf(RecheckLimitError);
      expect((limited as RecheckLimitError).retryAfterSeconds).toBeGreaterThan(
        86_000,
      );
      clock = new Date(clock.getTime() + 25 * 3_600_000);
      expect(
        (await scope.enrichment.requestRecheck(ada, {}, true)).status,
      ).toBe('queued');

      // …and 50 a workspace in 24 hours.
      await prisma.jobTask.createMany({
        data: Array.from({ length: 49 }, () => ({
          tenantId: alpha.tenant,
          taskType: RECHECK_TASK_TYPE,
          idempotencyKey: `contact_recheck:${randomUUID()}:${clock.toISOString()}`,
          payload: {},
          status: 'SUCCEEDED' as const,
          startedAt: clock,
          finishedAt: clock,
          createdAt: clock,
        })),
      });
      const full = await scope.enrichment
        .requestRecheck(people['Grace'] ?? '', {}, true)
        .catch((error: unknown) => error);
      expect(full).toBeInstanceOf(RecheckLimitError);
    });

    it('keeps runs and contacts to their workspace', async () => {
      await expect(
        worker(beta.tenant).enrichment.begin(runId),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      const betaAdmin = await memberScope(
        prisma,
        { tenantId: beta.tenant, userId: FIXTURE_USERS.betaAdmin.id },
        { now },
      );
      await expect(
        betaAdmin.enrichment.results(runId, {}),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      expect(
        (await betaAdmin.enrichment.quality([people['Ada'] ?? ''])).size,
      ).toBe(0);
      expect(
        await worker(beta.tenant).enrichment.knownPeople('FAKE', ['p-ada']),
      ).toEqual(new Map());
    });
  },
);

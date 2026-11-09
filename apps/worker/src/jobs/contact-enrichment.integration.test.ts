import { randomUUID } from 'node:crypto';
import {
  createFixtureFactory,
  createPrismaClient,
  ENRICHMENT_TASK_TYPE,
  memberScope,
  RECHECK_TASK_TYPE,
  systemScope,
  type ContactProviderInfo,
  type FixtureFactory,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  FakeContactEnrichmentProvider,
  FakeEmailVerificationProvider,
  FakePeopleSearchProvider,
  fakeStaff,
  type ContactEnrichmentProvider,
  type PeopleSearchProvider,
  type ProviderErrorCode,
} from '@lead-fennec-ai/integrations';
import {
  normalizeCompanyIdentity,
  type EmailVerificationStatus,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runEnrichmentTask } from './contact-enrichment.js';

// The contact enrichment jobs (task 08C, docs/decisions.md D-08C-*) on real PostgreSQL with the
// deterministic fake providers: people found for each company of a finished run and saved once;
// repeated enrichment that neither duplicates contacts nor looks people up (or charges) again;
// a retried run that saves and charges nothing twice; people who can't be emailed kept with the
// reasons and kept off the campaign's lead list; and address rechecks, which fail closed without
// a verifier. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped.
const db = new MigratedSchema('t08cw');
const FAKE_PEOPLE: ContactProviderInfo = {
  source: 'FAKE',
  attribution: 'Synthetic people.',
};
const APOLLO_PEOPLE: ContactProviderInfo = {
  source: 'APOLLO',
  attribution: 'People data from Apollo.io.',
};
const CAPABILITIES = {
  supportedFilters: ['industries'] as const,
  maxPageSize: 25,
  maxResultsPerSearch: 100,
  attribution: 'Synthetic companies.',
};
const TARGETS = {
  industries: ['software'],
  titles: ['VP Sales', 'Head of Revenue', 'Chief Executive Officer'],
  seniorities: ['VP', 'C-level'],
};

describe.runIf(testDatabaseUrl !== undefined)(
  'contact enrichment jobs on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let factory: FixtureFactory;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      factory = createFixtureFactory(prisma);
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    type Workspace = Awaited<ReturnType<FixtureFactory['workspace']>>;
    const adminOf = (ws: Workspace) =>
      memberScope(prisma, { tenantId: ws.tenant.id, userId: ws.admin.id });

    /** A finished search that saved these companies, a campaign with a lead list, and its ICP. */
    async function discovered(ws: Workspace, count = 3) {
      const tag = randomUUID().slice(0, 6);
      const icp = await prisma.icp.create({
        data: {
          tenantId: ws.tenant.id,
          name: `Revenue leaders ${tag}`,
          criteria: TARGETS,
        },
      });
      const run = await (
        await adminOf(ws)
      ).discovery.request(
        { icpId: icp.id, maxResults: 10 },
        { source: 'FAKE', capabilities: CAPABILITIES },
      );
      const discovery = systemScope(prisma, {
        tenantId: ws.tenant.id,
        name: 'lead_discovery',
      }).discovery;
      await discovery.beginSearch(run.id);
      // Fixed domains (each test has its own workspace): the fake staff are the same every run.
      const companies = Array.from({ length: count }, (_, i) => ({
        name: `Company ${String(i + 1)}`,
        domain: `company-${String(i + 1)}.example`,
      }));
      await discovery.saveSearchPage(run.id, {
        organizations: companies.map((c) => ({
          identity: normalizeCompanyIdentity(c),
          websiteUrl: `https://${c.domain}/`,
          industry: 'software',
          employeeCount: 120,
          countryCode: 'US',
          source: {
            provider: 'FAKE' as const,
            externalId: `org-${c.domain}`,
            retrievedAt: new Date(),
          },
          raw: { synthetic: true },
        })),
        rejected: [],
        received: count,
        nextPageToken: null,
      });
      await discovery.finishSearch(run.id);
      const list = await prisma.leadList.create({
        data: { tenantId: ws.tenant.id, name: `Leads ${tag}`, icpId: icp.id },
      });
      const campaign = await prisma.campaign.create({
        data: {
          tenantId: ws.tenant.id,
          name: `Campaign ${tag}`,
          icpId: icp.id,
          leadListId: list.id,
        },
      });
      return { sourceRunId: run.id, companies, campaign, list };
    }

    async function requestRun(
      ws: Workspace,
      sourceRunId: string,
      campaignId: string,
      provider: ContactProviderInfo = FAKE_PEOPLE,
    ) {
      const scope = await adminOf(ws);
      const run = await scope.enrichment.request(
        sourceRunId,
        { campaignId, maxContactsPerCompany: 3 },
        provider,
      );
      const task = await prisma.jobTask.findUniqueOrThrow({
        where: {
          tenantId_taskType_idempotencyKey: {
            tenantId: ws.tenant.id,
            taskType: ENRICHMENT_TASK_TYPE,
            idempotencyKey: `import:${run.id}`,
          },
        },
      });
      return { run, scope, task, message: { v: 1, taskId: task.id } };
    }

    /** Fake providers, optionally presented as a paid provider (APOLLO), which reserves usage. */
    function providers(
      options: {
        readonly paid?: boolean;
        readonly failures?: Readonly<Record<number, ProviderErrorCode>>;
        readonly checks?: Readonly<Record<string, EmailVerificationStatus>>;
      } = {},
    ) {
      const people = new FakePeopleSearchProvider();
      const enrichment = new FakeContactEnrichmentProvider({
        ...(options.failures === undefined
          ? {}
          : { failures: options.failures }),
      });
      const verifier = new FakeEmailVerificationProvider({
        ...(options.checks === undefined ? {} : { overrides: options.checks }),
      });
      const source =
        options.paid === true ? ('APOLLO' as const) : ('FAKE' as const);
      const peopleSearch: PeopleSearchProvider = {
        source,
        attribution: people.attribution,
        maxPageSize: people.maxPageSize,
        searchPeople: (request) => people.searchPeople(request),
      };
      const contactEnrichment: ContactEnrichmentProvider = {
        source,
        attribution: enrichment.attribution,
        maxBatchSize: enrichment.maxBatchSize,
        enrichContacts: (requests) => enrichment.enrichContacts(requests),
      };
      return {
        people,
        enrichment,
        verifier,
        deps: {
          providers: () => ({ peopleSearch, contactEnrichment }),
          verifier: () => verifier,
        },
      };
    }

    const contactsOf = (ws: Workspace) =>
      prisma.contact.count({ where: { tenantId: ws.tenant.id } });
    const enrichmentUsage = async (ws: Workspace) =>
      (
        await prisma.usageLedgerEntry.aggregate({
          where: { tenantId: ws.tenant.id, metric: 'LEAD_ENRICHMENTS' },
          _sum: { quantity: true },
        })
      )._sum.quantity ?? 0n;
    const allResults = async (
      scope: Awaited<ReturnType<typeof adminOf>>,
      runId: string,
    ) => (await scope.enrichment.results(runId, { limit: 100 })).items;

    it('finds people at each company and saves them with their source, checks and quality', async () => {
      const ws = await factory.workspace();
      const { sourceRunId, campaign, list } = await discovered(ws);
      const { run, scope, message } = await requestRun(
        ws,
        sourceRunId,
        campaign.id,
      );
      const fakes = providers();
      expect(await runEnrichmentTask(prisma, message, fakes.deps)).toBe(
        'completed',
      );
      const done = await scope.discovery.get(run.id);
      expect(done).toMatchObject({
        status: 'COMPLETED',
        errorCode: null,
        enrichment: { companies: { total: 3, done: 3, skipped: 0 } },
      });
      expect(done.counts.saved).toBeGreaterThan(0);
      expect(done.counts.saved).toBeLessThanOrEqual(9);
      expect(done.counts.created).toBe(done.counts.saved);
      expect(await contactsOf(ws)).toBe(done.counts.saved);
      // Three searches (one a company), lookups in batches, a check for every address.
      expect(fakes.people.requests).toHaveLength(3);
      expect(fakes.enrichment.requests).toHaveLength(3);
      const results = await allResults(scope, run.id);
      const saved = results.filter((r) => r.outcome === 'CREATED');
      expect(saved).toHaveLength(done.counts.saved);
      for (const result of saved) {
        expect(result.person?.confidence).toBeGreaterThan(0);
        expect(result.person?.contactId).not.toBeNull();
      }
      const withAddress = saved.filter((r) => r.person?.email != null);
      expect(fakes.verifier.checked).toHaveLength(withAddress.length);
      expect(
        await prisma.verification.count({ where: { tenantId: ws.tenant.id } }),
      ).toBe(withAddress.length);
      // People who may one day be emailed are on the campaign's list; the others aren't.
      const listed = new Set(
        (
          await prisma.leadListMember.findMany({
            where: { tenantId: ws.tenant.id, leadListId: list.id },
          })
        ).map((m) => m.contactId),
      );
      for (const result of saved) {
        const blocked =
          result.person?.email == null || result.person.check === 'invalid';
        expect(listed.has(result.person?.contactId ?? ''), result.id).toBe(
          !blocked,
        );
      }
      // Quality in the lead view, decided from the stored facts.
      const first = saved.find((r) => r.person?.check === 'verified');
      if (first?.person?.contactId != null) {
        const view = await scope.qualification.view(
          campaign.id,
          first.person.contactId,
        );
        expect(view.quality).toMatchObject({
          level: 'good',
          source: { provider: 'FAKE', fresh: true },
          email: { state: 'eligible', check: { status: 'verified' } },
        });
      }
    });

    it('repeated enrichment neither duplicates contacts nor looks people up or charges again', async () => {
      const ws = await factory.workspace({
        LEAD_ENRICHMENTS: 100n,
        EMAIL_VERIFICATIONS: 100n,
      });
      const { sourceRunId, campaign } = await discovered(ws);
      const first = await requestRun(
        ws,
        sourceRunId,
        campaign.id,
        APOLLO_PEOPLE,
      );
      const paid = providers({ paid: true });
      expect(await runEnrichmentTask(prisma, first.message, paid.deps)).toBe(
        'completed',
      );
      const contacts = await contactsOf(ws);
      const charged = await enrichmentUsage(ws);
      expect(contacts).toBeGreaterThan(0);
      // One lookup a person, as the provider reports it.
      expect(charged).toBe(BigInt(paid.enrichment.requests.flat().length));
      const lookups = paid.enrichment.requests.length;
      const checks = paid.verifier.checked.length;

      const second = await requestRun(
        ws,
        sourceRunId,
        campaign.id,
        APOLLO_PEOPLE,
      );
      expect(await runEnrichmentTask(prisma, second.message, paid.deps)).toBe(
        'completed',
      );
      expect(await contactsOf(ws)).toBe(contacts);
      expect(await enrichmentUsage(ws)).toBe(charged);
      expect(paid.enrichment.requests).toHaveLength(lookups);
      expect(paid.verifier.checked).toHaveLength(checks);
      const results = await allResults(second.scope, second.run.id);
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.outcome).toBe('MATCHED');
        expect(result.person?.reused).toBe(true);
      }
      // Each hold of the second run was released: nothing was used.
      const holds = await prisma.usageReservation.findMany({
        where: {
          tenantId: ws.tenant.id,
          metric: 'LEAD_ENRICHMENTS',
          idempotencyKey: {
            startsWith: `contact_enrichment:${second.run.id}:`,
          },
        },
      });
      expect(holds.map((h) => h.status)).toEqual([
        'RELEASED',
        'RELEASED',
        'RELEASED',
      ]);
    });

    it('a retried run resumes at the next company and saves and charges nothing twice', async () => {
      const ws = await factory.workspace({ LEAD_ENRICHMENTS: 100n });
      const { sourceRunId, campaign } = await discovered(ws);
      const { run, scope, message } = await requestRun(
        ws,
        sourceRunId,
        campaign.id,
        APOLLO_PEOPLE,
      );
      // The second company's lookup is rate limited: the run waits and tries again.
      const flaky = providers({ paid: true, failures: { 2: 'rate_limited' } });
      expect(await runEnrichmentTask(prisma, message, flaky.deps)).toBe(
        'retrying',
      );
      const waiting = await scope.discovery.get(run.id);
      expect(waiting).toMatchObject({
        status: 'PROCESSING',
        errorCode: 'rate_limited',
      });
      expect(waiting.enrichment?.companies.done).toBeLessThan(3);
      const afterFirst = await contactsOf(ws);
      const chargedFirst = await enrichmentUsage(ws);
      expect(
        await runEnrichmentTask(prisma, message, {
          ...flaky.deps,
          now: () => new Date(Date.now() + 3_600_000),
        }),
      ).toBe('completed');
      const done = await scope.discovery.get(run.id);
      expect(done).toMatchObject({
        status: 'COMPLETED',
        enrichment: { companies: { done: 3 } },
      });
      expect(await contactsOf(ws)).toBe(done.counts.saved);
      expect(done.counts.saved).toBeGreaterThan(afterFirst);
      // The failed attempt's hold was released; each company was counted once.
      const holds = await prisma.usageReservation.findMany({
        where: { tenantId: ws.tenant.id, metric: 'LEAD_ENRICHMENTS' },
        orderBy: { createdAt: 'asc' },
      });
      expect(
        holds.filter((h) => h.status === 'RELEASED').length,
      ).toBeGreaterThanOrEqual(1);
      expect(holds.filter((h) => h.status === 'HELD')).toEqual([]);
      expect(await enrichmentUsage(ws)).toBeGreaterThan(chargedFirst);
      const committed = holds.reduce(
        (sum, h) => sum + (h.committedQuantity ?? 0n),
        0n,
      );
      expect(await enrichmentUsage(ws)).toBe(committed);
    });

    it("keeps people who can't be emailed, with the reasons, and never lets them into sending", async () => {
      const ws = await factory.workspace();
      const { sourceRunId, campaign, list, companies } = await discovered(
        ws,
        2,
      );
      const [invalidCo, suppressedCo] = companies;
      if (invalidCo === undefined || suppressedCo === undefined) {
        throw new Error('companies');
      }
      const addressesOf = (company: { name: string; domain: string }) =>
        fakeStaff(company).map(
          (p) =>
            `${p.firstName.toLowerCase()}.${(p.lastName ?? '').toLowerCase()}@${company.domain}`,
        );
      // Every address at the first company is invalid; the second company's staff are on the
      // do-not-contact list.
      const checks = Object.fromEntries(
        addressesOf(invalidCo).map((a) => [a, 'invalid' as const]),
      );
      await prisma.suppression.createMany({
        data: addressesOf(suppressedCo).map((normalizedEmail) => ({
          tenantId: ws.tenant.id,
          normalizedEmail,
          reason: 'OPT_OUT' as const,
          source: 'MANUAL' as const,
        })),
      });
      const { run, scope, message } = await requestRun(
        ws,
        sourceRunId,
        campaign.id,
      );
      expect(
        await runEnrichmentTask(prisma, message, providers({ checks }).deps),
      ).toBe('completed');
      const results = await allResults(scope, run.id);
      const invalid = results.filter(
        (r) => r.company.domain === invalidCo.domain,
      );
      const suppressed = results.filter(
        (r) => r.company.domain === suppressedCo.domain,
      );
      expect(invalid.length).toBeGreaterThan(0);
      expect(suppressed.length).toBeGreaterThan(0);
      for (const result of invalid) {
        expect(result.outcome).toBe('CREATED');
        expect(result.person?.check).toBe('invalid');
        expect(result.issues.map((i) => i.message).join(' ')).toContain(
          "doesn't accept email",
        );
      }
      for (const result of suppressed) {
        expect(result.outcome).toBe('EXCLUDED');
        expect(result.person?.contactId).toBeNull();
        expect(result.issues).toEqual([
          {
            field: 'email',
            message: 'This address is on the do-not-contact list.',
          },
        ]);
      }
      expect(
        await prisma.leadListMember.count({
          where: { tenantId: ws.tenant.id, leadListId: list.id },
        }),
      ).toBe(0);
      for (const result of invalid) {
        const decision = await scope.eligibility.evaluate(
          campaign.id,
          result.person?.contactId ?? '',
        );
        expect(decision.sendPermitted).toBe(false);
        expect(decision.eligibility.status).toBe('blocked');
      }
    });

    it('rechecks an address, and fails closed without a verifier', async () => {
      const ws = await factory.workspace();
      const { sourceRunId, campaign } = await discovered(ws, 1);
      const { scope, message } = await requestRun(ws, sourceRunId, campaign.id);
      await runEnrichmentTask(prisma, message, providers().deps);
      const contacts = await prisma.contact.findMany({
        where: { tenantId: ws.tenant.id, normalizedEmail: { not: null } },
        orderBy: { id: 'asc' },
        take: 2,
      });
      const [one, two] = contacts;
      if (one === undefined || two === undefined) {
        throw new Error('two contacts with addresses');
      }
      const recheckMessage = async (contactId: string) => {
        await scope.enrichment.requestRecheck(contactId, {}, true);
        const task = await prisma.jobTask.findFirstOrThrow({
          where: {
            tenantId: ws.tenant.id,
            taskType: RECHECK_TASK_TYPE,
            idempotencyKey: { startsWith: `contact_recheck:${contactId}:` },
          },
        });
        return { task, message: { v: 1, taskId: task.id } };
      };
      const before = await prisma.verification.count({
        where: { tenantId: ws.tenant.id, contactId: one.id },
      });
      const checked = await recheckMessage(one.id);
      const fakes = providers({
        checks: { [one.normalizedEmail ?? '']: 'risky' },
      });
      expect(await runEnrichmentTask(prisma, checked.message, fakes.deps)).toBe(
        'completed',
      );
      expect(
        await prisma.verification.count({
          where: { tenantId: ws.tenant.id, contactId: one.id },
        }),
      ).toBe(before + 1);
      expect(
        (await scope.enrichment.quality([one.id])).get(one.id),
      ).toMatchObject({
        level: 'review',
        email: { state: 'needs_review', check: { status: 'risky' } },
        recheck: { pending: false, lastErrorCode: null },
      });

      const closed = await recheckMessage(two.id);
      expect(
        await runEnrichmentTask(prisma, closed.message, {
          ...fakes.deps,
          verifier: () => null,
        }),
      ).toBe('failed');
      expect(
        (
          await prisma.jobTask.findUniqueOrThrow({
            where: {
              tenantId_id: { tenantId: ws.tenant.id, id: closed.task.id },
            },
          })
        ).lastErrorCode,
      ).toBe('verification_unavailable');
      expect(
        (await scope.enrichment.quality([two.id])).get(two.id)?.recheck,
      ).toMatchObject({
        pending: false,
        lastErrorCode: 'verification_unavailable',
      });
    });

    it('never runs a request on another provider, and stops when cancelled', async () => {
      const ws = await factory.workspace();
      const { sourceRunId, campaign } = await discovered(ws, 1);
      const mismatch = await requestRun(ws, sourceRunId, campaign.id);
      const paid = providers({ paid: true });
      expect(await runEnrichmentTask(prisma, mismatch.message, paid.deps)).toBe(
        'failed',
      );
      expect(paid.people.requests).toEqual([]);
      expect(
        (await mismatch.scope.discovery.get(mismatch.run.id)).errorCode,
      ).toBe('provider_mismatch');

      const cancelled = await requestRun(ws, sourceRunId, campaign.id);
      await cancelled.scope.discovery.cancel(cancelled.run.id);
      const fakes = providers();
      expect(
        await runEnrichmentTask(prisma, cancelled.message, fakes.deps),
      ).toBe('cancelled');
      expect(fakes.people.requests).toEqual([]);
    });
  },
);

import {
  CONTACT_IMPORT_TASK_TYPE,
  createPrismaClient,
  DISCOVERY_TASK_TYPE,
  ENRICHMENT_TASK_TYPE,
  FIXTURE_USERS,
  fixtureIds,
  JobRejectedError,
  loadFixtureTenants,
  memberScope,
  QUALIFICATION_TASK_TYPE,
  RecordNotFoundError,
  RESEARCH_TASK_TYPE,
  type ContactProviderInfo,
  type DiscoveryProviderInfo,
  type PrismaClient,
  type TenantScope,
} from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  FAKE_ORGANIZATION_SEARCH_CAPABILITIES,
  FakeContactEnrichmentProvider,
  FakeEmailVerificationProvider,
  FakeModelProvider,
  FakeOrganizationSearchProvider,
  FakePeopleSearchProvider,
  FakeWebsiteFetcher,
} from '@lead-fennec-ai/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runEnrichmentTask } from './contact-enrichment.js';
import { runContactImportTask } from './contact-import.js';
import { purgeExpiredExports } from './export-retention.js';
import { runDiscoveryTask } from './lead-discovery.js';
import { runQualificationTask } from './lead-qualification.js';
import { runResearchTask } from './website-research.js';

// From discovery to qualification and profile review, in both fixture tenants (task 11C,
// docs/decisions.md D-11C-05), with the worker's real jobs and the deterministic fake providers:
// a company search, people at those companies, the company's website research, the lead's
// qualification in a campaign, then the lead's profile (why it exists: its sources; its research,
// checks, score and decision with eligibility), a correction that reopens the decision, a people
// import with a suppressed address, and an export. The fakes find the same synthetic companies
// and people in both tenants, so every step also shows that neither tenant sees the other's
// copy. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped.
const db = new MigratedSchema('t11cp');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const SEARCH: DiscoveryProviderInfo = {
  source: 'FAKE',
  capabilities: FAKE_ORGANIZATION_SEARCH_CAPABILITIES,
};
const PEOPLE: ContactProviderInfo = {
  source: 'FAKE',
  attribution: 'Synthetic people.',
};
const TARGETS = {
  industries: ['software'],
  employees: { min: 10, max: 5000 },
  titles: ['VP Sales', 'Head of Revenue', 'Chief Executive Officer'],
  seniorities: ['VP', 'C-level'],
};
const page = (title: string, body: string) =>
  `<html><head><title>${title}</title></head><body><nav><a href="/careers">Careers</a></nav><main>${body}</main></body></html>`;

interface Lead {
  readonly id: string;
  readonly email: string;
  readonly organizationId: string;
}

interface Pipeline {
  readonly scope: TenantScope;
  readonly searchRunId: string;
  readonly peopleRunId: string;
  readonly campaignId: string;
  readonly lead: Lead;
}

describe.runIf(testDatabaseUrl !== undefined)(
  'discovery to profile review in two tenants on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    const runs = new Map<string, Pipeline>();

    const taskId = async (
      tenantId: string,
      taskType: string,
      idempotencyKey: string,
    ) =>
      (
        await prisma.jobTask.findUniqueOrThrow({
          where: {
            tenantId_taskType_idempotencyKey: {
              tenantId,
              taskType,
              idempotencyKey,
            },
          },
        })
      ).id;

    /** Every step of the pipeline in one tenant, through the jobs the worker runs. */
    async function pipeline(
      key: 'alpha' | 'beta',
      tenantId: string,
      userId: string,
    ): Promise<Pipeline> {
      const scope = await memberScope(prisma, { tenantId, userId });
      const icp = await prisma.icp.create({
        data: {
          tenantId,
          name: `Pipeline ${key}`,
          criteria: TARGETS,
          status: 'ACTIVE',
        },
      });

      // 1. Discovery: companies for the ICP.
      const search = await scope.discovery.request(
        { icpId: icp.id, maxResults: 8 },
        SEARCH,
      );
      expect(
        await runDiscoveryTask(
          prisma,
          {
            v: 1,
            taskId: await taskId(
              tenantId,
              DISCOVERY_TASK_TYPE,
              `import:${search.id}`,
            ),
          },
          { provider: () => new FakeOrganizationSearchProvider() },
        ),
      ).toBe('completed');

      // 2. A campaign for the ICP, with a lead list for the people.
      const list = await prisma.leadList.create({
        data: { tenantId, name: `Pipeline ${key}`, icpId: icp.id },
      });
      const created = await scope.campaigns.create({
        name: `Pipeline ${key}`,
      });
      await scope.campaigns.update(created.id, {
        version: created.version,
        audience: { icpId: icp.id, leadListId: list.id },
      });

      // 3. People at those companies, checked and listed.
      const people = await scope.enrichment.request(
        search.id,
        { campaignId: created.id, maxContactsPerCompany: 2 },
        PEOPLE,
      );
      expect(
        await runEnrichmentTask(
          prisma,
          {
            v: 1,
            taskId: await taskId(
              tenantId,
              ENRICHMENT_TASK_TYPE,
              `import:${people.id}`,
            ),
          },
          {
            providers: () => ({
              peopleSearch: new FakePeopleSearchProvider(),
              contactEnrichment: new FakeContactEnrichmentProvider(),
            }),
            verifier: () => new FakeEmailVerificationProvider(),
          },
        ),
      ).toBe('completed');
      const listed = await prisma.leadListMember.findMany({
        where: { tenantId, leadListId: list.id },
        orderBy: { contactId: 'asc' },
        select: {
          contact: {
            select: {
              id: true,
              normalizedEmail: true,
              organization: { select: { id: true, websiteUrl: true } },
            },
          },
        },
      });
      const pick = listed
        .map((m) => m.contact)
        .find(
          (c) =>
            c.normalizedEmail !== null &&
            c.organization?.websiteUrl != null &&
            new URL(c.organization.websiteUrl).pathname === '/',
        );
      if (pick?.organization == null || pick.normalizedEmail === null) {
        throw new Error('The fake people search listed nobody to follow');
      }
      const website = pick.organization.websiteUrl ?? '';

      // 4. The company's website research (fake pages, fake model).
      const research = await scope.research.request(pick.organization.id, {});
      expect(
        await runResearchTask(
          prisma,
          {
            v: 1,
            taskId: await taskId(
              tenantId,
              RESEARCH_TASK_TYPE,
              `research:${research.researchId}`,
            ),
          },
          {
            fetcher: () =>
              new FakeWebsiteFetcher({
                pages: {
                  [new URL(website).href]: {
                    body: page(
                      'Synthetic software',
                      '<p>We make synthetic sales software for revenue teams.</p>',
                    ),
                  },
                  [new URL('/careers', website).href]: {
                    body: page(
                      'Careers',
                      "<p>We're hiring a synthetic account executive.</p>",
                    ),
                  },
                },
                now: () => new Date(),
              }),
            model: () => new FakeModelProvider(),
          },
        ),
      ).toBe('completed');

      // 5. The lead's qualification in the campaign.
      expect(await scope.qualification.request(created.id, pick.id)).toEqual({
        state: 'queued',
      });
      const qualifying = await prisma.jobTask.findFirstOrThrow({
        where: {
          tenantId,
          taskType: QUALIFICATION_TASK_TYPE,
          status: 'PENDING',
        },
      });
      expect(
        await runQualificationTask(
          prisma,
          { v: 1, taskId: qualifying.id },
          { model: () => new FakeModelProvider() },
        ),
      ).toBe('qualified');
      return {
        scope,
        searchRunId: search.id,
        peopleRunId: people.id,
        campaignId: created.id,
        lead: {
          id: pick.id,
          email: pick.normalizedEmail,
          organizationId: pick.organization.id,
        },
      };
    }

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      runs.set(
        'alpha',
        await pipeline('alpha', alpha.tenant, FIXTURE_USERS.alphaAdmin.id),
      );
      runs.set(
        'beta',
        await pipeline('beta', beta.tenant, FIXTURE_USERS.betaAdmin.id),
      );
    }, 300_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    const get = (key: 'alpha' | 'beta') => {
      const run = runs.get(key);
      if (run === undefined) {
        throw new Error(`No pipeline for ${key}`);
      }
      return run;
    };

    it('shows on the profile why each lead exists, its research, score and eligibility', async () => {
      for (const key of ['alpha', 'beta'] as const) {
        const { scope, lead, peopleRunId, searchRunId, campaignId } = get(key);
        // Found by search, with its sources and decision.
        const found = await scope.leads.search({ q: lead.email });
        expect(found.items.map((item) => item.id)).toEqual([lead.id]);
        expect(found.items[0]).toMatchObject({
          sources: ['FAKE'],
          qualification: { campaignId, eligibilityStatus: 'review' },
        });
        const detail = await scope.leads.detail(lead.id);
        // Source evidence: the people search that found them, with its role match.
        expect(
          detail.sources.find((source) => source.importId === peopleRunId),
        ).toMatchObject({ provider: 'FAKE', outcome: 'CREATED' });
        expect(
          detail.sources.find((source) => source.importId === peopleRunId)
            ?.confidence,
        ).toBeGreaterThan(0);
        // The company came from the search.
        const company = await scope.discovery.results(searchRunId, {
          limit: 100,
        });
        expect(
          company.items.some(
            (item) => item.organizationId === lead.organizationId,
          ),
        ).toBe(true);
        expect(detail.research).toMatchObject({ status: 'COMPLETED' });
        expect(detail.verifications.length).toBeGreaterThan(0);
        expect(detail.scoreHistory[0]).toMatchObject({ campaignId });
        // Eligibility evidence, decided apart from fit: the decision records the lead's own
        // eligibility (no send policy yet, so a person looks)...
        const campaign = detail.campaigns.find((c) => c.id === campaignId);
        expect(campaign).toMatchObject({
          onLeadList: true,
          qualification: { eligibilityStatus: 'review' },
        });
        expect(campaign?.score).not.toBeNull();
        // ...and the full check, decided now, blocks: sending is off, the campaign is a draft and
        // has no mailbox. Nothing can be sent.
        const view = await scope.qualification.view(campaignId, lead.id);
        expect(view.eligibility.status).toBe('blocked');
        const reasons = (scope: 'lead' | 'campaign') =>
          view.eligibility.checks
            .filter((check) => check.scope === scope)
            .flatMap((check) => check.reasons.map((reason) => reason.code));
        expect([...reasons('lead'), ...reasons('campaign')]).toEqual(
          expect.arrayContaining([
            'source_policy_unknown',
            'region_policy_unknown',
            'sending_disabled',
            'campaign_not_active',
            'sender_missing',
          ]),
        );
      }
    });

    it("keeps each tenant's copy of the same synthetic person apart", async () => {
      const a = get('alpha');
      const b = get('beta');
      // The fakes are deterministic: the same person was found in both tenants, twice saved.
      expect(a.lead.email).toBe(b.lead.email);
      expect(a.lead.id).not.toBe(b.lead.id);
      await expect(a.scope.leads.detail(b.lead.id)).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
      await expect(b.scope.leads.detail(a.lead.id)).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
      await expect(
        a.scope.qualification.view(b.campaignId, b.lead.id),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      await expect(
        a.scope.discovery.results(b.peopleRunId, {}),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      const search = await b.scope.leads.search({ q: a.lead.email });
      expect(search.items.map((item) => item.id)).toEqual([b.lead.id]);
    });

    it('corrects, imports and exports end to end', async () => {
      const a = get('alpha');
      const b = get('beta');
      // A correction reopens the decision (task 11B) in alpha only.
      const before = await a.scope.leads.detail(a.lead.id);
      await a.scope.leads.correct(a.lead.id, {
        version: before.version,
        changes: { title: 'Chief Revenue Officer' },
        reason: 'Promoted (synthetic).',
      });
      const after = await a.scope.leads.detail(a.lead.id);
      expect(after.title).toBe('Chief Revenue Officer');
      expect(after.activity[0]).toMatchObject({
        campaignId: a.campaignId,
        state: 'REVIEW',
        origin: 'AUTOMATIC',
      });
      expect((await b.scope.leads.detail(b.lead.id)).title).not.toBe(
        'Chief Revenue Officer',
      );

      // A people file in beta: the known person is matched, the suppressed one excluded.
      const accepted = await b.scope.contactImports.request({
        fileName: 'pipeline.csv',
        content: [
          'First,Last,Email,Company,Domain',
          `Known,Person,${b.lead.email},Known Co,${b.lead.email.split('@')[1] ?? ''}`,
          'Opted,Out,opted.out@shared-prospect.test,Shared Prospect,shared-prospect.test',
          'New,Person,new.person@pipeline.example,Pipeline Co,pipeline.example',
        ].join('\n'),
        mapping: {
          firstName: 'First',
          lastName: 'Last',
          email: 'Email',
          company: 'Company',
          companyDomain: 'Domain',
        },
      });
      const importTask = await taskId(
        beta.tenant,
        CONTACT_IMPORT_TASK_TYPE,
        `import:${accepted.id}`,
      );
      expect(
        await runContactImportTask(prisma, { v: 1, taskId: importTask }),
      ).toBe('completed');
      const imported = await b.scope.discovery.results(accepted.id, {});
      expect(imported.items.map((r) => [r.outcome, r.contactId])).toEqual([
        ['MATCHED', b.lead.id],
        ['EXCLUDED', null],
        ['CREATED', expect.any(String)],
      ]);
      // A repeated message for the finished task is dropped.
      await expect(
        runContactImportTask(prisma, { v: 1, taskId: importTask }),
      ).rejects.toBeInstanceOf(JobRejectedError);
      expect(
        await prisma.contact.count({
          where: {
            tenantId: alpha.tenant,
            normalizedEmail: 'new.person@pipeline.example',
          },
        }),
      ).toBe(0);

      // Exports: each tenant's own leads only; then the retention sweep deletes the files.
      const file = await a.scope.exports.createLeadExport({ filters: {} });
      const content = (await a.scope.exports.download(file.id)).content;
      expect(content).toContain(a.lead.id);
      expect(content).not.toContain(b.lead.id);
      const betaFile = await b.scope.exports.createLeadExport({ filters: {} });
      expect(
        (await b.scope.exports.download(betaFile.id)).content,
      ).not.toContain(a.lead.id);
      const purged = await purgeExpiredExports(
        prisma,
        () => new Date(Date.now() + 25 * 3_600_000),
      );
      expect(purged).toBe(2);
      expect(
        await prisma.export.count({ where: { content: { not: null } } }),
      ).toBe(0);
    });
  },
);

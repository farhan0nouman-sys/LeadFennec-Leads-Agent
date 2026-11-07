import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import {
  memberScope,
  platformAdminScope,
  systemScope,
} from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import { RecordNotFoundError } from './tenancy/authorization.js';
import {
  RESEARCH_TASK_TYPE,
  ResearchCorrectionError,
  ResearchNotPossibleError,
  ResearchVersionConflictError,
  type CompleteRunInput,
  type FetchedPage,
  type RunContext,
} from './tenancy/research.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Website research versions (task 09C, docs/decisions.md D-09C-*) on real PostgreSQL: requests
// queue one run per company or answer with fresh research; the worker stores each page it read
// and each extract as dated evidence; a completed version never changes; reuse, refresh and
// corrections add versions that keep the history; corrections are audited and carried into
// later versions. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped.
const db = new MigratedSchema('t09c');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
let clock = new Date('2026-11-07T09:00:00Z');
const now = () => clock;
const DAY = 24 * 60 * 60 * 1000;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const RUN: RunContext = {
  fields: ['company_summary', 'headquarters', 'hiring'],
  context: {
    campaignId: null,
    campaign: { businessProfile: null, offer: null, icp: null },
  },
};

const TEXT =
  'Acme Widgets makes synthetic widgets. We are headquartered in Lyon.';

function page(url: string, text = TEXT, at = clock): FetchedPage {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    contentType: 'text/html',
    retrievedAt: at,
    contentSha256: sha(`body:${text}`),
    textSha256: sha(text),
    title: 'Acme Widgets',
    text,
    textTruncated: false,
    links: [{ url: `${url}about`, text: 'About', sameSite: true }],
  };
}

function modelRun(
  sourceRecordId: string,
  url: string,
  inputSha256: string,
  retrievedAt = clock,
): CompleteRunInput {
  return {
    run: RUN,
    kind: 'model',
    resultStatus: 'COMPLETED',
    inputSha256,
    pages: [
      {
        url,
        outcome: 'fetched',
        errorCode: null,
        sourceRecordId,
        retrievedAt: retrievedAt.toISOString(),
        contentSha256: sha(`body:${TEXT}`),
      },
    ],
    extracts: [
      {
        label: 'E1',
        sourceRecordId,
        url,
        retrievedAt,
        contentSha256: sha(`body:${TEXT}`),
        text: TEXT,
      },
    ],
    findings: {
      facts: [
        {
          field: 'headquarters',
          value: 'Lyon',
          confidence: 'high',
          evidence: [{ label: 'E1', quote: 'We are headquartered in Lyon.' }],
        },
      ],
      hypotheses: [],
      unknownFields: ['company_summary', 'hiring'],
      reviewItems: [],
      warnings: [],
      ignoredInstructions: [],
      confidence: 'medium',
      usage: {
        inputTokens: 900,
        outputTokens: 120,
        costMicroUsd: 150,
        modelCalls: 1,
      },
      model: {
        prompt: 'website-research/1',
        promptSha256: 'c'.repeat(64),
        schema: 'website-research-output/1',
        provider: 'FAKE',
        model: 'fake-model-1',
      },
    },
  };
}

describe.runIf(testDatabaseUrl !== undefined)(
  'website research versions on PostgreSQL',
  () => {
    let prisma: PrismaClient;

    const admin = (tenant: 'alpha' | 'beta' = 'alpha') =>
      memberScope(
        prisma,
        tenant === 'alpha'
          ? { tenantId: alpha.tenant, userId: FIXTURE_USERS.alphaAdmin.id }
          : { tenantId: beta.tenant, userId: FIXTURE_USERS.betaAdmin.id },
        { now },
      );
    const worker = () =>
      systemScope(
        prisma,
        { tenantId: alpha.tenant, name: 'website_research' },
        { now },
      );
    const company = async (
      website: string | null = 'https://acme-widgets.example/',
    ) =>
      prisma.organization.create({
        data: {
          tenantId: alpha.tenant,
          name: `Acme ${randomUUID().slice(0, 8)}`,
          websiteUrl: website,
        },
      });

    /** Requests, begins and completes a model run; returns the research id. */
    async function completedModelRun(orgId: string, refresh = false) {
      const accepted = await (
        await admin()
      ).research.request(orgId, { refresh });
      expect(accepted.state).toBe('queued');
      const begun = await worker().research.beginRun(accepted.researchId, null);
      expect(begun.state).toBe('run');
      const stored = await worker().research.savePage(
        orgId,
        page('https://acme-widgets.example/'),
      );
      await worker().research.completeRun(
        accepted.researchId,
        modelRun(stored.sourceRecordId, stored.finalUrl, 'd'.repeat(64)),
      );
      return accepted.researchId;
    }

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('queues one run per company, audited, and refuses what it can not research', async () => {
      const org = await company();
      const scope = await admin();
      const first = await scope.research.request(org.id, {});
      expect(first.state).toBe('queued');
      // A second request while it is queued answers with the same run.
      expect(await scope.research.request(org.id, { refresh: true })).toEqual({
        researchId: first.researchId,
        state: 'running',
      });
      const row = await prisma.research.findUniqueOrThrow({
        where: {
          tenantId_id: { tenantId: alpha.tenant, id: first.researchId },
        },
      });
      expect(row).toMatchObject({
        status: 'PENDING',
        organizationId: org.id,
        contactId: null,
      });
      expect(row.contextSha256).toMatch(/^[0-9a-f]{64}$/);
      const task = await prisma.jobTask.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          taskType: RESEARCH_TASK_TYPE,
          idempotencyKey: `research:${first.researchId}`,
        },
      });
      expect(task.payload).toEqual({
        researchId: first.researchId,
        campaignId: null,
      });
      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          action: 'research.requested',
          targetId: first.researchId,
        },
      });
      expect(audit.metadata).toEqual({
        organizationId: org.id,
        refresh: false,
        campaignId: null,
      });

      const bare = await company(null);
      await expect(scope.research.request(bare.id, {})).rejects.toBeInstanceOf(
        ResearchNotPossibleError,
      );
      // Another workspace's company reads like a missing one.
      await expect(
        (await admin('beta')).research.request(org.id, {}),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      await expect(
        scope.research.request(org.id, { campaignId: beta.campaign }),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      const support = await platformAdminScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.platformAdmin.id,
        reason: 'Support request FIX-0901: research check',
      });
      await expect(support.research.request(org.id, {})).rejects.toBeInstanceOf(
        ActorNotAllowedError,
      );
      expect(
        (await support.research.organizationResearch(org.id)).active?.id,
      ).toBe(first.researchId);
      // Worker operations are for the worker only.
      await expect(
        scope.research.beginRun(first.researchId, null),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
    });

    it('stores pages and extracts as dated evidence, and answers fresh research without a new run', async () => {
      const org = await company();
      const id = await completedModelRun(org.id);
      const research = await (
        await admin()
      ).research.organizationResearch(org.id);
      expect(research.active).toBeNull();
      expect(research.fresh).toBe(true);
      expect(research.current).toMatchObject({
        id,
        origin: 'MODEL',
        status: 'COMPLETED',
        resultStatus: 'COMPLETED',
        confidence: 'medium',
        unknownFields: ['company_summary', 'hiring'],
        model: { provider: 'FAKE', model: 'fake-model-1' },
      });
      const evidence = research.current?.evidence ?? [];
      expect(evidence).toEqual([
        expect.objectContaining({
          kind: 'WEBSITE_EXCERPT',
          label: 'E1',
          url: 'https://acme-widgets.example/',
          capturedAt: clock.toISOString(),
          contentSha256: sha(`body:${TEXT}`),
          excerpt: TEXT,
        }),
      ]);
      expect(research.current?.facts).toEqual([
        {
          field: 'headquarters',
          value: 'Lyon',
          source: 'page',
          confidence: 'high',
          evidence: [
            {
              evidenceId: evidence[0]?.id,
              label: 'E1',
              quote: 'We are headquartered in Lyon.',
            },
          ],
          note: null,
        },
      ]);
      const source = await prisma.sourceRecord.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          organizationId: org.id,
          provider: 'WEBSITE',
        },
      });
      expect(source).toMatchObject({
        externalId: 'https://acme-widgets.example/',
        fetchedAt: clock,
      });
      expect(
        await prisma.auditRecord.count({
          where: { action: 'research.completed', targetId: id },
        }),
      ).toBe(1);

      // Fresh for 30 days: no new run without refresh; a refresh queues one.
      clock = new Date(clock.getTime() + 29 * DAY);
      expect(await (await admin()).research.request(org.id, {})).toEqual({
        researchId: id,
        state: 'fresh',
      });
      const refreshed = await (
        await admin()
      ).research.request(org.id, { refresh: true });
      expect(refreshed.state).toBe('queued');
      clock = new Date(clock.getTime() + 2 * DAY);
      expect(
        (await (await admin()).research.organizationResearch(org.id)).fresh,
      ).toBe(false);
    });

    it('reuses a stored page for 7 days only', async () => {
      const org = await company();
      const read = clock;
      await worker().research.savePage(
        org.id,
        page('https://acme-widgets.example/', TEXT, read),
      );
      const fresh = await worker().research.freshPage(
        org.id,
        'https://acme-widgets.example/',
        7 * DAY,
      );
      expect(fresh).toMatchObject({
        retrievedAt: read,
        text: TEXT,
        finalUrl: 'https://acme-widgets.example/',
      });
      clock = new Date(clock.getTime() + 8 * DAY);
      expect(
        await worker().research.freshPage(
          org.id,
          'https://acme-widgets.example/',
          7 * DAY,
        ),
      ).toBeNull();
      expect(
        await worker().research.freshPage(
          org.id,
          'https://other.example/',
          7 * DAY,
        ),
      ).toBeNull();
    });

    it('keeps completed versions immutable, and reuses unchanged inputs as a new version', async () => {
      const org = await company();
      const first = await completedModelRun(org.id);
      await expect(
        prisma.research.update({
          where: { tenantId_id: { tenantId: alpha.tenant, id: first } },
          data: { summary: 'rewritten' },
        }),
      ).rejects.toThrow(/finished and can't change/);
      const firstEvidence = await prisma.evidence.findFirstOrThrow({
        where: { researchId: first },
      });
      await expect(
        prisma.evidence.update({
          where: {
            tenantId_id: { tenantId: alpha.tenant, id: firstEvidence.id },
          },
          data: { excerpt: 'rewritten' },
        }),
      ).rejects.toThrow();

      // A refresh whose extracts are unchanged: same inputs, so no model call, a new version.
      clock = new Date(clock.getTime() + DAY);
      const again = await (
        await admin()
      ).research.request(org.id, { refresh: true });
      await worker().research.beginRun(again.researchId, null);
      const reread = await worker().research.savePage(
        org.id,
        page('https://acme-widgets.example/'),
      );
      expect(await worker().research.reusable(org.id, 'd'.repeat(64))).toEqual({
        id: first,
      });
      const base = modelRun(
        reread.sourceRecordId,
        reread.finalUrl,
        'd'.repeat(64),
      );
      if (base.kind !== 'model') {
        throw new Error('model run expected');
      }
      await worker().research.completeRun(again.researchId, {
        run: RUN,
        kind: 'reuse',
        reuseOf: first,
        inputSha256: 'd'.repeat(64),
        pages: base.pages,
        extracts: base.extracts,
      });
      const research = await (
        await admin()
      ).research.organizationResearch(org.id);
      expect(research.current).toMatchObject({
        id: again.researchId,
        origin: 'REUSED',
        basedOnId: first,
        refresh: true,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costMicroUsd: 0,
          modelCalls: 0,
        },
      });
      // The reused facts point to this version's own evidence, dated by this read.
      const evidenceId = research.current?.facts[0]?.evidence[0]?.evidenceId;
      expect(evidenceId).not.toBe(firstEvidence.id);
      expect(research.current?.evidence[0]).toMatchObject({
        id: evidenceId,
        capturedAt: clock.toISOString(),
      });
      expect(research.history.map((item) => [item.id, item.origin])).toEqual([
        [again.researchId, 'REUSED'],
        [first, 'MODEL'],
      ]);
      // The earlier version is still readable, unchanged.
      expect(
        (await (await admin()).research.version(org.id, first)).evidence[0]?.id,
      ).toBe(firstEvidence.id);
    });

    it('records corrections as audited versions and carries them into later runs', async () => {
      const org = await company();
      const first = await completedModelRun(org.id);
      const scope = await admin();
      const corrected = await scope.research.correct(org.id, {
        baseResearchId: first,
        field: 'headquarters',
        action: 'set',
        value: 'Lyon, France',
        note: 'Confirmed on a call with the company (synthetic note).',
      });
      expect(corrected).toMatchObject({
        origin: 'CORRECTION',
        basedOnId: first,
        status: 'COMPLETED',
      });
      expect(corrected.facts).toEqual([
        expect.objectContaining({
          field: 'headquarters',
          value: 'Lyon, France',
          source: 'person',
          note: 'Confirmed on a call with the company (synthetic note).',
        }),
      ]);
      expect(
        corrected.evidence.find((item) => item.kind === 'MANUAL_NOTE'),
      ).toMatchObject({
        excerpt: 'Confirmed on a call with the company (synthetic note).',
        label: null,
      });
      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          action: 'research.corrected',
          targetId: corrected.id,
        },
      });
      expect(audit.metadata).toEqual({
        organizationId: org.id,
        basedOnId: first,
        field: 'headquarters',
        correction: 'set',
      });
      expect(audit.actorMembershipId).not.toBeNull();

      // Only the current version can be corrected.
      await expect(
        scope.research.correct(org.id, {
          baseResearchId: first,
          field: 'hiring',
          action: 'reject',
          note: 'stale',
        }),
      ).rejects.toBeInstanceOf(ResearchVersionConflictError);
      await expect(
        scope.research.correct(org.id, {
          baseResearchId: corrected.id,
          field: 'hiring',
          action: 'restore',
          note: 'nothing',
        }),
      ).rejects.toBeInstanceOf(ResearchCorrectionError);
      const rejected = await scope.research.correct(org.id, {
        baseResearchId: corrected.id,
        field: 'company_summary',
        action: 'reject',
        note: 'The summary is about another company (synthetic).',
      });
      expect(rejected.rejectedFields).toEqual(['company_summary']);

      // A later model run keeps both corrections.
      clock = new Date(clock.getTime() + DAY);
      const next = await scope.research.request(org.id, { refresh: true });
      await worker().research.beginRun(next.researchId, null);
      const stored = await worker().research.savePage(
        org.id,
        page('https://acme-widgets.example/', TEXT),
      );
      await worker().research.completeRun(
        next.researchId,
        modelRun(stored.sourceRecordId, stored.finalUrl, 'e'.repeat(64)),
      );
      const latest = await scope.research.organizationResearch(org.id);
      expect(latest.current?.id).toBe(next.researchId);
      expect(latest.current?.basedOnId).toBe(rejected.id);
      expect(
        latest.current?.corrections.map((item) => [item.field, item.action]),
      ).toEqual([
        ['headquarters', 'set'],
        ['company_summary', 'reject'],
      ]);
      expect(
        latest.current?.facts.find((fact) => fact.field === 'headquarters'),
      ).toMatchObject({
        value: 'Lyon, France',
        source: 'person',
      });
      // Restoring removes the correction in a new version; the page's value is back.
      const restored = await scope.research.correct(org.id, {
        baseResearchId: next.researchId,
        field: 'headquarters',
        action: 'restore',
        note: 'The page is right after all.',
      });
      expect(
        restored.facts.find((fact) => fact.field === 'headquarters'),
      ).toMatchObject({ value: 'Lyon', source: 'page' });
      expect(restored.corrections.map((item) => item.field)).toEqual([
        'company_summary',
      ]);
      expect(
        (await scope.research.organizationResearch(org.id)).history,
      ).toHaveLength(5);
    });

    it('numbers versions per company, so the current one never depends on a clock', async () => {
      const org = await company();
      const first = await completedModelRun(org.id);
      // A correction made by a process whose clock is behind the worker's.
      const behind = new Date(clock.getTime() - 5 * DAY);
      const skewed = await memberScope(
        prisma,
        { tenantId: alpha.tenant, userId: FIXTURE_USERS.alphaAdmin.id },
        { now: () => behind },
      );
      const corrected = await skewed.research.correct(org.id, {
        baseResearchId: first,
        field: 'hiring',
        action: 'reject',
        note: 'Not hiring (synthetic).',
      });
      const research = await (
        await admin()
      ).research.organizationResearch(org.id);
      expect(research.current).toMatchObject({ id: corrected.id, version: 2 });
      expect(
        (await (await admin()).research.version(org.id, first)).version,
      ).toBe(1);
      // The first version is no longer current, whatever the clocks say.
      await expect(
        skewed.research.correct(org.id, {
          baseResearchId: first,
          field: 'hiring',
          action: 'restore',
          note: 'stale',
        }),
      ).rejects.toBeInstanceOf(ResearchVersionConflictError);
    });

    it('records pages with no text, failures and retries', async () => {
      const org = await company();
      const scope = await admin();
      const empty = await scope.research.request(org.id, {});
      await worker().research.beginRun(empty.researchId, null);
      await worker().research.completeRun(empty.researchId, {
        run: RUN,
        kind: 'no_content',
        pages: [
          {
            url: 'https://acme-widgets.example/',
            outcome: 'failed',
            errorCode: 'robots_disallowed',
            sourceRecordId: null,
            retrievedAt: null,
            contentSha256: null,
          },
        ],
      });
      expect(
        await scope.research.version(org.id, empty.researchId),
      ).toMatchObject({
        resultStatus: 'NO_CONTENT',
        facts: [],
        unknownFields: RUN.fields,
        pages: [
          expect.objectContaining({
            outcome: 'failed',
            errorCode: 'robots_disallowed',
          }),
        ],
      });

      const retried = await scope.research.request(org.id, { refresh: true });
      await worker().research.beginRun(retried.researchId, null);
      await worker().research.retryRun(retried.researchId, 'timeout');
      expect(
        (await scope.research.organizationResearch(org.id)).active,
      ).toMatchObject({
        id: retried.researchId,
        status: 'PENDING',
        errorCode: 'timeout',
      });
      await worker().research.beginRun(retried.researchId, null);
      await worker().research.failRun(retried.researchId, 'quota_exceeded');
      const failed = await scope.research.version(org.id, retried.researchId);
      expect(failed).toMatchObject({
        status: 'FAILED',
        errorCode: 'quota_exceeded',
      });
      // Finished: beginning it again does nothing.
      expect(
        await worker().research.beginRun(retried.researchId, null),
      ).toEqual({ state: 'stopped' });
    });

    it('takes the campaign context as a snapshot of the campaign, its offer and its ICP', async () => {
      const org = await company();
      const scope = await admin();
      const accepted = await scope.research.request(org.id, {
        campaignId: alpha.campaign,
      });
      const begun = await worker().research.beginRun(
        accepted.researchId,
        alpha.campaign,
      );
      if (begun.state !== 'run') {
        throw new Error('expected a run');
      }
      expect(begun.plan.context.campaignId).toBe(alpha.campaign);
      // The fixture campaign has an ICP but no business profile or offer yet.
      expect(begun.plan.context.campaign).toEqual({
        businessProfile: null,
        offer: null,
        icp: {
          industries: ['software'],
          employees: { min: 50, max: 500 },
          titles: ['VP Sales', 'Head of Revenue'],
        },
      });
      expect(begun.plan.startUrl).toBe('https://acme-widgets.example/');
    });

    it('never shows another workspace or another company its versions', async () => {
      const org = await company();
      const id = await completedModelRun(org.id);
      const other = await company();
      await expect(
        (await admin()).research.version(other.id, id),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      await expect(
        (await admin('beta')).research.version(org.id, id),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      await expect(
        (await admin('beta')).research.organizationResearch(org.id),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      await expect(
        (await admin()).research.version(org.id, 'not-a-uuid'),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
    });
  },
);

import { createHash, randomUUID } from 'node:crypto';
import {
  LeadScoreInputError,
  type LeadFactorAssessment,
  type LeadScoreAgentRun,
  type SendPolicy,
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
import {
  QualificationBlockedError,
  QualificationVersionConflictError,
  QUALIFICATION_TASK_TYPE,
} from './tenancy/qualification.js';
import type { CompleteRunInput } from './tenancy/research.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Lead qualification (task 10C, docs/decisions.md D-10C-*) on real PostgreSQL: the agent's
// proposals are checked again and scored by application code; every automatic state is decided
// by rules and explained; a person's decision is versioned, audited and never lifts a block;
// accepted review reasons widen sending only while they are the only ones; and no score change
// ever erases a suppression. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as
// skipped.
const db = new MigratedSchema('t10c');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
let clock = new Date('2026-10-20T09:00:00Z');
const now = () => clock;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const POLICY: SendPolicy = {
  regions: {
    countries: { US: 'ALLOW', GB: 'REVIEW' },
    otherCountries: 'REVIEW',
  },
  sources: { APOLLO: 'ALLOW', CSV_IMPORT: 'ALLOW' },
};

const AGENT: LeadScoreAgentRun = {
  status: 'completed',
  prompt: 'lead-qualification/1',
  promptSha256: 'a'.repeat(64),
  schema: 'lead-qualification-output/1',
  provider: 'FAKE',
  model: 'fake-model-1',
  reviewItems: [],
};

const TEXT = 'Pipeline Tools builds sales software for revenue teams.';
const HIRING = 'We are hiring three account executives this quarter.';

describe.runIf(testDatabaseUrl !== undefined)(
  'lead qualification on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let lead: { orgId: string; contactId: string; address: string };

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
    const worker = () =>
      systemScope(
        prisma,
        { tenantId: alpha.tenant, name: 'lead_qualification' },
        { now },
      );

    /** A US VP Sales at a software company whose research states its product and its hiring. */
    async function researchedLead() {
      const org = await prisma.organization.create({
        data: {
          tenantId: alpha.tenant,
          name: `Pipeline ${randomUUID().slice(0, 8)}`,
          websiteUrl: 'https://pipeline-tools.example/',
          normalizedDomain: 'pipeline-tools.example',
          industry: 'software',
          employeeCount: 120,
          countryCode: 'US',
        },
      });
      const address = `morgan.${randomUUID().slice(0, 8)}@pipeline-tools.example`;
      const contact = await prisma.contact.create({
        data: {
          tenantId: alpha.tenant,
          organizationId: org.id,
          firstName: 'Morgan',
          lastName: 'Lee',
          title: 'VP Sales',
          email: address,
          normalizedEmail: address,
          emailDomain: 'pipeline-tools.example',
          countryCode: 'US',
        },
      });
      await prisma.verification.create({
        data: {
          tenantId: alpha.tenant,
          contactId: contact.id,
          normalizedEmail: address,
          provider: 'fake',
          status: 'VALID',
          checkedAt: new Date(clock.getTime() - 60_000),
        },
      });
      await prisma.sourceRecord.create({
        data: {
          tenantId: alpha.tenant,
          provider: 'APOLLO',
          contactId: contact.id,
          payload: { id: 'synthetic' },
          payloadSha256: sha(contact.id),
        },
      });
      await prisma.leadListMember.create({
        data: {
          tenantId: alpha.tenant,
          leadListId: alpha.leadList,
          contactId: contact.id,
        },
      });
      const accepted = await (await admin()).research.request(org.id, {});
      const research = systemScope(
        prisma,
        { tenantId: alpha.tenant, name: 'website_research' },
        { now },
      ).research;
      await research.beginRun(accepted.researchId, null);
      const page = `${TEXT} ${HIRING}`;
      const stored = await research.savePage(org.id, {
        requestedUrl: 'https://pipeline-tools.example/',
        finalUrl: 'https://pipeline-tools.example/',
        status: 200,
        contentType: 'text/html',
        retrievedAt: clock,
        contentSha256: sha(`body:${page}`),
        textSha256: sha(page),
        title: 'Pipeline Tools',
        text: page,
        textTruncated: false,
        links: [],
      });
      const run: CompleteRunInput = {
        run: {
          fields: ['products_services', 'hiring'],
          context: {
            campaignId: null,
            campaign: { businessProfile: null, offer: null, icp: null },
          },
        },
        kind: 'model',
        resultStatus: 'COMPLETED',
        inputSha256: sha(`input:${org.id}`),
        pages: [
          {
            url: stored.finalUrl,
            outcome: 'fetched',
            errorCode: null,
            sourceRecordId: stored.sourceRecordId,
            retrievedAt: clock.toISOString(),
            contentSha256: sha(`body:${page}`),
          },
        ],
        extracts: [
          {
            label: 'E1',
            sourceRecordId: stored.sourceRecordId,
            url: stored.finalUrl,
            retrievedAt: clock,
            contentSha256: sha(`body:${page}`),
            text: page,
          },
        ],
        findings: {
          facts: [
            {
              field: 'products_services',
              value: 'Sales software for revenue teams',
              confidence: 'high',
              evidence: [{ label: 'E1', quote: TEXT }],
            },
            {
              field: 'hiring',
              value: 'Hiring three account executives',
              confidence: 'high',
              evidence: [{ label: 'E1', quote: HIRING }],
            },
          ],
          hypotheses: [],
          unknownFields: [],
          reviewItems: [],
          warnings: [],
          ignoredInstructions: [],
          confidence: 'high',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            costMicroUsd: 0,
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
      await research.completeRun(accepted.researchId, run);
      return { orgId: org.id, contactId: contact.id, address };
    }

    /** The agent's proposals as the worker builds them from the context's facts. */
    async function proposals(
      contactId: string,
      levels: { need: number; timing: number },
    ): Promise<LeadFactorAssessment[]> {
      const context = await worker().qualification.context(
        alpha.campaign,
        contactId,
      );
      const research = context.research;
      if (research === null) {
        throw new Error('no research');
      }
      const ref = (field: string) => {
        const fact = context.facts.find((item) => item.field === field);
        if (fact === undefined) {
          throw new Error(`no ${field}`);
        }
        return {
          kind: 'research_fact' as const,
          researchId: research.id,
          researchVersion: research.version,
          field: fact.field,
          value: fact.value,
          evidenceIds: [...fact.evidenceIds],
        };
      };
      return [
        {
          factor: 'supportedNeed',
          status: 'assessed',
          level: levels.need,
          assessedBy: 'model',
          evidence: [ref('products_services')],
          explanation: 'They sell to revenue teams, which the offer serves.',
        },
        {
          factor: 'timing',
          status: 'assessed',
          level: levels.timing,
          assessedBy: 'model',
          evidence: [ref('hiring')],
          explanation: 'They are hiring account executives this quarter.',
        },
      ];
    }

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      await prisma.tenantSettings.update({
        where: { tenantId: alpha.tenant },
        data: { outboundSendingEnabled: true },
      });
      await (
        await admin()
      ).eligibility.updatePolicy({ version: 0, policy: POLICY });
      lead = await researchedLead();
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it("gives the agent the current research's facts, with their quotes and dates", async () => {
      const context = await worker().qualification.context(
        alpha.campaign,
        lead.contactId,
      );
      expect(context.company?.domain).toBe('pipeline-tools.example');
      expect(context.person.title).toBe('VP Sales');
      expect(context.facts.map((fact) => [fact.field, fact.quotes])).toEqual([
        ['products_services', [TEXT]],
        ['hiring', [HIRING]],
      ]);
      expect(context.facts[0]?.retrievedAt).toEqual(clock);
      await expect(
        (await admin()).qualification.context(alpha.campaign, lead.contactId),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
    });

    it("checks the agent's proposals again and lets application code score them", async () => {
      const proposed = await proposals(lead.contactId, { need: 3, timing: 3 });
      const score = await worker().scoring.scoreLead(
        alpha.campaign,
        lead.contactId,
        {
          assessments: proposed,
          agent: AGENT,
        },
      );
      // Industry 25, decision-maker 20, size 15, need 15, contact quality 10, timing 7.5.
      expect(score).toMatchObject({
        value: 92,
        band: 'HIGH_PRIORITY',
        method: 'AI',
      });
      expect(score.inputs.agent).toEqual(AGENT);
      expect(score.evidenceIds.length).toBeGreaterThan(0);
      expect(await worker().scoring.reproduce(score.id)).toMatchObject({
        reproducible: true,
        evidenceMatches: true,
      });

      const before = await prisma.score.count({
        where: { tenantId: alpha.tenant },
      });
      const tampered: LeadFactorAssessment[][] = [
        // A value the research doesn't state.
        proposed.map((item) =>
          item.status === 'assessed' && item.factor === 'supportedNeed'
            ? {
                ...item,
                evidence: item.evidence.map((ref) =>
                  ref.kind === 'research_fact'
                    ? { ...ref, value: 'They urgently need an audit' }
                    : ref,
                ),
              }
            : item,
        ),
        // Evidence rows that aren't the fact's.
        proposed.map((item) =>
          item.status === 'assessed' && item.factor === 'timing'
            ? {
                ...item,
                evidence: item.evidence.map((ref) =>
                  ref.kind === 'research_fact'
                    ? { ...ref, evidenceIds: [alpha.evidence] }
                    : ref,
                ),
              }
            : item,
        ),
        // A factor the rules assess.
        [
          {
            factor: 'industry',
            status: 'assessed',
            level: 4,
            assessedBy: 'model',
            evidence: [{ kind: 'evidence', evidenceId: alpha.evidence }],
            explanation: 'The model says so.',
          },
        ],
      ];
      for (const assessments of tampered) {
        await expect(
          worker().scoring.scoreLead(alpha.campaign, lead.contactId, {
            assessments,
            agent: AGENT,
          }),
        ).rejects.toBeInstanceOf(LeadScoreInputError);
      }
      expect(
        await prisma.score.count({ where: { tenantId: alpha.tenant } }),
      ).toBe(before);
    });

    it('decides each automatic state by rules, with its reasons', async () => {
      const scope = worker();
      const qualified = await scope.qualification.recordAutomatic(
        alpha.campaign,
        lead.contactId,
        { agentStatus: 'completed' },
      );
      expect(qualified).toMatchObject({
        state: 'QUALIFIED',
        origin: 'AUTOMATIC',
        eligibilityStatus: 'eligible',
        reasons: [{ code: 'score_high_priority' }],
      });
      // An answer that didn't check out sends the lead to Review, whatever the score.
      const review = await scope.qualification.recordAutomatic(
        alpha.campaign,
        lead.contactId,
        { agentStatus: 'review_required' },
      );
      expect(review).toMatchObject({
        state: 'REVIEW',
        version: qualified.version + 1,
      });
      expect(review.reasons.map((reason) => reason.code)).toEqual([
        'agent_review',
        'score_high_priority',
      ]);
      // A rules-only score of the fixture person: 70, Review.
      await scope.scoring.scoreLead(alpha.campaign, alpha.contactShared);
      const fixture = await scope.qualification.recordAutomatic(
        alpha.campaign,
        alpha.contactShared,
        { agentStatus: 'unavailable' },
      );
      expect(fixture.state).toBe('REVIEW');
      expect(fixture.reasons.map((reason) => reason.code)).toEqual([
        'agent_unavailable',
        'score_review',
      ]);
      expect(fixture.version).toBe(2);
      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: { tenantId: alpha.tenant, action: 'lead.qualification_decided' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit).toMatchObject({
        actorType: 'SYSTEM',
        targetId: alpha.contactShared,
      });
    });

    it("tracks a person's decision, audited without its note, with a version check", async () => {
      const scope = await admin();
      const current = await scope.qualification.view(
        alpha.campaign,
        lead.contactId,
      );
      const version = current.qualification?.version ?? 0;
      const decided = await scope.qualification.decide(
        alpha.campaign,
        lead.contactId,
        {
          version,
          state: 'REJECTED',
          note: 'Already a customer of ours (synthetic).',
        },
      );
      expect(decided.qualification).toMatchObject({
        version: version + 1,
        state: 'REJECTED',
        origin: 'PERSON',
        note: 'Already a customer of ours (synthetic).',
        decidedBy: FIXTURE_USERS.alphaAdmin.displayName,
        reasons: [{ code: 'person_decision' }],
      });
      expect(decided.history.map((item) => item.version)).toEqual(
        Array.from({ length: version + 1 }, (_, i) => version + 1 - i),
      );
      expect(decided.readyToContact).toBe(false);
      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          action: 'lead.qualification_decided',
          targetId: lead.contactId,
          actorType: 'MEMBER',
        },
      });
      expect(JSON.stringify(audit.metadata)).not.toContain('customer');
      await expect(
        scope.qualification.decide(alpha.campaign, lead.contactId, {
          version,
          state: 'QUALIFIED',
          note: 'Stale.',
        }),
      ).rejects.toBeInstanceOf(QualificationVersionConflictError);
      await expect(
        scope.qualification.decide(alpha.campaign, lead.contactId, {
          version: version + 1,
          state: 'QUALIFIED',
          note: '  ',
        }),
      ).rejects.toThrow(/Say why/);
    });

    it('lets a person accept review reasons only while they are the only ones', async () => {
      const scope = await admin();
      // The person's country needs a person under the policy.
      await prisma.contact.update({
        where: { tenantId_id: { tenantId: alpha.tenant, id: lead.contactId } },
        data: { countryCode: 'GB' },
      });
      const before = await scope.qualification.view(
        alpha.campaign,
        lead.contactId,
      );
      expect(before.eligibility.status).toBe('review');
      expect(before.sendPermitted).toBe(false);
      const version = before.qualification?.version ?? 0;
      // Accepting needs drafts.approve, which a client member doesn't have.
      await expect(
        (await member()).qualification.decide(alpha.campaign, lead.contactId, {
          version,
          state: 'QUALIFIED',
          note: 'UK outreach is cleared (synthetic).',
          acceptReview: true,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      const accepted = await scope.qualification.decide(
        alpha.campaign,
        lead.contactId,
        {
          version,
          state: 'QUALIFIED',
          note: 'UK outreach is cleared (synthetic).',
          acceptReview: true,
        },
      );
      expect(accepted.qualification?.acceptedReviewReasons).toEqual([
        'region_review',
      ]);
      expect(accepted).toMatchObject({
        sendPermitted: true,
        readyToContact: true,
      });
      // A new review reason (an aged email check) needs a person again.
      clock = new Date(clock.getTime() + 31 * 24 * 60 * 60 * 1000);
      const aged = await scope.qualification.view(
        alpha.campaign,
        lead.contactId,
      );
      expect(
        aged.eligibility.checks.flatMap((c) => c.reasons.map((r) => r.code)),
      ).toEqual(['verification_stale', 'region_review']);
      expect(aged).toMatchObject({
        sendPermitted: false,
        readyToContact: false,
      });
      clock = new Date(clock.getTime() - 31 * 24 * 60 * 60 * 1000);
      await prisma.contact.update({
        where: { tenantId_id: { tenantId: alpha.tenant, id: lead.contactId } },
        data: { countryCode: 'US' },
      });
    });

    it('never lets a score change or a person erase a suppression', async () => {
      const scope = await admin();
      await prisma.suppression.create({
        data: {
          tenantId: alpha.tenant,
          normalizedEmail: lead.address,
          reason: 'OPT_OUT',
          source: 'MANUAL',
          note: 'Asked not to be contacted (synthetic).',
        },
      });
      // The score rises: the agent rates both factors full.
      const higher = await worker().scoring.scoreLead(
        alpha.campaign,
        lead.contactId,
        {
          assessments: await proposals(lead.contactId, { need: 4, timing: 4 }),
          agent: AGENT,
        },
      );
      expect(higher).toMatchObject({ value: 100, band: 'HIGH_PRIORITY' });
      // The suppression is still there, and still decides.
      expect(
        await prisma.suppression.count({
          where: { tenantId: alpha.tenant, normalizedEmail: lead.address },
        }),
      ).toBe(1);
      const automatic = await worker().qualification.recordAutomatic(
        alpha.campaign,
        lead.contactId,
        { agentStatus: 'completed' },
      );
      expect(automatic).toMatchObject({
        state: 'REJECTED',
        eligibilityStatus: 'blocked',
        reasons: [
          { code: 'eligibility_blocked', details: ['suppressed_email'] },
        ],
      });
      const view = await scope.qualification.view(
        alpha.campaign,
        lead.contactId,
      );
      expect(view).toMatchObject({
        fit: { value: 100, band: 'HIGH_PRIORITY' },
        eligibility: { status: 'blocked' },
        sendPermitted: false,
        readyToContact: false,
      });
      // Nobody can qualify the person, or accept the block.
      await expect(
        scope.qualification.decide(alpha.campaign, lead.contactId, {
          version: automatic.version,
          state: 'QUALIFIED',
          note: 'They are a great fit (synthetic).',
          acceptReview: true,
        }),
      ).rejects.toBeInstanceOf(QualificationBlockedError);
      const rejected = await scope.qualification.decide(
        alpha.campaign,
        lead.contactId,
        {
          version: automatic.version,
          state: 'REVIEW',
          note: 'Check whether the opt-out was meant for us (synthetic).',
        },
      );
      expect(rejected).toMatchObject({
        sendPermitted: false,
        readyToContact: false,
      });
      // The database refuses a qualified decision for a blocked person, whoever writes it.
      await expect(
        prisma.$executeRaw`INSERT INTO lead_qualifications (tenant_id, id, campaign_id, contact_id, version, state, origin, eligibility_status, reasons)
          VALUES (${alpha.tenant}::uuid, ${randomUUID()}::uuid, ${alpha.campaign}::uuid, ${lead.contactId}::uuid, 999, 'QUALIFIED', 'AUTOMATIC', 'blocked', '[{"code":"score_high_priority","message":"x","details":[]}]'::jsonb)`,
      ).rejects.toThrow(/lead_qualifications_blocked_check/);
    });

    it('shows fit, its evidence and eligibility apart, and runs one qualification at a time', async () => {
      const scope = await admin();
      const view = await scope.qualification.view(
        alpha.campaign,
        lead.contactId,
      );
      const need = view.fit?.factors.find(
        (item) => item.factor === 'supportedNeed',
      );
      expect(need).toMatchObject({
        status: 'assessed',
        assessedBy: 'model',
        level: 4,
        points: 20,
        evidence: [
          {
            kind: 'research_fact',
            label: 'Research version 1: products services',
            excerpt: expect.stringContaining('Pipeline Tools builds') as string,
            url: 'https://pipeline-tools.example/',
          },
        ],
      });
      expect(view.fit?.agent).toMatchObject({
        status: 'completed',
        prompt: 'lead-qualification/1',
      });
      expect(view.eligibility.checks.map((check) => check.key)).toContain(
        'suppression',
      );
      expect(view.pending).toBe(false);
      expect(
        await scope.qualification.request(alpha.campaign, lead.contactId),
      ).toEqual({
        state: 'queued',
      });
      expect(
        await scope.qualification.request(alpha.campaign, lead.contactId),
      ).toEqual({
        state: 'running',
      });
      expect(
        (await scope.qualification.view(alpha.campaign, lead.contactId))
          .pending,
      ).toBe(true);
      const task = await prisma.jobTask.findFirstOrThrow({
        where: { tenantId: alpha.tenant, taskType: QUALIFICATION_TASK_TYPE },
      });
      expect(task.payload).toEqual({
        campaignId: alpha.campaign,
        contactId: lead.contactId,
      });
    });

    it("lists the campaign's lead list with each lead's score and state", async () => {
      const scope = await admin();
      const first = await scope.qualification.list(alpha.campaign, {
        limit: 2,
      });
      expect(first.leadListId).toBe(alpha.leadList);
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const all = [
        ...first.items,
        ...(
          await scope.qualification.list(alpha.campaign, {
            limit: 10,
            cursor: first.nextCursor ?? undefined,
          })
        ).items,
      ];
      expect(all.find((item) => item.id === lead.contactId)).toMatchObject({
        name: 'Morgan Lee',
        score: { value: 100, band: 'HIGH_PRIORITY' },
        state: 'REVIEW',
      });
      expect(all.find((item) => item.id === alpha.contactShared)).toMatchObject(
        {
          score: { value: 70, band: 'REVIEW' },
          state: 'REVIEW',
        },
      );
    });

    it('stays inside the workspace, and decisions never change', async () => {
      const scope = await admin();
      for (const [campaignId, contactId, entity] of [
        [beta.campaign, lead.contactId, 'campaign'],
        [alpha.campaign, beta.contactShared, 'contact'],
        ['not-a-uuid', lead.contactId, 'campaign'],
      ] as const) {
        await expect(
          scope.qualification.view(campaignId, contactId),
        ).rejects.toThrow(new RecordNotFoundError(entity));
        await expect(
          scope.qualification.request(campaignId, contactId),
        ).rejects.toThrow(new RecordNotFoundError(entity));
      }
      await expect(
        scope.qualification.recordAutomatic(alpha.campaign, lead.contactId, {
          agentStatus: null,
        }),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
      await expect(
        prisma.$executeRaw`UPDATE lead_qualifications SET state = 'QUALIFIED' WHERE tenant_id = ${alpha.tenant}::uuid`,
      ).rejects.toThrow(/lead_qualifications\.state is immutable/);
      await expect(
        prisma.$executeRaw`INSERT INTO lead_qualifications (tenant_id, id, campaign_id, contact_id, version, state, origin, eligibility_status, reasons)
          VALUES (${alpha.tenant}::uuid, ${randomUUID()}::uuid, ${alpha.campaign}::uuid, ${lead.contactId}::uuid, 998, 'REVIEW', 'PERSON', 'review', '[{"code":"person_decision","message":"x","details":[]}]'::jsonb)`,
      ).rejects.toThrow(/lead_qualifications_origin_check/);
      await expect(
        prisma.$executeRaw`INSERT INTO lead_qualifications (tenant_id, id, campaign_id, contact_id, version, state, origin, eligibility_status, reasons)
          VALUES (${alpha.tenant}::uuid, ${randomUUID()}::uuid, ${alpha.campaign}::uuid, ${lead.contactId}::uuid, 997, 'REVIEW', 'AUTOMATIC', 'review', '[]'::jsonb)`,
      ).rejects.toThrow(/lead_qualifications_reasons_check/);
    });
  },
);

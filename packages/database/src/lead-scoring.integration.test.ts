import { createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_LEAD_SCORING_CONFIG,
  type LeadScoringConfig,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { payloadSha256 } from './payload-hash.js';
import { memberScope, systemScope } from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import { RecordNotFoundError } from './tenancy/authorization.js';
import type { CompleteRunInput } from './tenancy/research.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Lead scores (task 10A, docs/decisions.md D-10A-*) on real PostgreSQL: the scoring worker
// scores a person for a campaign from what is stored; every input, the campaign version, the
// research version, the email check and the cited evidence rows are kept; a stored score never
// changes and can be recalculated from its inputs, even after the campaign and the data change;
// missing data earns nothing; the campaign's scoring configuration is saved, reset and copied.
// Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped.
const db = new MigratedSchema('t10a');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
let clock = new Date('2026-10-20T09:00:00Z');
const now = () => clock;
const DAY = 24 * 60 * 60 * 1000;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const CUSTOM: LeadScoringConfig = {
  weights: {
    industry: 40,
    decisionMaker: 20,
    sizeLocation: 10,
    supportedNeed: 10,
    contactQuality: 10,
    timing: 10,
  },
  missingData: {
    requiredFactors: ['industry'],
    maxMissingWeight: 20,
    whenInsufficient: 'REVIEW',
  },
};

describe.runIf(testDatabaseUrl !== undefined)(
  'lead scores on PostgreSQL',
  () => {
    let prisma: PrismaClient;

    const admin = () =>
      memberScope(
        prisma,
        { tenantId: alpha.tenant, userId: FIXTURE_USERS.alphaAdmin.id },
        { now },
      );
    const scorer = (tenantId = alpha.tenant) =>
      systemScope(prisma, { tenantId, name: 'lead_scoring' }, { now });

    /** A DRAFT campaign of Alpha targeting the fixture ICP, with `scoring` if given. */
    async function draftCampaign(scoring?: LeadScoringConfig | null) {
      const scope = await admin();
      const created = await scope.campaigns.create({
        name: `Scored ${randomUUID().slice(0, 8)}`,
      });
      return scope.campaigns.update(created.id, {
        version: created.version,
        audience: { icpId: alpha.icp },
        ...(scoring === undefined ? {} : { scoring }),
      });
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

    it('scores a lead from what is stored and keeps every input', async () => {
      const score = await scorer().scoring.scoreLead(
        alpha.campaign,
        alpha.contactShared,
      );
      // Industry, decision-maker, size and a fresh email check: 70. Supported need and timing
      // aren't assessed yet, and the default policy requires supported need: Review.
      expect(score).toMatchObject({
        campaignId: alpha.campaign,
        contactId: alpha.contactShared,
        // The fixtures hold version 1.
        version: 2,
        value: 70,
        band: 'REVIEW',
        method: 'RULES',
        methodVersion: 'lead-score/1',
        campaignVersion: 1,
        researchId: null,
        verificationId: alpha.verification,
        evidenceIds: [],
        scoredAt: clock,
      });
      expect(score.result).toMatchObject({
        missingFactors: ['supportedNeed', 'timing'],
        bandReasons: ['required_factor_missing'],
      });
      expect(score.inputs).toMatchObject({
        method: 'lead-score/1',
        rules: 'lead-score-rules/1',
        configSource: 'default',
        config: DEFAULT_LEAD_SCORING_CONFIG,
        campaign: { id: alpha.campaign, version: 1, icpId: alpha.icp },
        facts: {
          asOf: clock.toISOString(),
          organization: {
            id: alpha.orgShared,
            industry: 'software',
            employeeCount: 120,
          },
          emailCheck: { verificationId: alpha.verification, status: 'VALID' },
        },
      });
      const row = await prisma.score.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: alpha.tenant, id: score.id } },
      });
      expect(row).toMatchObject({
        icpId: alpha.icp,
        organizationId: null,
        inputSha256: payloadSha256(row.inputs),
      });
      expect(row.reason).toBe(
        '70 of 100: Review. Industry 25 of 25; Decision-maker 20 of 20; Size and location 15 of 15; Contact quality 10 of 10. No evidence: Supported need, Timing. A factor that High Priority requires has no evidence.',
      );
      expect(await scorer().scoring.reproduce(score.id)).toMatchObject({
        reproducible: true,
        differences: [],
        hashMatches: true,
        evidenceMatches: true,
      });
    });

    it('recalculates the fixture score, which cites an evidence row a person assessed', async () => {
      const scope = await admin();
      const fixture = await scope.scoring.get(alpha.leadScore);
      expect(fixture).toMatchObject({
        version: 1,
        value: 77,
        band: 'REVIEW',
        evidenceIds: [alpha.evidence],
      });
      expect(await scope.scoring.reproduce(alpha.leadScore)).toMatchObject({
        reproducible: true,
        hashMatches: true,
        evidenceMatches: true,
      });
    });

    it('gives missing data nothing and applies the campaign policy', async () => {
      // No company, no email address, a title that doesn't match.
      const sparse = await scorer().scoring.scoreLead(
        alpha.campaign,
        alpha.contactNoEmail,
      );
      expect(sparse).toMatchObject({
        value: 0,
        band: 'LOW_PRIORITY',
        verificationId: null,
        evidenceIds: [],
      });
      expect(
        sparse.result.factors.map((item) => [
          item.factor,
          item.status,
          item.points,
        ]),
      ).toEqual([
        ['industry', 'missing', 0],
        ['decisionMaker', 'assessed', 0],
        ['sizeLocation', 'missing', 0],
        ['supportedNeed', 'missing', 0],
        ['contactQuality', 'missing', 0],
        ['timing', 'missing', 0],
      ]);
      expect(sparse.result.bandReasons).toEqual([
        'required_factor_missing',
        'insufficient_data',
      ]);
      // A campaign whose policy sends leads with too little data to a person.
      const campaign = await draftCampaign(CUSTOM);
      const reviewed = await scorer().scoring.scoreLead(
        campaign.id,
        alpha.contactNoEmail,
      );
      expect(reviewed).toMatchObject({
        value: 0,
        band: 'REVIEW',
        campaignVersion: campaign.version,
        inputs: { configSource: 'campaign', config: CUSTOM },
      });
    });

    it('cites the research evidence when the company record has no industry', async () => {
      const org = await prisma.organization.create({
        data: {
          tenantId: alpha.tenant,
          name: `Pipeline ${randomUUID().slice(0, 8)}`,
          websiteUrl: 'https://pipeline-tools.example/',
          employeeCount: 80,
        },
      });
      const contact = await prisma.contact.create({
        data: {
          tenantId: alpha.tenant,
          organizationId: org.id,
          firstName: 'Morgan',
          title: 'Head of Revenue',
        },
      });
      const text = 'Pipeline Tools builds software for revenue teams.';
      const accepted = await (await admin()).research.request(org.id, {});
      const worker = systemScope(
        prisma,
        { tenantId: alpha.tenant, name: 'website_research' },
        { now },
      );
      await worker.research.beginRun(accepted.researchId, null);
      const stored = await worker.research.savePage(org.id, {
        requestedUrl: 'https://pipeline-tools.example/',
        finalUrl: 'https://pipeline-tools.example/',
        status: 200,
        contentType: 'text/html',
        retrievedAt: clock,
        contentSha256: sha(`body:${text}`),
        textSha256: sha(text),
        title: 'Pipeline Tools',
        text,
        textTruncated: false,
        links: [],
      });
      const run: CompleteRunInput = {
        run: {
          fields: ['industry'],
          context: {
            campaignId: null,
            campaign: { businessProfile: null, offer: null, icp: null },
          },
        },
        kind: 'model',
        resultStatus: 'COMPLETED',
        inputSha256: 'e'.repeat(64),
        pages: [
          {
            url: stored.finalUrl,
            outcome: 'fetched',
            errorCode: null,
            sourceRecordId: stored.sourceRecordId,
            retrievedAt: clock.toISOString(),
            contentSha256: sha(`body:${text}`),
          },
        ],
        extracts: [
          {
            label: 'E1',
            sourceRecordId: stored.sourceRecordId,
            url: stored.finalUrl,
            retrievedAt: clock,
            contentSha256: sha(`body:${text}`),
            text,
          },
        ],
        findings: {
          facts: [
            {
              field: 'industry',
              value: 'Software',
              confidence: 'high',
              evidence: [
                { label: 'E1', quote: 'builds software for revenue teams' },
              ],
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
      await worker.research.completeRun(accepted.researchId, run);
      const evidence = await prisma.evidence.findMany({
        where: { tenantId: alpha.tenant, researchId: accepted.researchId },
        select: { id: true },
      });
      expect(evidence).toHaveLength(1);
      const evidenceId = evidence[0]?.id ?? '';

      const score = await scorer().scoring.scoreLead(
        alpha.campaign,
        contact.id,
      );
      expect(score).toMatchObject({
        researchId: accepted.researchId,
        evidenceIds: [evidenceId],
        // Industry 25, decision-maker 20, size 15.
        value: 60,
      });
      const industry = score.inputs.assessments.find(
        (item) => item.factor === 'industry',
      );
      expect(industry).toMatchObject({
        status: 'assessed',
        level: 4,
        evidence: [
          {
            kind: 'research_fact',
            researchId: accepted.researchId,
            researchVersion: 1,
            field: 'industry',
            value: 'Software',
            evidenceIds: [evidenceId],
          },
        ],
      });
      expect(
        await prisma.scoreEvidence.findMany({
          where: { tenantId: alpha.tenant, scoreId: score.id },
          select: { evidenceId: true },
        }),
      ).toEqual([{ evidenceId }]);
      expect(await scorer().scoring.reproduce(score.id)).toMatchObject({
        reproducible: true,
        hashMatches: true,
        evidenceMatches: true,
      });
      // Erasing the evidence removes only the citation: the score still names the row, and a
      // recalculation says the evidence is gone.
      await prisma.evidence.delete({
        where: { tenantId_id: { tenantId: alpha.tenant, id: evidenceId } },
      });
      expect(
        await prisma.scoreEvidence.count({
          where: { tenantId: alpha.tenant, scoreId: score.id },
        }),
      ).toBe(0);
      expect(await scorer().scoring.reproduce(score.id)).toMatchObject({
        reproducible: true,
        hashMatches: true,
        evidenceMatches: false,
      });
    });

    it('adds a version for every calculation and never changes a stored one', async () => {
      const first = await scorer().scoring.scoreLead(
        alpha.campaign,
        alpha.contactOwn,
      );
      clock = new Date(clock.getTime() + DAY);
      const second = await scorer().scoring.scoreLead(
        alpha.campaign,
        alpha.contactOwn,
      );
      expect(second.version).toBe(first.version + 1);
      expect(
        (
          await (
            await admin()
          ).scoring.current(alpha.campaign, alpha.contactOwn)
        )?.id,
      ).toBe(second.id);
      await expect(
        prisma.$executeRaw`UPDATE scores SET value = 99, band = 'HIGH_PRIORITY' WHERE tenant_id = ${alpha.tenant}::uuid AND id = ${first.id}::uuid`,
      ).rejects.toThrow(/scores\.value is immutable/);
      await expect(
        prisma.$executeRaw`UPDATE scores SET inputs = '{}'::jsonb WHERE tenant_id = ${alpha.tenant}::uuid AND id = ${first.id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.$executeRaw`UPDATE score_evidence SET created_at = now() WHERE tenant_id = ${alpha.tenant}::uuid`,
      ).rejects.toThrow(/score_evidence\.created_at is immutable/);
      expect(await scorer().scoring.reproduce(first.id)).toMatchObject({
        reproducible: true,
      });
    });

    it('recalculates an old score from its own inputs after the campaign and the data change', async () => {
      const campaign = await draftCampaign(CUSTOM);
      const before = await scorer().scoring.scoreLead(
        campaign.id,
        alpha.contactShared,
      );
      // Industry 40, decision-maker 20, size 10, contact quality 10: 80, but the policy allows
      // 20 missing (supported need and timing weigh 20): High Priority.
      expect(before).toMatchObject({ value: 80, band: 'HIGH_PRIORITY' });

      const scope = await admin();
      await scope.campaigns.update(campaign.id, {
        version: campaign.version,
        scoring: null,
      });
      await prisma.organization.update({
        where: { tenantId_id: { tenantId: alpha.tenant, id: alpha.orgShared } },
        data: { industry: 'retail' },
      });
      try {
        const after = await scorer().scoring.scoreLead(
          campaign.id,
          alpha.contactShared,
        );
        expect(after).toMatchObject({
          version: before.version + 1,
          campaignVersion: campaign.version + 1,
          value: 45,
          band: 'LOW_PRIORITY',
          inputs: { configSource: 'default' },
        });
        // The old score still says what it said, and its inputs still give it.
        const old = await scope.scoring.get(before.id);
        expect(old).toMatchObject({
          value: 80,
          band: 'HIGH_PRIORITY',
          inputs: {
            config: CUSTOM,
            facts: { organization: { industry: 'software' } },
          },
        });
        expect(await scope.scoring.reproduce(before.id)).toMatchObject({
          reproducible: true,
          hashMatches: true,
        });
      } finally {
        await prisma.organization.update({
          where: {
            tenantId_id: { tenantId: alpha.tenant, id: alpha.orgShared },
          },
          data: { industry: 'software' },
        });
      }
    });

    it('detects a stored score that its inputs do not give', async () => {
      const scope = await admin();
      const stored = await scope.scoring.get(alpha.leadScore);
      const row = await prisma.score.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: alpha.tenant, id: alpha.leadScore } },
      });
      const copy = (
        version: number,
        data: Partial<Prisma.ScoreUncheckedCreateInput>,
      ) =>
        prisma.score.create({
          data: {
            tenantId: alpha.tenant,
            icpId: row.icpId,
            campaignId: row.campaignId,
            campaignVersion: row.campaignVersion,
            contactId: row.contactId,
            verificationId: row.verificationId,
            value: row.value,
            band: row.band,
            reason: row.reason,
            method: row.method,
            methodVersion: row.methodVersion,
            inputs: row.inputs ?? Prisma.DbNull,
            inputSha256: row.inputSha256,
            version,
            ...data,
          },
          select: { id: true },
        });
      // A higher value than the inputs give.
      const raised = await copy(90, { value: 85, band: 'HIGH_PRIORITY' });
      expect(await scope.scoring.reproduce(raised.id)).toEqual({
        reproducible: false,
        differences: [
          'The inputs give 77, not the stored 85.',
          'The inputs give Review, not the stored band.',
        ],
        result: expect.objectContaining({ value: 77 }) as unknown,
        hashMatches: true,
        evidenceMatches: false,
      });
      // Inputs edited after the hash was taken: a fact the stored assessment doesn't follow from.
      const edited = structuredClone(stored.inputs);
      if (edited.facts.organization !== null) {
        edited.facts.organization.industry = 'retail';
      }
      const changed = await copy(91, {
        inputs: edited,
      });
      expect(await scope.scoring.reproduce(changed.id)).toMatchObject({
        reproducible: false,
        differences: [
          'The rules assess industry differently from the stored assessment.',
        ],
        hashMatches: false,
      });
    });

    it('refuses values the database rules forbid', async () => {
      const insert = (band: string, value: number, hash: string | null) =>
        prisma.$executeRaw`INSERT INTO scores (tenant_id, id, campaign_id, campaign_version, contact_id, value, reason, method, band, inputs, input_sha256, version)
        VALUES (${alpha.tenant}::uuid, ${randomUUID()}::uuid, ${alpha.campaign}::uuid, 1, ${alpha.contactOwn}::uuid, ${value}, 'x', 'RULES', ${band}::score_band, '{}'::jsonb, ${hash}, 500)`;
      await expect(insert('HIGH_PRIORITY', 79, 'a'.repeat(64))).rejects.toThrow(
        /scores_band_check/,
      );
      await expect(insert('LOW_PRIORITY', 60, 'a'.repeat(64))).rejects.toThrow(
        /scores_band_check/,
      );
      await expect(insert('REVIEW', 70, null)).rejects.toThrow(
        /scores_lead_score_check/,
      );
      await expect(
        prisma.$executeRaw`INSERT INTO scores (tenant_id, id, contact_id, value, reason, method)
        VALUES (${alpha.tenant}::uuid, ${randomUUID()}::uuid, ${alpha.contactOwn}::uuid, 50, 'x', 'MANUAL')`,
      ).rejects.toThrow(/scores_target_check/);
      await expect(
        prisma.$executeRaw`UPDATE campaigns SET scoring = '[]'::jsonb WHERE tenant_id = ${alpha.tenant}::uuid AND id = ${alpha.campaign}::uuid`,
      ).rejects.toThrow(/campaigns_scoring_check/);
    });

    it('stays inside the workspace, and only the worker calculates', async () => {
      const scope = await admin();
      await expect(
        scope.scoring.scoreLead(alpha.campaign, alpha.contactShared),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
      for (const [campaignId, contactId, entity] of [
        [beta.campaign, alpha.contactShared, 'campaign'],
        [alpha.campaign, beta.contactShared, 'contact'],
        ['not-a-uuid', alpha.contactShared, 'campaign'],
      ] as const) {
        await expect(
          scorer().scoring.scoreLead(campaignId, contactId),
        ).rejects.toThrow(new RecordNotFoundError(entity));
      }
      await expect(scope.scoring.get(beta.leadScore)).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
      // A score recorded before task 10A has no inputs: not a lead score.
      await expect(scope.scoring.get(alpha.score)).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
      expect(
        await scope.scoring.current(beta.campaign, beta.contactShared),
      ).toBeNull();
      // Beta's own scorer sees Beta's fixture score.
      expect(
        (
          await scorer(beta.tenant).scoring.current(
            beta.campaign,
            beta.contactShared,
          )
        )?.id,
      ).toBe(beta.leadScore);
    });

    it("saves, resets and copies a campaign's scoring configuration", async () => {
      const scope = await admin();
      const created = await scope.campaigns.create({ name: 'Weights' });
      expect(created.scoring).toEqual({
        custom: false,
        config: DEFAULT_LEAD_SCORING_CONFIG,
      });
      const saved = await scope.campaigns.update(created.id, {
        version: created.version,
        scoring: CUSTOM,
      });
      expect(saved.scoring).toEqual({ custom: true, config: CUSTOM });
      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          targetId: created.id,
          action: 'campaign.updated',
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit.metadata).toMatchObject({ sections: ['scoring'] });
      // Weights that don't add up to 100 are refused before anything is written.
      await expect(
        scope.campaigns.update(created.id, {
          version: saved.version,
          scoring: { ...CUSTOM, weights: { ...CUSTOM.weights, timing: 20 } },
        }),
      ).rejects.toThrow(/add up to 110/);
      const copy = await scope.campaigns.duplicate(created.id, {});
      expect(copy.scoring).toEqual({ custom: true, config: CUSTOM });
      const reset = await scope.campaigns.update(created.id, {
        version: saved.version,
        scoring: null,
      });
      expect(reset.scoring).toEqual({
        custom: false,
        config: DEFAULT_LEAD_SCORING_CONFIG,
      });
    });

    // Last: it erases a fixture person.
    it("erases a person's scores and their citations with the person", async () => {
      const scores = await prisma.score.findMany({
        where: { tenantId: alpha.tenant, contactId: alpha.contactShared },
        select: { id: true },
      });
      // The fixture score cites an evidence row that belongs to the person too.
      expect(scores.map((item) => item.id)).toContain(alpha.leadScore);
      await prisma.contact.delete({
        where: {
          tenantId_id: { tenantId: alpha.tenant, id: alpha.contactShared },
        },
      });
      expect(
        await prisma.score.count({
          where: { tenantId: alpha.tenant, contactId: alpha.contactShared },
        }),
      ).toBe(0);
      expect(
        await prisma.scoreEvidence.count({
          where: {
            tenantId: alpha.tenant,
            scoreId: { in: scores.map((item) => item.id) },
          },
        }),
      ).toBe(0);
      // Beta's same person keeps both of their scores (the ICP score and the lead score).
      expect(
        await prisma.score.count({
          where: { tenantId: beta.tenant, contactId: beta.contactShared },
        }),
      ).toBe(2);
    });
  },
);

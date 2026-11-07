import { randomUUID } from 'node:crypto';
import {
  assessLeadFactors,
  calculateLeadScore,
  DEFAULT_LEAD_SCORING_CONFIG,
  describeLeadScore,
  LEAD_SCORE_METHOD,
  LEAD_SCORE_RULES_VERSION,
  leadScoreInputsSchema,
  scoringTargets,
  type LeadFactorAssessment,
  type LeadSendDecision,
  type SendPolicy,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { payloadSha256 } from './payload-hash.js';
import { memberScope, systemScope } from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
} from './tenancy/authorization.js';
import { SendPolicyVersionConflictError } from './tenancy/send-eligibility.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Send eligibility (task 10B, docs/decisions.md D-10B-*) on real PostgreSQL: whether a campaign
// may email a person is decided from the facts at the moment of asking, apart from their fit. A
// score of 100 is reported next to every refusal and changes none; every change after the lead
// was scored (a suppression, an aged or failed email check, a paused campaign, a disconnected
// mailbox, a new exclusion, a changed or cleared policy) shows at once. The send policy is saved
// with a version check, audited, by settings.manage only. Runs only when TEST_DATABASE_URL is set;
// otherwise it is reported as skipped.
const db = new MigratedSchema('t10b');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
// Within 30 days of the fixture's email check (2026-10-03).
let clock = new Date('2026-10-20T09:00:00Z');
const now = () => clock;
const DAY = 24 * 60 * 60 * 1000;
const ADDRESS = 'alex.rivera@shared-prospect.test';

const POLICY: SendPolicy = {
  regions: {
    countries: { US: 'ALLOW', GB: 'REVIEW' },
    otherCountries: 'REVIEW',
  },
  sources: { APOLLO: 'ALLOW', CSV_IMPORT: 'ALLOW' },
};

const codesOf = (decision: LeadSendDecision) =>
  decision.eligibility.checks.flatMap((check) =>
    check.reasons.map((reason) => reason.code),
  );

describe.runIf(testDatabaseUrl !== undefined)(
  'send eligibility on PostgreSQL',
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
    const member = () =>
      memberScope(
        prisma,
        { tenantId: alpha.tenant, userId: FIXTURE_USERS.sharedMember.id },
        { now },
      );
    const worker = () =>
      systemScope(
        prisma,
        { tenantId: alpha.tenant, name: 'send_eligibility' },
        { now },
      );
    const evaluate = async () =>
      (await admin()).eligibility.evaluate(alpha.campaign, alpha.contactShared);

    async function setPolicy(policy: SendPolicy | null) {
      const scope = await admin();
      const { version } = await scope.eligibility.policy();
      return scope.eligibility.updatePolicy({ version, policy });
    }

    /** The shared person's current fit: a stored lead score of 100 (every factor full). */
    async function storeScoreOf100(version: number) {
      const facts = {
        asOf: clock.toISOString(),
        targets: scoringTargets(null, {
          industries: ['software'],
          employees: { min: 50, max: 500 },
          titles: ['VP Sales', 'Head of Revenue'],
        }),
        contact: {
          id: alpha.contactShared,
          title: 'VP Sales',
          countryCode: 'US',
          hasEmail: true,
        },
        organization: {
          id: alpha.orgShared,
          industry: 'software',
          employeeCount: 120,
          countryCode: 'US',
        },
        research: null,
        emailCheck: null,
      };
      const assessments = assessLeadFactors(facts).map(
        (item): LeadFactorAssessment => ({
          factor: item.factor,
          status: 'assessed',
          level: 4,
          assessedBy: 'person',
          evidence: [{ kind: 'evidence', evidenceId: alpha.evidence }],
          explanation: 'A person rated this factor a full fit (test).',
        }),
      );
      const inputs = leadScoreInputsSchema.parse({
        v: 1,
        method: LEAD_SCORE_METHOD,
        rules: LEAD_SCORE_RULES_VERSION,
        config: DEFAULT_LEAD_SCORING_CONFIG,
        configSource: 'default',
        campaign: { id: alpha.campaign, version: 1, icpId: alpha.icp },
        facts,
        assessments,
      });
      const result = calculateLeadScore(inputs.config, inputs.assessments);
      expect(result).toMatchObject({ value: 100, band: 'HIGH_PRIORITY' });
      return prisma.score.create({
        data: {
          tenantId: alpha.tenant,
          icpId: alpha.icp,
          campaignId: alpha.campaign,
          campaignVersion: 1,
          contactId: alpha.contactShared,
          value: result.value,
          band: result.band,
          reason: describeLeadScore(result),
          method: 'MANUAL',
          methodVersion: LEAD_SCORE_METHOD,
          inputs,
          inputSha256: payloadSha256(inputs),
          version,
          scoredAt: clock,
        },
        select: { id: true },
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
      // The fixture workspace has sending off (the safe default); these tests turn it on.
      await prisma.tenantSettings.update({
        where: { tenantId: alpha.tenant },
        data: { outboundSendingEnabled: true },
      });
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('treats a workspace without a send policy as not allowing anyone', async () => {
      expect(await (await admin()).eligibility.policy()).toEqual({
        version: 0,
        policy: null,
      });
      const decision = await evaluate();
      expect(decision.eligibility.status).toBe('review');
      expect(codesOf(decision)).toEqual([
        'source_policy_unknown',
        'region_policy_unknown',
      ]);
      expect(decision).toMatchObject({
        sendPermitted: false,
        needsPerson: true,
      });
    });

    it('refuses a lead with a score of 100 that is suppressed, invalid, restricted or policy-unknown', async () => {
      await setPolicy(POLICY);
      const score = await storeScoreOf100(50);
      const eligible = await evaluate();
      expect(eligible).toMatchObject({
        sendPermitted: true,
        fit: {
          scoreId: score.id,
          value: 100,
          band: 'HIGH_PRIORITY',
          version: 50,
        },
        eligibility: { status: 'eligible' },
      });

      // Suppressed.
      const suppression = await prisma.suppression.create({
        data: {
          tenantId: alpha.tenant,
          normalizedEmail: ADDRESS,
          reason: 'OPT_OUT',
          source: 'MANUAL',
        },
      });
      const suppressed = await evaluate();
      expect(suppressed).toMatchObject({
        sendPermitted: false,
        fit: { value: 100 },
        eligibility: { status: 'blocked' },
      });
      expect(codesOf(suppressed)).toEqual(['suppressed_email']);
      await prisma.suppression.delete({
        where: { tenantId_id: { tenantId: alpha.tenant, id: suppression.id } },
      });

      // Invalid: a newer check says the address doesn't accept email.
      await prisma.verification.create({
        data: {
          tenantId: alpha.tenant,
          contactId: alpha.contactShared,
          normalizedEmail: ADDRESS,
          provider: 'fake',
          status: 'INVALID',
          checkedAt: new Date(clock.getTime() - 60_000),
        },
      });
      const invalid = await evaluate();
      expect(invalid).toMatchObject({
        sendPermitted: false,
        fit: { value: 100 },
      });
      expect(codesOf(invalid)).toEqual(['email_invalid']);
      await prisma.verification.create({
        data: {
          tenantId: alpha.tenant,
          contactId: alpha.contactShared,
          normalizedEmail: ADDRESS,
          provider: 'fake',
          status: 'VALID',
          checkedAt: new Date(clock.getTime() - 30_000),
        },
      });
      expect((await evaluate()).sendPermitted).toBe(true);

      // Restricted: the person's country is blocked.
      await setPolicy({
        ...POLICY,
        regions: { ...POLICY.regions, countries: { US: 'BLOCK' } },
      });
      const restricted = await evaluate();
      expect(restricted).toMatchObject({
        sendPermitted: false,
        fit: { value: 100 },
      });
      expect(codesOf(restricted)).toEqual(['region_blocked']);
      expect(
        restricted.eligibility.checks.find((c) => c.key === 'region')
          ?.reasons[0],
      ).toMatchObject({
        status: 'blocked',
        overridable: false,
      });

      // Policy unknown: cleared.
      await setPolicy(null);
      const unknown = await evaluate();
      expect(unknown).toMatchObject({
        sendPermitted: false,
        needsPerson: true,
        fit: { value: 100 },
      });
      expect(codesOf(unknown)).toEqual([
        'source_policy_unknown',
        'region_policy_unknown',
      ]);
      await setPolicy(POLICY);
      expect((await evaluate()).sendPermitted).toBe(true);
    });

    it('follows every change after the lead was scored', async () => {
      // Scored by the 10A rules: a new current version (70, Review).
      const scored = await worker().scoring.scoreLead(
        alpha.campaign,
        alpha.contactShared,
      );
      const first = await evaluate();
      expect(first).toMatchObject({
        sendPermitted: true,
        fit: { scoreId: scored.id, value: 70, band: 'REVIEW' },
      });

      const change = async (
        apply: () => Promise<unknown>,
        undo: () => Promise<unknown>,
        codes: string[],
      ) => {
        await apply();
        const after = await evaluate();
        expect(codesOf(after), codes.join()).toEqual(codes);
        expect(after.sendPermitted).toBe(false);
        // The fit doesn't move.
        expect(after.fit).toEqual(first.fit);
        await undo();
        expect((await evaluate()).sendPermitted, codes.join()).toBe(true);
      };

      const campaign = {
        tenantId_id: { tenantId: alpha.tenant, id: alpha.campaign },
      };
      await change(
        () =>
          prisma.campaign.update({
            where: campaign,
            data: { status: 'PAUSED', pausedAt: clock },
          }),
        () =>
          prisma.campaign.update({
            where: campaign,
            data: { status: 'ACTIVE', pausedAt: null },
          }),
        ['campaign_not_active'],
      );
      const mailbox = {
        tenantId_id: { tenantId: alpha.tenant, id: alpha.emailAccount },
      };
      await change(
        () =>
          prisma.emailAccount.update({
            where: mailbox,
            data: { status: 'PAUSED' },
          }),
        () =>
          prisma.emailAccount.update({
            where: mailbox,
            data: { status: 'ACTIVE' },
          }),
        ['sender_not_ready'],
      );
      const settings = { tenantId: alpha.tenant };
      await change(
        () =>
          prisma.tenantSettings.update({
            where: settings,
            data: { outboundSendingEnabled: false },
          }),
        () =>
          prisma.tenantSettings.update({
            where: settings,
            data: { outboundSendingEnabled: true },
          }),
        ['sending_disabled'],
      );
      // The person's company domain goes on the do-not-contact list.
      let domainRow = '';
      await change(
        async () => {
          domainRow = (
            await prisma.suppression.create({
              data: {
                tenantId: alpha.tenant,
                normalizedDomain: 'shared-prospect.test',
                reason: 'MANUAL',
                source: 'MANUAL',
              },
            })
          ).id;
        },
        () =>
          prisma.suppression.delete({
            where: { tenantId_id: { tenantId: alpha.tenant, id: domainRow } },
          }),
        ['suppressed_domain'],
      );
      // The campaign starts leaving out the person's lead list.
      await change(
        () =>
          prisma.campaign.update({
            where: campaign,
            data: {
              exclusions: {
                domains: [],
                emails: [],
                leadListIds: [alpha.leadList],
                skipContactsInOtherCampaigns: true,
              },
            },
          }),
        () =>
          prisma.campaign.update({
            where: campaign,
            data: { exclusions: Prisma.DbNull },
          }),
        ['excluded_lead_list'],
      );
      // The person joins another, running campaign.
      const other = await (
        await admin()
      ).campaigns.create({
        name: `Other ${randomUUID().slice(0, 8)}`,
      });
      const sequence = await prisma.sequence.findFirstOrThrow({
        where: { tenantId: alpha.tenant, campaignId: other.id },
      });
      let enrollment = '';
      await change(
        async () => {
          enrollment = (
            await prisma.campaignLead.create({
              data: {
                tenantId: alpha.tenant,
                campaignId: other.id,
                sequenceId: sequence.id,
                contactId: alpha.contactShared,
                status: 'ACTIVE',
                timezone: 'UTC',
              },
            })
          ).id;
        },
        () =>
          prisma.campaignLead.update({
            where: { tenantId_id: { tenantId: alpha.tenant, id: enrollment } },
            data: { status: 'COMPLETED', completedAt: clock },
          }),
        ['in_other_campaign'],
      );
      // The email check ages: more than 30 days later it needs a person.
      clock = new Date(clock.getTime() + 31 * DAY);
      const aged = await evaluate();
      expect(codesOf(aged)).toEqual(['verification_stale']);
      expect(aged).toMatchObject({ sendPermitted: false, needsPerson: true });
      expect(aged.fit).toEqual(first.fit);
    });

    it('never takes missing data for permission', async () => {
      const scope = await admin();
      // No address, no company, no country, no recorded source.
      const nobody = await scope.eligibility.evaluate(
        alpha.campaign,
        alpha.contactNoEmail,
      );
      expect(nobody.eligibility.status).toBe('blocked');
      expect(codesOf(nobody)).toEqual([
        'no_email',
        'source_unknown',
        'country_unknown',
      ]);
      expect(nobody.fit).toBeNull();
      // An address nobody checked, and no country.
      const unchecked = await scope.eligibility.evaluate(
        alpha.campaign,
        alpha.contactOwn,
      );
      expect(codesOf(unchecked)).toEqual([
        'email_not_verified',
        'country_unknown',
      ]);
    });

    it('saves the policy with a version check, audited, for settings.manage only', async () => {
      const scope = await admin();
      const before = await scope.eligibility.policy();
      const saved = await scope.eligibility.updatePolicy({
        version: before.version,
        policy: { ...POLICY, sources: { ...POLICY.sources, MANUAL: 'REVIEW' } },
      });
      expect(saved.version).toBe(before.version + 1);
      expect(saved.policy?.sources).toEqual({
        APOLLO: 'ALLOW',
        CSV_IMPORT: 'ALLOW',
        MANUAL: 'REVIEW',
      });
      await expect(
        scope.eligibility.updatePolicy({
          version: before.version,
          policy: POLICY,
        }),
      ).rejects.toBeInstanceOf(SendPolicyVersionConflictError);
      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: { tenantId: alpha.tenant, action: 'send_policy.updated' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit.metadata).toEqual({
        version: saved.version,
        configured: true,
        countries: 2,
        sources: ['APOLLO', 'CSV_IMPORT', 'MANUAL'],
      });
      // A policy that would allow unnamed countries is refused before anything is written.
      await expect(
        scope.eligibility.updatePolicy({
          version: saved.version,
          policy: {
            ...POLICY,
            regions: { ...POLICY.regions, otherCountries: 'ALLOW' as 'REVIEW' },
          },
        }),
      ).rejects.toThrow(/Choose REVIEW or BLOCK/);
      await expect(
        (await member()).eligibility.policy(),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        (await member()).eligibility.updatePolicy({
          version: saved.version,
          policy: null,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        worker().eligibility.updatePolicy({
          version: saved.version,
          policy: null,
        }),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
      // A member who may read campaigns and people can see a lead's eligibility.
      expect(
        (
          await (
            await member()
          ).eligibility.evaluate(alpha.campaign, alpha.contactShared)
        ).eligibility.rules,
      ).toBe('send-eligibility/1');
      // Beta's policy is its own.
      expect(await (await admin('beta')).eligibility.policy()).toEqual({
        version: 0,
        policy: null,
      });
    });

    it('treats a stored policy out of shape as no policy', async () => {
      await prisma.$executeRaw`UPDATE tenant_settings SET send_policy = '{"allowEverything": true}'::jsonb WHERE tenant_id = ${alpha.tenant}::uuid`;
      const scope = await admin();
      expect((await scope.eligibility.policy()).policy).toBeNull();
      expect(codesOf(await evaluate())).toContain('region_policy_unknown');
      await expect(
        prisma.$executeRaw`UPDATE tenant_settings SET send_policy = '[]'::jsonb WHERE tenant_id = ${alpha.tenant}::uuid`,
      ).rejects.toThrow(/tenant_settings_send_policy_check/);
      await expect(
        prisma.$executeRaw`UPDATE tenant_settings SET send_policy_version = -1 WHERE tenant_id = ${alpha.tenant}::uuid`,
      ).rejects.toThrow(/tenant_settings_send_policy_version_check/);
    });

    it('stays inside the workspace', async () => {
      const scope = await admin();
      for (const [campaignId, contactId, entity] of [
        [beta.campaign, alpha.contactShared, 'campaign'],
        [alpha.campaign, beta.contactShared, 'contact'],
        ['not-a-uuid', alpha.contactShared, 'campaign'],
        [alpha.campaign, 'not-a-uuid', 'contact'],
      ] as const) {
        await expect(
          scope.eligibility.evaluate(campaignId, contactId),
        ).rejects.toThrow(new RecordNotFoundError(entity));
      }
    });
  },
);

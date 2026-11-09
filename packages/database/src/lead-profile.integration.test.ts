import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import {
  memberScope,
  systemScope,
  type TenantScope,
} from './tenancy/access.js';
import { PermissionDeniedError } from './tenancy/authorization.js';
import {
  AssignmentNotPossibleError,
  EmailTakenError,
  LeadCorrectionError,
  LeadVersionConflictError,
} from './tenancy/lead-changes.js';
import { createLeadSearchRepository } from './tenancy/lead-search.js';
import type { CompleteRunInput } from './tenancy/research.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Lead profile changes (task 11B, docs/decisions.md D-11B-*) on real PostgreSQL: a lead's
// profile shows why it exists; corrections, tags and assignments name the version they started
// from and fail safely when stale; a material correction never keeps a stale approval (the
// draft is invalidated, its scheduled send cancelled, every campaign's decision back to Review
// with eligibility decided again); notes never change; assignments check the campaign's
// workspace, state and lead list and the lead's blocks; a research correction makes its
// company's leads stale. Runs only when TEST_DATABASE_URL is set; otherwise reported as skipped.
const db = new MigratedSchema('t11b');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe.runIf(testDatabaseUrl !== undefined)(
  'lead profile changes on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let ownEmail = '';

    const admin = (): Promise<TenantScope> =>
      memberScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.alphaAdmin.id,
      });
    const versionOf = async (contactId: string) =>
      (
        await prisma.contact.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: alpha.tenant, id: contactId } },
          select: { version: true },
        })
      ).version;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      const own = await prisma.contact.findUniqueOrThrow({
        where: {
          tenantId_id: { tenantId: alpha.tenant, id: alpha.contactOwn },
        },
      });
      ownEmail = own.normalizedEmail ?? '';
      // The own lead's draft is approved and its send scheduled; the rules qualified the lead.
      const approval = await prisma.approval.create({
        data: {
          tenantId: alpha.tenant,
          draftId: alpha.draftOwnV1,
          decision: 'APPROVED',
          decidedByMembershipId: alpha.membershipAdmin,
        },
      });
      await prisma.draft.update({
        where: {
          tenantId_id: { tenantId: alpha.tenant, id: alpha.draftOwnV1 },
        },
        data: { status: 'APPROVED' },
      });
      await prisma.outboundIntent.create({
        data: {
          tenantId: alpha.tenant,
          campaignLeadId: alpha.leadOwn,
          sequenceStepId: alpha.stepIntro,
          draftId: alpha.draftOwnV1,
          approvalId: approval.id,
          approvalDecision: 'APPROVED',
          emailAccountId: alpha.emailAccount,
          recipientEmail: ownEmail,
          status: 'SCHEDULED',
          scheduledAt: new Date('2026-12-01T09:00:00Z'),
          scheduledTimezone: 'UTC',
        },
      });
      await prisma.leadQualification.create({
        data: {
          tenantId: alpha.tenant,
          campaignId: alpha.campaign,
          contactId: alpha.contactOwn,
          version: 1,
          state: 'QUALIFIED',
          origin: 'AUTOMATIC',
          eligibilityStatus: 'eligible',
          reasons: [
            { code: 'score_high_priority', message: 'Synthetic.', details: [] },
          ],
        },
      });
    }, 120_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('shows why a lead exists: sources, research, decisions, notes and tags', async () => {
      const detail = await (await admin()).leads.detail(alpha.contactShared);
      expect(detail).toMatchObject({
        version: 1,
        tags: ['decision maker'],
        notes: [
          expect.objectContaining({
            body: 'Met at the fixture conference (fixture note).',
          }),
        ],
        truncated: { notes: false, scoreHistory: false, activity: false },
      });
      expect(detail.sources.length).toBeGreaterThan(0);
      expect(detail.activity).toEqual([
        expect.objectContaining({
          campaignId: alpha.campaign,
          state: 'REVIEW',
          origin: 'PERSON',
          reasons: ['A person decided: Review.'],
        }),
      ]);
      expect(detail.scoreHistory[0]).toMatchObject({
        campaignId: alpha.campaign,
        version: 1,
      });
      expect(detail.campaigns[0]?.qualification).toMatchObject({ version: 1 });
    });

    it('corrects data with a version check, a reason note and an audit without the values', async () => {
      const scope = await admin();
      const corrected = await scope.leads.correct(alpha.contactOwn, {
        version: 1,
        changes: { title: 'Head of Sales' },
        reason: 'Confirmed on a call (synthetic).',
      });
      expect(corrected).toMatchObject({ version: 2, title: 'Head of Sales' });
      expect(corrected.notes[0]?.body).toBe(
        'Corrected title: Confirmed on a call (synthetic).',
      );
      // A stale version is refused, and changes nothing.
      await expect(
        scope.leads.correct(alpha.contactOwn, {
          version: 1,
          changes: { title: 'CEO' },
          reason: 'stale',
        }),
      ).rejects.toBeInstanceOf(LeadVersionConflictError);
      expect(await versionOf(alpha.contactOwn)).toBe(2);
      // Another lead's address, an address that isn't one, an unidentifiable lead.
      const shared = await prisma.contact.findUniqueOrThrow({
        where: {
          tenantId_id: { tenantId: alpha.tenant, id: alpha.contactShared },
        },
      });
      await expect(
        scope.leads.correct(alpha.contactOwn, {
          version: 2,
          changes: { email: shared.email },
          reason: 'typo',
        }),
      ).rejects.toBeInstanceOf(EmailTakenError);
      await expect(
        scope.leads.correct(alpha.contactOwn, {
          version: 2,
          changes: { email: 'not an address' },
          reason: 'typo',
        }),
      ).rejects.toBeInstanceOf(ZodError);
      const lonely = `lone.${randomUUID().slice(0, 6)}@lone.example`;
      const loner = await prisma.contact.create({
        data: {
          tenantId: alpha.tenant,
          firstName: 'Lone',
          lastName: 'Person',
          email: lonely,
          normalizedEmail: lonely,
          emailDomain: 'lone.example',
        },
      });
      await expect(
        scope.leads.correct(loner.id, {
          version: 1,
          changes: { email: null },
          reason: 'bounced',
        }),
      ).rejects.toBeInstanceOf(LeadCorrectionError);
      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          action: 'lead.corrected',
          targetId: alpha.contactOwn,
        },
      });
      expect(audit.metadata).toMatchObject({
        fields: ['title'],
        version: 2,
        material: true,
      });
      expect(JSON.stringify(audit.metadata)).not.toContain('Head of Sales');
    });

    it('never keeps a stale approval: a material correction invalidates and reopens', async () => {
      const scope = await admin();
      const draftOf = () =>
        prisma.draft.findUniqueOrThrow({
          where: {
            tenantId_id: { tenantId: alpha.tenant, id: alpha.draftOwnV1 },
          },
        });
      // The title correction above already invalidated the approved draft and its send.
      expect((await draftOf()).status).toBe('INVALIDATED');
      const intent = await prisma.outboundIntent.findFirstOrThrow({
        where: { tenantId: alpha.tenant, draftId: alpha.draftOwnV1 },
      });
      expect(intent).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'LEAD_DATA_CHANGED',
      });
      expect(intent.cancelledAt).not.toBeNull();
      // The approval itself stays as it was (append-only), but no longer counts for anything.
      expect(
        await prisma.approval.count({
          where: { tenantId: alpha.tenant, draftId: alpha.draftOwnV1 },
        }),
      ).toBe(1);
      const decisions = await prisma.leadQualification.findMany({
        where: {
          tenantId: alpha.tenant,
          campaignId: alpha.campaign,
          contactId: alpha.contactOwn,
        },
        orderBy: { version: 'asc' },
      });
      expect(decisions.map((d) => [d.version, d.state, d.origin])).toEqual([
        [1, 'QUALIFIED', 'AUTOMATIC'],
        [2, 'REVIEW', 'AUTOMATIC'],
      ]);
      expect(decisions[1]?.reasons).toEqual([
        {
          code: 'lead_data_changed',
          message:
            "The lead's data was corrected after this decision. Decide again.",
          details: [],
        },
      ]);
      // A new address: eligibility is decided again from it (unchecked, so blocked).
      await scope.leads.correct(alpha.contactOwn, {
        version: 2,
        changes: {
          email: `own.${randomUUID().slice(0, 6)}@alpha-only.example`,
        },
        reason: 'New address from the company (synthetic).',
      });
      const latest = await prisma.leadQualification.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          campaignId: alpha.campaign,
          contactId: alpha.contactOwn,
        },
        orderBy: { version: 'desc' },
      });
      expect(latest).toMatchObject({
        version: 3,
        state: 'REVIEW',
        eligibilityStatus: 'blocked',
      });
      const decision = await scope.eligibility.evaluate(
        alpha.campaign,
        alpha.contactOwn,
      );
      expect(decision.sendPermitted).toBe(false);
      expect(JSON.stringify(decision.eligibility.checks)).toContain(
        'email_not_verified',
      );
      // A profile link isn't material: nothing is reopened.
      await scope.leads.correct(alpha.contactOwn, {
        version: 3,
        changes: { linkedinUrl: 'https://www.linkedin.com/in/own-synthetic' },
        reason: 'Found the profile.',
      });
      expect(
        await prisma.leadQualification.count({
          where: {
            tenantId: alpha.tenant,
            campaignId: alpha.campaign,
            contactId: alpha.contactOwn,
          },
        }),
      ).toBe(3);
      expect(await versionOf(alpha.contactOwn)).toBe(4);
    });

    it('sets tags with a version check, normalized and audited', async () => {
      const scope = await admin();
      const version = await versionOf(alpha.contactShared);
      const tagged = await scope.leads.setTags(alpha.contactShared, {
        version,
        tags: [' VIP ', 'decision maker', 'vip'],
      });
      expect(tagged).toMatchObject({
        tags: ['decision maker', 'vip'],
        version: version + 1,
      });
      // The same set changes nothing.
      expect(
        (
          await scope.leads.setTags(alpha.contactShared, {
            version: version + 1,
            tags: ['vip', 'decision maker'],
          })
        ).version,
      ).toBe(version + 1);
      await expect(
        scope.leads.setTags(alpha.contactShared, { version, tags: [] }),
      ).rejects.toBeInstanceOf(LeadVersionConflictError);
      await expect(
        scope.leads.setTags(alpha.contactShared, {
          version: version + 1,
          tags: Array.from({ length: 21 }, (_, i) => `t${String(i)}`),
        }),
      ).rejects.toBeInstanceOf(ZodError);
      await expect(
        scope.leads.setTags(alpha.contactShared, {
          version: version + 1,
          tags: ['<script>'],
        }),
      ).rejects.toBeInstanceOf(ZodError);
    });

    it('adds notes that never change', async () => {
      const scope = await admin();
      const noted = await scope.leads.addNote(alpha.contactShared, {
        body: 'Prefers email over calls (synthetic).',
      });
      const note = noted.notes[0];
      expect(note).toMatchObject({
        body: 'Prefers email over calls (synthetic).',
        author: FIXTURE_USERS.alphaAdmin.displayName,
      });
      await expect(
        prisma.contactNote.update({
          where: {
            tenantId_id: { tenantId: alpha.tenant, id: note?.id ?? '' },
          },
          data: { body: 'rewritten' },
        }),
      ).rejects.toThrow();
      await expect(
        scope.leads.addNote(beta.contactShared, { body: 'x' }),
      ).rejects.toThrow();
    });

    it('assigns only to a usable campaign of this workspace, and never a blocked lead', async () => {
      const scope = await admin();
      const list = await prisma.leadList.create({
        data: {
          tenantId: alpha.tenant,
          name: `Assign ${randomUUID().slice(0, 6)}`,
        },
      });
      const campaign = await prisma.campaign.create({
        data: {
          tenantId: alpha.tenant,
          name: `Assign ${randomUUID().slice(0, 6)}`,
          leadListId: list.id,
        },
      });
      const version = await versionOf(alpha.contactShared);
      const refused = async (input: {
        version: number;
        campaignId: string;
      }) => {
        const error = await scope.leads
          .assign(alpha.contactShared, input)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AssignmentNotPossibleError);
        return (error as AssignmentNotPossibleError).issues.map(
          (i) => i.message,
        );
      };
      expect(await refused({ version, campaignId: beta.campaign })).toEqual([
        'Not found in this workspace.',
      ]);
      const ended = await prisma.campaign.create({
        data: {
          tenantId: alpha.tenant,
          name: `Ended ${randomUUID().slice(0, 6)}`,
          leadListId: list.id,
          status: 'CANCELLED',
          cancelledAt: new Date(),
        },
      });
      expect(await refused({ version, campaignId: ended.id })).toEqual([
        'This campaign has ended.',
      ]);
      const listless = await prisma.campaign.create({
        data: {
          tenantId: alpha.tenant,
          name: `No list ${randomUUID().slice(0, 6)}`,
        },
      });
      expect(await refused({ version, campaignId: listless.id })).toEqual([
        'This campaign has no lead list yet. Choose one in its setup first.',
      ]);
      // Without campaigns.write; with a stale version.
      const writer = createLeadSearchRepository(
        prisma,
        alpha.tenant,
        {
          kind: 'member',
          userId: FIXTURE_USERS.alphaAdmin.id,
          membershipId: alpha.membershipAdmin,
          roleId: alpha.roleAdmin,
          permissions: new Set(['contacts.read', 'contacts.write']),
        },
        () => new Date(),
      );
      await expect(
        writer.assign(alpha.contactShared, {
          version,
          campaignId: campaign.id,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        scope.leads.assign(alpha.contactShared, {
          version: version - 1,
          campaignId: campaign.id,
        }),
      ).rejects.toBeInstanceOf(LeadVersionConflictError);
      // A usable campaign: the lead joins its list, once.
      const assigned = await scope.leads.assign(alpha.contactShared, {
        version,
        campaignId: campaign.id,
      });
      expect(assigned.version).toBe(version + 1);
      expect(assigned.campaigns.map((c) => c.id)).toContain(campaign.id);
      expect(
        (
          await scope.leads.assign(alpha.contactShared, {
            version: version + 1,
            campaignId: campaign.id,
          })
        ).version,
      ).toBe(version + 1);
      // A lead on the do-not-contact list is never assigned.
      const own = await prisma.contact.findUniqueOrThrow({
        where: {
          tenantId_id: { tenantId: alpha.tenant, id: alpha.contactOwn },
        },
      });
      await prisma.suppression.create({
        data: {
          tenantId: alpha.tenant,
          normalizedEmail: own.normalizedEmail,
          reason: 'OPT_OUT',
          source: 'MANUAL',
        },
      });
      const blocked = await scope.leads
        .assign(alpha.contactOwn, {
          version: own.version,
          campaignId: campaign.id,
        })
        .catch((e: unknown) => e);
      expect(blocked).toBeInstanceOf(AssignmentNotPossibleError);
      expect(
        (blocked as AssignmentNotPossibleError).issues.map((i) => i.path),
      ).toEqual(['contactId']);
    });

    it("makes a company's leads stale when its research is corrected", async () => {
      const scope = await admin();
      // A lead with a decision at a company whose research is then corrected.
      const org = await prisma.organization.create({
        data: {
          tenantId: alpha.tenant,
          name: 'Research Co (synthetic)',
          normalizedDomain: `research-${randomUUID().slice(0, 6)}.example`,
          websiteUrl: 'https://research-co.example/',
        },
      });
      const person = await prisma.contact.create({
        data: {
          tenantId: alpha.tenant,
          organizationId: org.id,
          firstName: 'Rae',
          lastName: 'Search',
        },
      });
      await prisma.leadQualification.create({
        data: {
          tenantId: alpha.tenant,
          campaignId: alpha.campaign,
          contactId: person.id,
          version: 1,
          state: 'QUALIFIED',
          origin: 'AUTOMATIC',
          eligibilityStatus: 'review',
          reasons: [
            { code: 'score_review', message: 'Synthetic.', details: [] },
          ],
        },
      });
      const accepted = await scope.research.request(org.id, {});
      const research = systemScope(prisma, {
        tenantId: alpha.tenant,
        name: 'website_research',
      }).research;
      await research.beginRun(accepted.researchId, null);
      const text = 'Research Co sells synthetic software.';
      const at = new Date();
      const page = await research.savePage(org.id, {
        requestedUrl: 'https://research-co.example/',
        finalUrl: 'https://research-co.example/',
        status: 200,
        contentType: 'text/html',
        retrievedAt: at,
        contentSha256: sha(`body:${text}`),
        textSha256: sha(text),
        title: 'Research Co',
        text,
        textTruncated: false,
        links: [],
      });
      const run: CompleteRunInput = {
        run: {
          fields: ['products_services'],
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
            url: page.finalUrl,
            outcome: 'fetched',
            errorCode: null,
            sourceRecordId: page.sourceRecordId,
            retrievedAt: at.toISOString(),
            contentSha256: sha(`body:${text}`),
          },
        ],
        extracts: [
          {
            label: 'E1',
            sourceRecordId: page.sourceRecordId,
            url: page.finalUrl,
            retrievedAt: at,
            contentSha256: sha(`body:${text}`),
            text,
          },
        ],
        findings: {
          facts: [
            {
              field: 'products_services',
              value: 'Synthetic software',
              confidence: 'high',
              evidence: [{ label: 'E1', quote: text }],
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
      await scope.research.correct(org.id, {
        baseResearchId: accepted.researchId,
        field: 'products_services',
        action: 'reject',
        note: 'They no longer sell this (synthetic).',
      });
      const latest = await prisma.leadQualification.findFirstOrThrow({
        where: { tenantId: alpha.tenant, contactId: person.id },
        orderBy: { version: 'desc' },
      });
      // Back to Review, the eligibility kept (the person's facts didn't change).
      expect(latest).toMatchObject({
        version: 2,
        state: 'REVIEW',
        eligibilityStatus: 'review',
      });
      expect(JSON.stringify(latest.reasons)).toContain(
        'research was corrected',
      );
    });
  },
);

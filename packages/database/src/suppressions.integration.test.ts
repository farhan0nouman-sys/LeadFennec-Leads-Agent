import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { payloadSha256 } from './payload-hash.js';
import {
  memberScope,
  platformAdminScope,
  type TenantScope,
} from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
} from './tenancy/authorization.js';
import { LeadVersionConflictError } from './tenancy/lead-changes.js';
import {
  LeadHasNoAddressError,
  SuppressionNotRemovableError,
} from './tenancy/suppressions.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// The do-not-contact list and deletion requests (task 11C, docs/decisions.md D-11C-03, D-11C-04,
// docs/security/data-retention.md) on real PostgreSQL: adding an address or a domain reopens the
// leads it covers (their decisions back to Review with eligibility blocked); repeating changes
// nothing; only a member's own entries can be removed; a deletion request erases a lead and
// everything about them, and the records naming their address, keeping only the address on the
// list without a note; another workspace's lead with the same address is untouched; audits never
// hold an address. Runs only when TEST_DATABASE_URL is set; otherwise reported as skipped.
const db = new MigratedSchema('t11cs');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const SHARED = 'alex.rivera@shared-prospect.test';

describe.runIf(testDatabaseUrl !== undefined)(
  'the do-not-contact list and deletion requests on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let ownEmail = '';

    const as = (
      userId: string,
      tenantId = alpha.tenant,
    ): Promise<TenantScope> => memberScope(prisma, { tenantId, userId });
    const admin = () => as(FIXTURE_USERS.alphaAdmin.id);

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
    }, 120_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('adds, lists and removes entries, reopening the leads they cover', async () => {
      const scope = await admin();
      const fixtures = await scope.suppressions.list({});
      expect(
        fixtures.items.map((s) => [s.kind, s.value, s.reason, s.removable]),
      ).toEqual(
        expect.arrayContaining([
          ['email', 'opted.out@shared-prospect.test', 'OPT_OUT', false],
          ['domain', 'competitor.test', 'MANUAL', true],
        ]),
      );

      // The own lead's address: its decision goes back to Review, blocked.
      const decisionsBefore = await prisma.leadQualification.count({
        where: { tenantId: alpha.tenant, contactId: alpha.contactOwn },
      });
      const added = await scope.suppressions.add({
        kind: 'email',
        value: ` ${ownEmail.toUpperCase()} `,
        reason: 'OPT_OUT',
        note: 'Asked by phone (fixture).',
      });
      expect(added).toMatchObject({
        created: true,
        reopenedLeads: 1,
        suppression: {
          kind: 'email',
          value: ownEmail,
          reason: 'OPT_OUT',
          source: 'MANUAL',
          note: 'Asked by phone (fixture).',
          removable: false,
        },
      });
      const newest = await prisma.leadQualification.findFirst({
        where: { tenantId: alpha.tenant, contactId: alpha.contactOwn },
        orderBy: { version: 'desc' },
      });
      if (decisionsBefore > 0) {
        expect(newest).toMatchObject({
          state: 'REVIEW',
          origin: 'AUTOMATIC',
          eligibilityStatus: 'blocked',
        });
      }
      expect((await scope.leads.detail(alpha.contactOwn)).doNotContact).toBe(
        true,
      );
      // Repeating it changes nothing.
      await expect(
        scope.suppressions.add({ kind: 'email', value: ownEmail }),
      ).resolves.toMatchObject({ created: false, reopenedLeads: 0 });

      // A domain covers its subdomains too; a member's own entry can be removed.
      const domain = await scope.suppressions.add({
        kind: 'domain',
        value: 'https://www.Shared-Prospect.test/',
      });
      expect(domain).toMatchObject({
        created: true,
        reopenedLeads: 1,
        suppression: { kind: 'domain', value: 'shared-prospect.test' },
      });
      expect((await scope.leads.detail(alpha.contactShared)).doNotContact).toBe(
        true,
      );
      await scope.suppressions.remove(domain.suppression.id);
      expect((await scope.leads.detail(alpha.contactShared)).doNotContact).toBe(
        false,
      );
      await expect(
        scope.suppressions.remove(domain.suppression.id),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      // A person's request stays.
      await expect(
        scope.suppressions.remove(added.suppression.id),
      ).rejects.toBeInstanceOf(SuppressionNotRemovableError);

      // Search and filters.
      const found = await scope.suppressions.list({ q: 'SHARED-PROSPECT' });
      expect(found.items.map((s) => s.value)).toContain(
        'opted.out@shared-prospect.test',
      );
      expect(
        found.items.every((s) => s.value.includes('shared-prospect')),
      ).toBe(true);
      const domains = await scope.suppressions.list({ kind: 'domain' });
      expect(domains.items.every((s) => s.kind === 'domain')).toBe(true);

      // Audited without any address or domain.
      const audit = await prisma.auditRecord.findMany({
        where: {
          tenantId: alpha.tenant,
          action: { in: ['suppression.added', 'suppression.removed'] },
        },
      });
      expect(audit).toHaveLength(3);
      expect(JSON.stringify(audit)).not.toContain('@');
      expect(JSON.stringify(audit)).not.toContain('shared-prospect');

      // Beta's lead with the same address is not affected; beta can't remove alpha's entries.
      const betaAdmin = await as(FIXTURE_USERS.betaAdmin.id, beta.tenant);
      expect(
        (await betaAdmin.leads.detail(beta.contactShared)).doNotContact,
      ).toBe(false);
      await expect(
        betaAdmin.suppressions.remove(added.suppression.id),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      // Without suppressions.manage: refused. A platform admin may only look.
      const member = await as(FIXTURE_USERS.sharedMember.id);
      await expect(member.suppressions.list({})).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      const support = await platformAdminScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.platformAdmin.id,
        reason: 'Support request FIX-0013: checking the list',
      });
      expect(
        (await support.suppressions.list({})).items.length,
      ).toBeGreaterThan(0);
      await expect(
        support.suppressions.add({ kind: 'domain', value: 'x.example' }),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
    });

    it("puts a lead's own address on the list", async () => {
      const scope = await admin();
      await expect(
        scope.suppressions.suppressLead(alpha.contactNoEmail, {
          reason: 'MANUAL',
        }),
      ).rejects.toBeInstanceOf(LeadHasNoAddressError);
      await expect(
        scope.suppressions.suppressLead(beta.contactShared, {
          reason: 'MANUAL',
        }),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
    });

    it('erases a lead on request and keeps only their address', async () => {
      const scope = await admin();
      const tenantId = alpha.tenant;
      // An import row that named the address without becoming the lead (e.g. a failed row).
      const payload = { kind: 'person', name: 'Alex Rivera', email: SHARED };
      await prisma.sourceRecord.create({
        data: {
          tenantId,
          provider: 'CSV_IMPORT',
          importId: alpha.import,
          importRowNumber: 99,
          payload,
          payloadSha256: payloadSha256(payload),
          outcome: 'FAILED',
          issues: [{ field: 'row', message: 'fixture' }],
        },
      });
      const byLead = { tenantId, contactId: alpha.contactShared };
      const byCampaignLead = { tenantId, campaignLeadId: alpha.leadShared };
      const counts = async () => ({
        campaignLeads: await prisma.campaignLead.count({ where: byLead }),
        drafts: await prisma.draft.count({ where: byCampaignLead }),
        intents: await prisma.outboundIntent.count({ where: byCampaignLead }),
        threads: await prisma.emailThread.count({ where: byCampaignLead }),
        decisions: await prisma.leadQualification.count({ where: byLead }),
        checks: await prisma.verification.count({ where: byLead }),
        scores: await prisma.score.count({ where: byLead }),
        notes: await prisma.contactNote.count({ where: byLead }),
        tags: await prisma.contactTag.count({ where: byLead }),
        sources: await prisma.sourceRecord.count({ where: byLead }),
        lists: await prisma.leadListMember.count({ where: byLead }),
      });
      const before = await counts();
      expect(before.campaignLeads).toBeGreaterThan(0);
      expect(before.drafts).toBeGreaterThan(0);
      expect(before.notes).toBe(1);

      const { version } = await scope.leads.detail(alpha.contactShared);
      // A stale page erases nothing.
      await expect(
        scope.suppressions.deleteLead(alpha.contactShared, {
          version: version + 1,
        }),
      ).rejects.toBeInstanceOf(LeadVersionConflictError);
      // Without suppressions.manage: refused.
      const member = await as(FIXTURE_USERS.sharedMember.id);
      await expect(
        member.suppressions.deleteLead(alpha.contactShared, { version }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      const result = await scope.suppressions.deleteLead(alpha.contactShared, {
        version,
      });
      expect(result.deleted).toEqual({ contacts: 1, sourceRecords: 1 });
      expect(await counts()).toEqual({
        campaignLeads: 0,
        drafts: 0,
        intents: 0,
        threads: 0,
        decisions: 0,
        checks: 0,
        scores: 0,
        notes: 0,
        tags: 0,
        sources: 0,
        lists: 0,
      });
      expect(
        await prisma.sourceRecord.count({
          where: { tenantId, payload: { path: ['email'], equals: SHARED } },
        }),
      ).toBe(0);
      await expect(
        scope.leads.detail(alpha.contactShared),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      // Only the address stays: on the list, without a note.
      const kept = await prisma.suppression.findUniqueOrThrow({
        where: {
          tenantId_normalizedEmail: { tenantId, normalizedEmail: SHARED },
        },
      });
      expect(kept).toMatchObject({
        id: result.suppressionId,
        reason: 'DELETION_REQUEST',
        source: 'MANUAL',
        note: null,
      });
      // Beta's lead with the same address is untouched.
      expect(
        await prisma.contact.count({
          where: { tenantId: beta.tenant, normalizedEmail: SHARED },
        }),
      ).toBe(1);
      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: { tenantId, action: 'privacy.deletion_request_completed' },
      });
      expect(audit.metadata).toEqual({
        contacts: 1,
        sourceRecords: 1,
        addressKept: true,
      });
      expect(JSON.stringify(audit)).not.toContain('@');
    });

    it('erases by address, also for someone the workspace never saved', async () => {
      const scope = await admin();
      // An earlier entry keeps its reason but loses its note.
      const optedOut = await scope.suppressions.deletePerson({
        email: 'Opted.Out@Shared-Prospect.test',
      });
      expect(optedOut.deleted).toEqual({ contacts: 0, sourceRecords: 0 });
      const entry = await prisma.suppression.findUniqueOrThrow({
        where: {
          tenantId_id: {
            tenantId: alpha.tenant,
            id: optedOut.suppressionId ?? '',
          },
        },
      });
      expect(entry).toMatchObject({ reason: 'OPT_OUT', note: null });
      // Unknown: only the address is kept, so they're never imported.
      const unknown = await scope.suppressions.deletePerson({
        email: 'nobody@unknown.example',
      });
      expect(unknown).toMatchObject({
        deleted: { contacts: 0, sourceRecords: 0 },
      });
      await expect(
        prisma.suppression.findUniqueOrThrow({
          where: {
            tenantId_normalizedEmail: {
              tenantId: alpha.tenant,
              normalizedEmail: 'nobody@unknown.example',
            },
          },
        }),
      ).resolves.toMatchObject({ reason: 'DELETION_REQUEST', note: null });
      // A deletion request's entry must have no note (the database refuses one).
      await expect(
        prisma.suppression.create({
          data: {
            tenantId: alpha.tenant,
            normalizedEmail: 'with.note@unknown.example',
            reason: 'DELETION_REQUEST',
            source: 'MANUAL',
            note: 'kept data',
          },
        }),
      ).rejects.toThrow();
    });
  },
);

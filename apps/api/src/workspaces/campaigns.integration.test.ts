import { randomUUID } from 'node:crypto';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  activityResponseSchema,
  campaignPageSchema,
  campaignOptionsSchema,
  campaignSchema,
  campaignSummarySchema,
  CAMPAIGN_ROUTES as C,
  DASHBOARD_ROUTES as D,
  DEFAULT_LEAD_SCORING_CONFIG,
  invitationSchema,
  normalizeEmail,
  roleListResponseSchema,
  userWorkspaceSchema,
  WORKSPACE_ROUTES as R,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  expectError,
  expectNoSecretsLogged,
  lastMail,
  signedInUser,
  signIn,
  startApi,
  type Harness,
  type Session,
} from '../testing/api-harness.js';

// Campaign configuration over HTTP (task 06A, docs/api/campaigns.md): real Nest app, real
// PostgreSQL (its own schema). Drafts survive a reload, stale saves and other workspaces'
// records are refused, bounds are checked, and a copy never carries leads. Runs only when
// TEST_DATABASE_URL is set; otherwise it is reported as skipped, never as passed.
const db = new MigratedSchema('tcmp');

describe.runIf(testDatabaseUrl !== undefined)(
  'campaign routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let member: Session;
    let outsider: Session;
    let workspaceId: string;
    let otherWorkspaceId: string;
    /** Records of this workspace and of the outsider's. */
    const mine = { leadList: '', mailbox: '', template: '' };
    const theirs = { leadList: '', mailbox: '', template: '', icp: '' };

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    /** A lead list, a mailbox, a template and an ICP in `tenantId`. */
    async function records(tenantId: string, label: string) {
      const prisma = api.prisma;
      const leadList = await prisma.leadList.create({
        data: { tenantId, name: `${label} list` },
      });
      const address = normalizeEmail(`${label}.sender@example.com`).email;
      const mailbox = await prisma.emailAccount.create({
        data: {
          tenantId,
          provider: 'GMAIL',
          email: address,
          normalizedEmail: address,
        },
      });
      const template = await prisma.template.create({
        data: {
          tenantId,
          name: `${label} intro`,
          subject: 'Hello',
          body: 'Hello {{firstName}}',
        },
      });
      const icp = await prisma.icp.create({
        data: { tenantId, name: `${label} ICP`, criteria: {} },
      });
      return {
        leadList: leadList.id,
        mailbox: mailbox.id,
        template: template.id,
        icp: icp.id,
      };
    }

    async function create(session: Session, name: string) {
      const result = await call(api, C.campaigns(workspaceId), {
        body: { name },
        session,
      });
      expect(result.status, result.text).toBe(201);
      return campaignSchema.parse(result.json);
    }

    const save = (id: string, body: unknown, session = admin) =>
      call(api, C.campaign(workspaceId, id), {
        method: 'PATCH',
        body,
        session,
      });

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'cmp-admin');
      member = await signedInUser(api, 'cmp-member');
      outsider = await signedInUser(api, 'cmp-outsider');
      workspaceId = await newWorkspace(admin, 'Campaign team');
      otherWorkspaceId = await newWorkspace(outsider, 'Other team');
      const roles = roleListResponseSchema.parse(
        (await call(api, R.roles(workspaceId), { session: admin })).json,
      ).items;
      const invited = await call(api, R.invitations(workspaceId), {
        body: {
          email: member.email,
          roleId: roles.find((r) => r.key === 'client_member')?.id,
        },
        session: admin,
      });
      invitationSchema.parse(invited.json);
      const { token } = lastMail(api, member.email, 'workspace.invitation');
      const accepted = await call(api, R.acceptInvitation, {
        body: { token, workspaceId },
        session: member,
      });
      expect(accepted.status, accepted.text).toBe(200);
      Object.assign(mine, await records(workspaceId, 'mine'));
      Object.assign(theirs, await records(otherWorkspaceId, 'theirs'));
    }, 120_000);

    afterAll(async () => {
      await api.app.close();
      await db.drop();
      expectNoSecretsLogged();
    }, 60_000);

    it('creates an inactive draft with human approval', async () => {
      const result = await call(api, C.campaigns(workspaceId), {
        body: { name: 'Autumn launch', description: 'First try' },
        session: admin,
      });
      expect(result.status, result.text).toBe(201);
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(campaignSchema.parse(result.json)).toMatchObject({
        name: 'Autumn launch',
        status: 'DRAFT',
        version: 1,
        approvalMode: 'HUMAN',
        readiness: { complete: false },
      });
      // Team members may create campaigns too (campaigns.write).
      await create(member, 'Member launch');
      expectError(
        await call(api, C.campaigns(workspaceId), {
          body: { name: 'Autumn launch' },
          session: admin,
        }),
        409,
        'campaign_name_taken',
      );
      expectError(
        await call(api, C.campaigns(workspaceId), {
          body: { name: 'No token' },
          session: admin,
          withoutCsrf: true,
        }),
        403,
        'csrf_failed',
      );
      const list = campaignPageSchema.parse(
        (await call(api, C.campaigns(workspaceId), { session: member })).json,
      );
      expect(list.items.map((item) => item.name).sort()).toEqual([
        'Autumn launch',
        'Member launch',
      ]);
    });

    it('saves sections one at a time, and the draft survives a reload', async () => {
      const draft = await create(admin, 'Saved draft');
      const first = await save(draft.id, {
        version: 1,
        businessProfile: {
          companyName: 'Example Co',
          description: 'We build examples.',
        },
      });
      expect(first.status, first.text).toBe(200);
      const second = await save(draft.id, {
        version: 2,
        offer: { name: 'Audit', description: 'A free audit.' },
        audience: {
          leadListId: mine.leadList,
          filters: { countries: ['de', 'AT'], employeeCountMin: 10 },
        },
        sender: { emailAccountId: mine.mailbox },
        sequence: {
          steps: [
            { delayMinutes: 0, templateId: mine.template },
            { delayMinutes: 4320 },
          ],
        },
        leadLimits: { dailyNewLeads: 25, maxLeads: 500 },
        timezone: 'Europe/Vienna',
      });
      expect(second.status, second.text).toBe(200);
      const saved = campaignSchema.parse(second.json);
      expect(saved).toMatchObject({
        version: 3,
        businessProfile: { companyName: 'Example Co' },
        audience: { filters: { countries: ['DE', 'AT'] } },
        readiness: { complete: true, missing: [] },
      });

      // A reload: a new sign-in reads the stored draft, not anything cached.
      const again = await signIn(api, admin.email);
      const reloaded = await call(api, C.campaign(workspaceId, draft.id), {
        session: again,
      });
      expect(reloaded.status).toBe(200);
      expect(campaignSchema.parse(reloaded.json)).toEqual(saved);

      // The dashboard route next to it still answers (route order).
      expect(
        campaignSummarySchema.parse(
          (await call(api, D.campaignSummary(workspaceId), { session: admin }))
            .json,
        ).campaigns,
      ).toBeGreaterThanOrEqual(3);
      // The saves are in the workspace's activity.
      const activity = activityResponseSchema.parse(
        (await call(api, D.activity(workspaceId), { session: admin })).json,
      );
      expect(activity.items[0]?.action).toBe('campaign.updated');
    });

    it('refuses a stale save with version_conflict', async () => {
      const draft = await create(admin, 'Conflict');
      expect(
        (await save(draft.id, { version: 1, name: 'Tab one' })).status,
      ).toBe(200);
      const stale = expectError(
        await save(draft.id, { version: 1, name: 'Tab two' }),
        409,
        'version_conflict',
      );
      expect(stale.error.message).toContain('Reload');
      expect(
        campaignSchema.parse(
          (
            await call(api, C.campaign(workspaceId, draft.id), {
              session: admin,
            })
          ).json,
        ),
      ).toMatchObject({ version: 2, name: 'Tab one' });
    });

    it("rejects another workspace's records, naming each field", async () => {
      const draft = await create(admin, 'Foreign');
      const refused = expectError(
        await save(draft.id, {
          version: 1,
          audience: { icpId: theirs.icp, leadListId: theirs.leadList },
          sender: { emailAccountId: theirs.mailbox },
          sequence: {
            steps: [{ delayMinutes: 0, templateId: theirs.template }],
          },
          exclusions: { leadListIds: [theirs.leadList] },
        }),
        400,
        'validation_failed',
      );
      expect(refused.error.issues).toEqual([
        { path: 'audience.icpId', message: 'Not found in this workspace.' },
        {
          path: 'audience.leadListId',
          message: 'Not found in this workspace.',
        },
        {
          path: 'exclusions.leadListIds.0',
          message: 'Not found in this workspace.',
        },
        {
          path: 'sender.emailAccountId',
          message: 'Not found in this workspace.',
        },
        {
          path: 'sequence.steps.0.templateId',
          message: 'Not found in this workspace.',
        },
      ]);
      // Indistinguishable from an id that exists nowhere.
      const unknown = expectError(
        await save(draft.id, {
          version: 1,
          sender: { emailAccountId: randomUUID() },
        }),
        400,
        'validation_failed',
      );
      expect(unknown.error.issues).toEqual([
        {
          path: 'sender.emailAccountId',
          message: 'Not found in this workspace.',
        },
      ]);
      // The outsider can't see or change this workspace's campaigns.
      for (const result of [
        await call(api, C.campaign(workspaceId, draft.id), {
          session: outsider,
        }),
        await call(api, C.campaign(workspaceId, draft.id), {
          method: 'PATCH',
          body: { version: 1, name: 'Mine now' },
          session: outsider,
        }),
        await call(api, C.duplicate(workspaceId, draft.id), {
          body: {},
          session: outsider,
        }),
      ]) {
        expectError(result, 404, 'not_found');
      }
      // A campaign id from another workspace, used in this one: not found.
      const theirsCampaign = await call(api, C.campaigns(otherWorkspaceId), {
        body: { name: 'Their campaign' },
        session: outsider,
      });
      const theirId = campaignSchema.parse(theirsCampaign.json).id;
      expectError(
        await call(api, C.campaign(workspaceId, theirId), { session: admin }),
        404,
        'not_found',
      );
      expectError(
        await call(api, C.campaign(workspaceId, 'not-a-uuid'), {
          session: admin,
        }),
        404,
        'not_found',
      );
      expectError(
        await call(api, C.campaign(workspaceId, draft.id)),
        401,
        'unauthenticated',
      );
    });

    it('checks bounds and refuses unknown fields', async () => {
      const draft = await create(admin, 'Bounds');
      for (const body of [
        { version: 1 },
        { version: 1, leadLimits: { dailyNewLeads: 501 } },
        { version: 1, leadLimits: { dailyNewLeads: 100, maxLeads: 50 } },
        {
          version: 1,
          sequence: {
            steps: Array.from({ length: 11 }, () => ({ delayMinutes: 0 })),
          },
        },
        { version: 1, timezone: 'Nowhere/Special' },
        {
          version: 1,
          schedule: { weekdays: [], windowStartMinute: 0, windowEndMinute: 60 },
        },
        { version: 1, exclusions: { domains: ['not a domain'] } },
        { version: 1, offer: { name: 'x'.repeat(201) } },
        { version: 1, status: 'ACTIVE' },
        { version: 0, name: 'Zero' },
      ]) {
        expectError(await save(draft.id, body), 400, 'validation_failed');
      }
      expect(
        campaignSchema.parse(
          (
            await call(api, C.campaign(workspaceId, draft.id), {
              session: admin,
            })
          ).json,
        ).version,
      ).toBe(1);
    });

    it('saves custom score weights and refuses weights that do not add up to 100 (task 10A)', async () => {
      const draft = await create(admin, 'Scoring');
      expect(draft.scoring).toEqual({
        custom: false,
        config: DEFAULT_LEAD_SCORING_CONFIG,
      });
      const config = {
        weights: {
          industry: 30,
          decisionMaker: 30,
          sizeLocation: 10,
          supportedNeed: 10,
          contactQuality: 10,
          timing: 10,
        },
        missingData: {
          requiredFactors: ['decisionMaker'],
          maxMissingWeight: 20,
          whenInsufficient: 'REVIEW',
        },
      };
      const issueOf = async (scoring: unknown) =>
        expectError(
          await save(draft.id, { version: 1, scoring }),
          400,
          'validation_failed',
        ).error.issues;
      expect(
        await issueOf({
          ...config,
          weights: { ...config.weights, timing: 15 },
        }),
      ).toEqual([
        {
          path: 'scoring.weights',
          message: 'The weights add up to 105. Make them add up to 100.',
        },
      ]);
      expect(
        await issueOf({
          ...config,
          weights: { ...config.weights, timing: 0, industry: 40 },
          missingData: { ...config.missingData, requiredFactors: ['timing'] },
        }),
      ).toEqual([
        {
          path: 'scoring.missingData.requiredFactors.0',
          message:
            "Timing has a weight of 0. Give it a weight, or don't require it.",
        },
      ]);
      expect(
        await issueOf({
          ...config,
          missingData: { ...config.missingData, missingFactorCredit: 0.5 },
        }),
      ).toEqual([
        {
          path: 'scoring.missingData',
          message:
            'Lead Fennec doesn\'t recognize the setting "missingFactorCredit". A factor without evidence always earns 0 points.',
        },
      ]);
      const saved = await save(draft.id, { version: 1, scoring: config });
      expect(saved.status).toBe(200);
      expect(campaignSchema.parse(saved.json).scoring).toEqual({
        custom: true,
        config,
      });
      const reset = await save(draft.id, { version: 2, scoring: null });
      expect(campaignSchema.parse(reset.json).scoring).toEqual({
        custom: false,
        config: DEFAULT_LEAD_SCORING_CONFIG,
      });
    });

    it('keeps human approval unless someone who may approve, in a workspace that allows it, changes it', async () => {
      const draft = await create(admin, 'Approvals');
      expectError(
        await save(draft.id, { version: 1, approvalMode: 'AUTOMATIC' }, member),
        403,
        'forbidden',
      );
      const refused = expectError(
        await save(draft.id, { version: 1, approvalMode: 'AUTOMATIC' }),
        400,
        'validation_failed',
      );
      expect(refused.error.issues?.[0]?.path).toBe('approvalMode');
    });

    it('duplicates the configuration into a new draft, without its leads', async () => {
      const source = await create(admin, 'Running');
      await save(source.id, {
        version: 1,
        sender: { emailAccountId: mine.mailbox },
        sequence: { steps: [{ delayMinutes: 0, templateId: mine.template }] },
      });
      // Running, with an enrolled lead (later tasks do this; here, directly).
      const prisma = api.prisma;
      await prisma.campaign.update({
        where: { tenantId_id: { tenantId: workspaceId, id: source.id } },
        data: { status: 'ACTIVE', activatedAt: new Date() },
      });
      const contact = await prisma.contact.create({
        data: { tenantId: workspaceId, firstName: 'Fake' },
      });
      const sequence = await prisma.sequence.findFirstOrThrow({
        where: { tenantId: workspaceId, campaignId: source.id },
      });
      await prisma.campaignLead.create({
        data: {
          tenantId: workspaceId,
          campaignId: source.id,
          sequenceId: sequence.id,
          contactId: contact.id,
          status: 'ACTIVE',
          timezone: 'UTC',
        },
      });
      // A running campaign can't be edited, but it can be copied.
      expectError(
        await save(source.id, { version: 2, name: 'Edited' }),
        409,
        'campaign_not_editable',
      );
      const result = await call(api, C.duplicate(workspaceId, source.id), {
        body: {},
        session: member,
      });
      expect(result.status, result.text).toBe(201);
      const copy = campaignSchema.parse(result.json);
      expect(copy).toMatchObject({
        name: 'Running (copy)',
        status: 'DRAFT',
        version: 1,
        approvalMode: 'HUMAN',
        sender: { emailAccountId: mine.mailbox },
      });
      expect(copy.sequence.steps).toHaveLength(1);
      expect(
        await prisma.campaignLead.count({ where: { campaignId: copy.id } }),
      ).toBe(0);
      expect(
        await prisma.campaignLead.count({ where: { campaignId: source.id } }),
      ).toBe(1);
    });

    it('offers the workspace records a campaign may use (task 06B)', async () => {
      const result = await call(api, C.options(workspaceId), {
        session: member,
      });
      expect(result.status, result.text).toBe(200);
      const options = campaignOptionsSchema.parse(result.json);
      expect(options.leadLists.map((list) => list.id)).toEqual([mine.leadList]);
      expect(options.mailboxes).toEqual([
        expect.objectContaining({ id: mine.mailbox, status: 'PENDING' }),
      ]);
      expect(options.templates.map((t) => t.id)).toEqual([mine.template]);
      for (const id of Object.values(theirs)) {
        expect(result.text).not.toContain(id);
      }
      expectError(
        await call(api, C.options(workspaceId), { session: outsider }),
        404,
        'not_found',
      );
    });
  },
);

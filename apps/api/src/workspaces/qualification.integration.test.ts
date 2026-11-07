import { systemScope } from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  CAMPAIGN_ROUTES as C,
  campaignSchema,
  invitationSchema,
  leadPageSchema,
  leadQualificationViewSchema,
  QUALIFICATION_ROUTES as Q,
  qualifyAcceptedSchema,
  roleListResponseSchema,
  userWorkspaceSchema,
  WORKSPACE_ROUTES as R,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  clock,
  expectError,
  expectNoSecretsLogged,
  lastMail,
  signedInUser,
  startApi,
  type Harness,
  type Session,
} from '../testing/api-harness.js';

// Lead qualification over HTTP (task 10C, docs/decisions.md D-10C-*): real Nest app, real
// PostgreSQL (its own schema). The lead view keeps fit, eligibility and qualification apart; a
// run is queued for the worker (research.run); a person's decision needs campaigns.write, names
// its version (409) and never qualifies a blocked person (409 qualification_blocked); accepting
// review reasons needs drafts.approve; another workspace is a 404. The worker's part is played by
// the system scope. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as
// skipped, never as passed.
const db = new MigratedSchema('tqlf');

describe.runIf(testDatabaseUrl !== undefined)(
  'lead qualification routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let member: Session;
    let outsider: Session;
    let workspaceId: string;
    let campaignId: string;
    let contactId: string;
    const address = 'sam@widgets.example';

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    const lead = (session: Session, id = contactId) =>
      call(api, Q.lead(workspaceId, campaignId, id), { session });
    const decide = (body: unknown, session = admin) =>
      call(api, Q.decisions(workspaceId, campaignId, contactId), {
        body,
        session,
      });

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'qlf-admin');
      member = await signedInUser(api, 'qlf-member');
      outsider = await signedInUser(api, 'qlf-outsider');
      workspaceId = await newWorkspace(admin, 'Qualifying team');
      await newWorkspace(outsider, 'Other team');
      const roles = roleListResponseSchema.parse(
        (await call(api, R.roles(workspaceId), { session: admin })).json,
      ).items;
      invitationSchema.parse(
        (
          await call(api, R.invitations(workspaceId), {
            body: {
              email: member.email,
              roleId: roles.find((r) => r.key === 'client_member')?.id,
            },
            session: admin,
          })
        ).json,
      );
      const { token } = lastMail(api, member.email, 'workspace.invitation');
      const accepted = await call(api, R.acceptInvitation, {
        body: { token, workspaceId },
        session: member,
      });
      expect(accepted.status, accepted.text).toBe(200);

      const prisma = api.prisma;
      const list = await prisma.leadList.create({
        data: { tenantId: workspaceId, name: 'Prospects' },
      });
      const org = await prisma.organization.create({
        data: {
          tenantId: workspaceId,
          name: 'Widgets (synthetic)',
          normalizedDomain: 'widgets.example',
          industry: 'software',
        },
      });
      const contact = await prisma.contact.create({
        data: {
          tenantId: workspaceId,
          organizationId: org.id,
          firstName: 'Sam',
          title: 'VP Sales',
          email: address,
          normalizedEmail: address,
          emailDomain: 'widgets.example',
          countryCode: 'US',
        },
      });
      contactId = contact.id;
      await prisma.verification.create({
        data: {
          tenantId: workspaceId,
          contactId,
          normalizedEmail: address,
          provider: 'fake',
          status: 'VALID',
          // The API runs on the harness clock: a check dated after it is no check.
          checkedAt: new Date(clock.now.getTime() - 60_000),
        },
      });
      await prisma.leadListMember.create({
        data: { tenantId: workspaceId, leadListId: list.id, contactId },
      });
      const created = campaignSchema.parse(
        (
          await call(api, C.campaigns(workspaceId), {
            body: { name: 'Widgets' },
            session: admin,
          })
        ).json,
      );
      const saved = await call(api, C.campaign(workspaceId, created.id), {
        method: 'PATCH',
        body: { version: created.version, audience: { leadListId: list.id } },
        session: admin,
      });
      expect(saved.status, saved.text).toBe(200);
      campaignId = created.id;
      // The worker's part: a rules-only score and the automatic decision.
      const worker = systemScope(prisma, {
        tenantId: workspaceId,
        name: 'lead_qualification',
      });
      await worker.scoring.scoreLead(campaignId, contactId);
      await worker.qualification.recordAutomatic(campaignId, contactId, {
        agentStatus: 'unavailable',
      });
    }, 120_000);

    afterAll(async () => {
      expectNoSecretsLogged();
      await api.app.close();
      await api.prisma.$disconnect();
      await db.drop();
    });

    it("lists the campaign's leads and shows one with fit, eligibility and qualification apart", async () => {
      const page = await call(api, Q.leads(workspaceId, campaignId), {
        session: member,
      });
      expect(page.status, page.text).toBe(200);
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(leadPageSchema.parse(page.json).items).toEqual([
        {
          id: contactId,
          name: 'Sam',
          title: 'VP Sales',
          company: 'Widgets (synthetic)',
          score: expect.objectContaining({ band: 'LOW_PRIORITY' }) as unknown,
          state: 'REVIEW',
        },
      ]);
      const view = leadQualificationViewSchema.parse((await lead(member)).json);
      expect(view.fit?.factors.map((item) => item.factor)).toEqual([
        'industry',
        'decisionMaker',
        'sizeLocation',
        'supportedNeed',
        'contactQuality',
        'timing',
      ]);
      expect(view.fit?.factors[0]).toMatchObject({
        status: 'missing',
        missingReason: 'no_target',
        explanation: expect.stringContaining('targets no industries') as string,
      });
      expect(view.eligibility.checks.map((check) => check.key)).toContain(
        'verification',
      );
      expect(view.qualification).toMatchObject({
        state: 'REVIEW',
        origin: 'AUTOMATIC',
        reasons: [
          { code: 'agent_unavailable' },
          { code: 'score_low_priority' },
        ],
      });
      expect(view).toMatchObject({
        sendPermitted: false,
        readyToContact: false,
      });
    });

    it('queues one qualification run at a time, for members who may run research', async () => {
      const queued = await call(
        api,
        Q.qualify(workspaceId, campaignId, contactId),
        {
          body: {},
          session: member,
        },
      );
      expect(queued.status, queued.text).toBe(202);
      expect(qualifyAcceptedSchema.parse(queued.json)).toEqual({
        state: 'queued',
      });
      const again = await call(
        api,
        Q.qualify(workspaceId, campaignId, contactId),
        {
          body: {},
          session: admin,
        },
      );
      expect(qualifyAcceptedSchema.parse(again.json)).toEqual({
        state: 'running',
      });
      expect(
        leadQualificationViewSchema.parse((await lead(admin)).json).pending,
      ).toBe(true);
      expectError(
        await call(api, Q.qualify(workspaceId, campaignId, contactId), {
          body: { force: true },
          session: admin,
        }),
        400,
        'validation_failed',
      );
    });

    it("records a person's decision with a version check, and never qualifies a blocked person", async () => {
      const current = leadQualificationViewSchema.parse(
        (await lead(admin)).json,
      );
      const version = current.qualification?.version ?? 0;
      expectError(
        await decide({ version, state: 'QUALIFIED', note: ' ' }),
        400,
        'validation_failed',
      );
      // Accepting review reasons needs drafts.approve, which a client member doesn't have.
      expectError(
        await decide(
          {
            version,
            state: 'QUALIFIED',
            note: 'Fits well.',
            acceptReview: true,
          },
          member,
        ),
        403,
        'forbidden',
      );
      const decided = await decide({
        version,
        state: 'QUALIFIED',
        note: 'Fits well (synthetic).',
      });
      expect(decided.status, decided.text).toBe(201);
      expect(
        leadQualificationViewSchema.parse(decided.json).qualification,
      ).toMatchObject({
        version: version + 1,
        state: 'QUALIFIED',
        origin: 'PERSON',
        note: 'Fits well (synthetic).',
      });
      expectError(
        await decide({ version, state: 'REJECTED', note: 'Stale.' }),
        409,
        'version_conflict',
      );
      await api.prisma.suppression.create({
        data: {
          tenantId: workspaceId,
          normalizedEmail: address,
          reason: 'OPT_OUT',
          source: 'MANUAL',
        },
      });
      const blocked = expectError(
        await decide({
          version: version + 1,
          state: 'QUALIFIED',
          note: 'Still a great fit (synthetic).',
        }),
        409,
        'qualification_blocked',
      );
      expect(blocked.error.issues).toEqual([
        { path: 'eligibility', message: 'suppressed_email' },
      ]);
      const view = leadQualificationViewSchema.parse((await lead(admin)).json);
      expect(view).toMatchObject({
        eligibility: { status: 'blocked' },
        sendPermitted: false,
        readyToContact: false,
      });
    });

    it('refuses another workspace and anyone outside it', async () => {
      expectError(await lead(outsider), 404, 'not_found');
      const theirs = await api.prisma.contact.findFirst({
        where: { tenantId: { not: workspaceId } },
        select: { id: true },
      });
      if (theirs !== null) {
        expectError(await lead(admin, theirs.id), 404, 'not_found');
      }
      expectError(
        await call(api, Q.leads(workspaceId, campaignId), {}),
        401,
        'unauthenticated',
      );
    });
  },
);

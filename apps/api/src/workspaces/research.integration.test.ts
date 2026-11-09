import { createHash } from 'node:crypto';
import { systemScope } from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  invitationSchema,
  organizationResearchSchema,
  RESEARCH_ROUTES as RR,
  researchAcceptedSchema,
  researchVersionSchema,
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
  startApi,
  type Harness,
  type Session,
} from '../testing/api-harness.js';

// Website research over HTTP (task 09C, docs/decisions.md D-09C-*): real Nest app, real
// PostgreSQL (its own schema). Reading needs contacts.read; requesting and correcting need
// research.run; another workspace's company is a 404; corrections compare-and-set on the current
// version and are audited. The worker's part is played by the repository's system scope. Runs
// only when TEST_DATABASE_URL is set; otherwise it is reported as skipped, never as passed.
const db = new MigratedSchema('trsc');
const TEXT =
  'Acme Widgets makes synthetic widgets. We are headquartered in Lyon.';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe.runIf(testDatabaseUrl !== undefined)(
  'website research routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let viewer: Session;
    let outsider: Session;
    let workspaceId: string;
    let otherWorkspaceId: string;

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    const company = async (
      tenantId: string,
      websiteUrl: string | null = 'https://acme-widgets.example/',
    ) =>
      (
        await api.prisma.organization.create({
          data: { tenantId, name: 'Acme Widgets (synthetic)', websiteUrl },
        })
      ).id;

    /** Plays the worker: begins and completes the run with one stored page and one fact. */
    async function completeRun(researchId: string, organizationId: string) {
      const worker = systemScope(api.prisma, {
        tenantId: workspaceId,
        name: 'website_research',
      });
      await worker.research.beginRun(researchId, null);
      const now = new Date();
      const stored = await worker.research.savePage(organizationId, {
        requestedUrl: 'https://acme-widgets.example/',
        finalUrl: 'https://acme-widgets.example/',
        status: 200,
        contentType: 'text/html',
        retrievedAt: now,
        contentSha256: sha(`body:${TEXT}`),
        textSha256: sha(TEXT),
        title: 'Acme Widgets',
        text: TEXT,
        textTruncated: false,
        links: [],
      });
      await worker.research.completeRun(researchId, {
        run: {
          fields: ['company_summary', 'headquarters'],
          context: {
            campaignId: null,
            campaign: { businessProfile: null, offer: null, icp: null },
          },
        },
        kind: 'model',
        resultStatus: 'COMPLETED',
        inputSha256: sha(`input:${researchId}`),
        pages: [
          {
            url: stored.requestedUrl,
            outcome: 'fetched',
            errorCode: null,
            sourceRecordId: stored.sourceRecordId,
            retrievedAt: now.toISOString(),
            contentSha256: stored.contentSha256,
          },
        ],
        extracts: [
          {
            label: 'E1',
            sourceRecordId: stored.sourceRecordId,
            url: stored.finalUrl,
            retrievedAt: now,
            contentSha256: stored.contentSha256,
            text: TEXT,
          },
        ],
        findings: {
          facts: [
            {
              field: 'headquarters',
              value: 'Lyon',
              confidence: 'high',
              evidence: [
                { label: 'E1', quote: 'We are headquartered in Lyon.' },
              ],
            },
          ],
          hypotheses: [],
          unknownFields: ['company_summary'],
          reviewItems: [],
          warnings: [],
          ignoredInstructions: [],
          confidence: 'medium',
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            costMicroUsd: 0,
            modelCalls: 1,
          },
          model: {
            prompt: 'website-research/1',
            promptSha256: 'a'.repeat(64),
            schema: 'website-research-output/1',
            provider: 'FAKE',
            model: 'fake-model-1',
          },
        },
      });
    }

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'rsc-admin');
      viewer = await signedInUser(api, 'rsc-viewer');
      outsider = await signedInUser(api, 'rsc-outsider');
      workspaceId = await newWorkspace(admin, 'Research team');
      otherWorkspaceId = await newWorkspace(outsider, 'Other team');
      const roles = roleListResponseSchema.parse(
        (await call(api, R.roles(workspaceId), { session: admin })).json,
      ).items;
      invitationSchema.parse(
        (
          await call(api, R.invitations(workspaceId), {
            body: {
              email: viewer.email,
              roleId: roles.find((r) => r.key === 'client_member')?.id,
            },
            session: admin,
          })
        ).json,
      );
      const { token } = lastMail(api, viewer.email, 'workspace.invitation');
      const accepted = await call(api, R.acceptInvitation, {
        body: { token, workspaceId },
        session: viewer,
      });
      expect(accepted.status, accepted.text).toBe(200);
      // A role that may view companies and their research, but not run or correct it.
      const role = await api.prisma.role.create({
        data: { tenantId: workspaceId, key: 'viewer', name: 'Viewer' },
      });
      await api.prisma.rolePermission.create({
        data: {
          tenantId: workspaceId,
          roleId: role.id,
          permissionKey: 'contacts.read',
        },
      });
      await api.prisma.membership.update({
        where: {
          tenantId_userId: { tenantId: workspaceId, userId: viewer.userId },
        },
        data: { roleId: role.id },
      });
    }, 120_000);

    afterAll(async () => {
      expectNoSecretsLogged();
      await api.app.close();
      await api.prisma.$disconnect();
      await db.drop();
    });

    it('queues research, answers with the running run, and shows the company with no version yet', async () => {
      const orgId = await company(workspaceId);
      const empty = await call(api, RR.organization(workspaceId, orgId), {
        session: viewer,
      });
      expect(empty.status, empty.text).toBe(200);
      expect(empty.headers.get('cache-control')).toBe('no-store');
      expect(organizationResearchSchema.parse(empty.json)).toMatchObject({
        organization: {
          id: orgId,
          websiteUrl: 'https://acme-widgets.example/',
        },
        active: null,
        current: null,
        history: [],
        fresh: false,
      });
      const first = await call(api, RR.organization(workspaceId, orgId), {
        body: {},
        session: admin,
      });
      expect(first.status, first.text).toBe(202);
      const accepted = researchAcceptedSchema.parse(first.json);
      expect(accepted.state).toBe('queued');
      const again = await call(api, RR.organization(workspaceId, orgId), {
        body: { refresh: true },
        session: admin,
      });
      expect(researchAcceptedSchema.parse(again.json)).toEqual({
        researchId: accepted.researchId,
        state: 'running',
      });
      const audit = await api.prisma.auditRecord.findFirst({
        where: {
          tenantId: workspaceId,
          action: 'research.requested',
          targetId: accepted.researchId,
        },
      });
      expect(audit).not.toBeNull();
    });

    it('refuses callers and companies it must refuse', async () => {
      const orgId = await company(workspaceId);
      const theirs = await company(otherWorkspaceId);
      const bare = await company(workspaceId, null);
      expectError(
        await call(api, RR.organization(workspaceId, orgId), {
          body: {},
          session: viewer,
        }),
        403,
        'forbidden',
      );
      expectError(
        await call(api, RR.organization(workspaceId, orgId), {
          session: outsider,
        }),
        404,
        'not_found',
      );
      expectError(
        await call(api, RR.organization(workspaceId, theirs), {
          session: admin,
        }),
        404,
        'not_found',
      );
      expectError(
        await call(api, RR.organization(workspaceId, theirs), {
          body: {},
          session: admin,
        }),
        404,
        'not_found',
      );
      expectError(
        await call(api, RR.organization(workspaceId, bare), {
          body: {},
          session: admin,
        }),
        409,
        'research_not_possible',
      );
      expectError(
        await call(api, RR.organization(workspaceId, orgId), {
          body: { refresh: 'yes', extra: 1 },
          session: admin,
        }),
        400,
        'validation_failed',
      );
      // A malformed id reads like a missing company.
      expectError(
        await call(api, RR.organization(workspaceId, 'not-a-uuid'), {
          session: admin,
        }),
        404,
        'not_found',
      );
    });

    it('shows completed versions with dated evidence, and records audited corrections as new versions', async () => {
      const orgId = await company(workspaceId);
      const accepted = researchAcceptedSchema.parse(
        (
          await call(api, RR.organization(workspaceId, orgId), {
            body: {},
            session: admin,
          })
        ).json,
      );
      await completeRun(accepted.researchId, orgId);
      const research = organizationResearchSchema.parse(
        (
          await call(api, RR.organization(workspaceId, orgId), {
            session: viewer,
          })
        ).json,
      );
      expect(research.fresh).toBe(true);
      expect(research.current).toMatchObject({
        id: accepted.researchId,
        origin: 'MODEL',
        facts: [{ field: 'headquarters', value: 'Lyon', source: 'page' }],
        unknownFields: ['company_summary'],
        evidence: [{ kind: 'WEBSITE_EXCERPT', label: 'E1', excerpt: TEXT }],
      });
      // Fresh: a request without refresh answers with it and queues nothing.
      expect(
        researchAcceptedSchema.parse(
          (
            await call(api, RR.organization(workspaceId, orgId), {
              body: {},
              session: admin,
            })
          ).json,
        ),
      ).toEqual({ researchId: accepted.researchId, state: 'fresh' });

      const corrected = await call(api, RR.corrections(workspaceId, orgId), {
        body: {
          baseResearchId: accepted.researchId,
          field: 'headquarters',
          action: 'set',
          value: 'Lyon, France',
          note: 'Checked with the company (synthetic).',
        },
        session: admin,
      });
      expect(corrected.status, corrected.text).toBe(201);
      const version = researchVersionSchema.parse(corrected.json);
      expect(version).toMatchObject({
        origin: 'CORRECTION',
        basedOnId: accepted.researchId,
        facts: [
          { field: 'headquarters', value: 'Lyon, France', source: 'person' },
        ],
      });
      // The earlier version is unchanged and still readable.
      const earlier = researchVersionSchema.parse(
        (
          await call(api, RR.version(workspaceId, orgId, accepted.researchId), {
            session: viewer,
          })
        ).json,
      );
      expect(earlier.facts[0]).toMatchObject({ value: 'Lyon', source: 'page' });

      expectError(
        await call(api, RR.corrections(workspaceId, orgId), {
          body: {
            baseResearchId: accepted.researchId,
            field: 'headquarters',
            action: 'reject',
            note: 'stale view',
          },
          session: admin,
        }),
        409,
        'version_conflict',
      );
      expectError(
        await call(api, RR.corrections(workspaceId, orgId), {
          body: {
            baseResearchId: version.id,
            field: 'headquarters',
            action: 'set',
            note: 'no value',
          },
          session: admin,
        }),
        400,
        'validation_failed',
      );
      expectError(
        await call(api, RR.corrections(workspaceId, orgId), {
          body: {
            baseResearchId: version.id,
            field: 'company_summary',
            action: 'restore',
            note: 'nothing to restore',
          },
          session: admin,
        }),
        400,
        'validation_failed',
      );
      expectError(
        await call(api, RR.corrections(workspaceId, orgId), {
          body: {
            baseResearchId: version.id,
            field: 'headquarters',
            action: 'reject',
            note: 'viewer',
          },
          session: viewer,
        }),
        403,
        'forbidden',
      );
      const audit = await api.prisma.auditRecord.findFirstOrThrow({
        where: {
          tenantId: workspaceId,
          action: 'research.corrected',
          targetId: version.id,
        },
      });
      expect(audit.metadata).toEqual({
        organizationId: orgId,
        basedOnId: accepted.researchId,
        field: 'headquarters',
        correction: 'set',
      });
      // A version of another company is a 404 here.
      const other = await company(workspaceId);
      expectError(
        await call(api, RR.version(workspaceId, other, version.id), {
          session: admin,
        }),
        404,
        'not_found',
      );
    });
  },
);

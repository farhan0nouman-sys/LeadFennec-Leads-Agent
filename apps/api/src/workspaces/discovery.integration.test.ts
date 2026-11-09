import { randomUUID } from 'node:crypto';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  discoveryAcceptedSchema,
  DISCOVERY_ROUTES as D,
  importRunSchema,
  invitationSchema,
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

// Lead discovery over HTTP (task 07A, docs/api/discovery.md): real Nest app, real PostgreSQL
// (its own schema), the fake organization search provider. A request answers 202 with a run id
// and status URL; unsupported filters, excessive limits, other workspaces' ICPs and callers
// without imports.create are refused clearly. Runs only when TEST_DATABASE_URL is set;
// otherwise it is reported as skipped, never as passed.
const db = new MigratedSchema('tdsc');
const ATTRIBUTION =
  'Synthetic companies from the Lead Fennec test directory, not real businesses.';

describe.runIf(testDatabaseUrl !== undefined)(
  'lead discovery routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let viewer: Session;
    let outsider: Session;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let icpId: string;
    let theirIcpId: string;

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    const icp = async (tenantId: string, criteria: object) =>
      (
        await api.prisma.icp.create({
          data: {
            tenantId,
            name: `ICP ${randomUUID()}`,
            criteria,
            status: 'ACTIVE',
          },
        })
      ).id;

    const discover = (body: unknown, session = admin, ws = workspaceId) =>
      call(api, D.request(ws), { body, session });

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'dsc-admin');
      viewer = await signedInUser(api, 'dsc-viewer');
      outsider = await signedInUser(api, 'dsc-outsider');
      workspaceId = await newWorkspace(admin, 'Discovery team');
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
      // A custom role that may view leads but not import or search for them.
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
      icpId = await icp(workspaceId, {
        industries: ['software'],
        countries: ['de', 'US'],
        employees: { min: 50, max: 500 },
        titles: ['VP Sales'],
      });
      theirIcpId = await icp(otherWorkspaceId, { industries: ['retail'] });
    }, 120_000);

    afterAll(async () => {
      expectNoSecretsLogged();
      await api.app.close();
      await api.prisma.$disconnect();
      await db.drop();
    });

    it('accepts a search from an ICP with a run id and a status URL, and queues it', async () => {
      const result = await discover({ icpId, maxResults: 50 });
      expect(result.status, result.text).toBe(202);
      expect(result.headers.get('cache-control')).toBe('no-store');
      const accepted = discoveryAcceptedSchema.parse(result.json);
      expect(accepted).toEqual({
        runId: accepted.runId,
        status: 'PENDING',
        statusUrl: D.run(workspaceId, accepted.runId),
      });

      const status = await call(api, accepted.statusUrl, { session: admin });
      expect(status.status, status.text).toBe(200);
      const run = importRunSchema.parse(status.json);
      expect(run).toMatchObject({
        id: accepted.runId,
        source: 'ORGANIZATION_SEARCH',
        status: 'PENDING',
        search: {
          icpId,
          provider: 'FAKE',
          filters: {
            industries: ['software'],
            countries: ['DE', 'US'],
            employees: { min: 50, max: 500 },
          },
          maxResults: 50,
          ignoredCriteria: ['titles'],
          attribution: ATTRIBUTION,
        },
        counts: {
          found: 0,
          saved: 0,
          created: 0,
          excluded: 0,
          failed: 0,
          repeated: 0,
        },
        fileName: null,
        pagesFetched: 0,
        errorCode: null,
        startedAt: null,
        completedAt: null,
      });

      // One durable task naming only the run; no company or contact is written here.
      const tasks = await api.prisma.jobTask.findMany({
        where: { tenantId: workspaceId, taskType: 'lead_discovery.search' },
      });
      expect(tasks.map((t) => t.payload)).toEqual([
        { importId: accepted.runId },
      ]);
      expect(
        await api.prisma.organization.count({
          where: { tenantId: workspaceId },
        }),
      ).toBe(0);
      expect(
        await api.prisma.contact.count({ where: { tenantId: workspaceId } }),
      ).toBe(0);

      // The same request again: a new run with the same query.
      const again = discoveryAcceptedSchema.parse(
        (await discover({ icpId, maxResults: 50 })).json,
      );
      const rows = await api.prisma.import.findMany({
        where: {
          tenantId: workspaceId,
          id: { in: [accepted.runId, again.runId] },
        },
        select: { querySha256: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]?.querySha256).toBe(rows[1]?.querySha256);
    });

    it('refuses unsupported filters and excessive limits with a reason for each', async () => {
      const unsupported = await icp(workspaceId, {
        industries: ['software'],
        technologies: ['CRM'],
        annualRevenue: { min: 1_000_000 },
      });
      const body = expectError(
        await discover({ icpId: unsupported }),
        400,
        'validation_failed',
      );
      expect(body.error.message).toBe("The search can't run as asked.");
      expect(body.error.issues?.map((i) => i.path).sort()).toEqual([
        'criteria.annualRevenue',
        'criteria.technologies',
      ]);

      const capped = expectError(
        await discover({ icpId, maxResults: 600 }),
        400,
        'validation_failed',
      );
      expect(capped.error.issues).toEqual([
        {
          path: 'maxResults',
          message: 'Ask for at most 500 companies in one search.',
        },
      ]);
      for (const invalid of [
        { icpId, maxResults: 5000 },
        { icpId, maxResults: 0 },
        { icpId, maxResults: '10' },
        { icpId: 'not-a-uuid' },
        { icpId, filters: { industries: ['retail'] } },
        {},
      ]) {
        const refused = expectError(
          await discover(invalid),
          400,
          'validation_failed',
        );
        expect(refused.error.message).toBe('The request is invalid.');
      }
      // Nothing was queued for a refused request.
      expect(
        await api.prisma.import.count({
          where: { tenantId: workspaceId, icpId: unsupported },
        }),
      ).toBe(0);
    });

    it("keeps runs and ICPs to their workspace and refuses callers who can't search", async () => {
      const mine = discoveryAcceptedSchema.parse(
        (await discover({ icpId })).json,
      );
      // Another workspace's ICP reads exactly like a missing one.
      for (const other of [theirIcpId, randomUUID()]) {
        const refused = expectError(
          await discover({ icpId: other }),
          400,
          'validation_failed',
        );
        expect(refused.error.issues).toEqual([
          { path: 'icpId', message: 'Not found in this workspace.' },
        ]);
      }
      // The outsider is not a member: the workspace and its runs don't exist for them.
      expectError(await discover({ icpId }, outsider), 404, 'not_found');
      expectError(
        await call(api, D.run(workspaceId, mine.runId), { session: outsider }),
        404,
        'not_found',
      );
      // Their own workspace doesn't have the run either.
      expectError(
        await call(api, D.run(otherWorkspaceId, mine.runId), {
          session: outsider,
        }),
        404,
        'not_found',
      );
      expectError(
        await call(api, D.run(workspaceId, 'not-a-uuid'), { session: admin }),
        404,
        'not_found',
      );
      // A member without imports.create.
      expectError(await discover({ icpId }, viewer), 403, 'forbidden');
      expectError(
        await call(api, D.run(workspaceId, mine.runId), { session: viewer }),
        403,
        'forbidden',
      );
      // No session, no CSRF token, another site.
      expectError(
        await call(api, D.request(workspaceId), { body: { icpId } }),
        401,
        'unauthenticated',
      );
      expectError(
        await call(api, D.request(workspaceId), {
          body: { icpId },
          session: admin,
          withoutCsrf: true,
        }),
        403,
        'csrf_failed',
      );
      expectError(
        await call(api, D.request(workspaceId), {
          body: { icpId },
          session: admin,
          browser: { origin: 'https://evil.example', site: 'cross-site' },
        }),
        403,
        'forbidden_origin',
      );
    });
  },
);

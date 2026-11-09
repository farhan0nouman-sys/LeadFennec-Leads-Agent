import { randomUUID } from 'node:crypto';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  discoveryAcceptedSchema,
  DISCOVERY_ROUTES as D,
  IMPORT_ROUTES as I,
  importOptionsSchema,
  importResultPageSchema,
  importRunPageSchema,
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

// Imports over HTTP (task 07C, docs/api/discovery.md): CSV imports with a mapping and an error
// report per row, results in pages, runs listed, options, cancellation, and the guards. Real
// Nest app and PostgreSQL (its own schema). Runs only when TEST_DATABASE_URL is set; otherwise
// it is reported as skipped, never as passed.
const db = new MigratedSchema('timp');
const INDUSTRY = 'Industrial automation, robotics and machine vision services '
  .repeat(3)
  .trim()
  .slice(0, 190);

describe.runIf(testDatabaseUrl !== undefined)(
  'import routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let viewer: Session;
    let outsider: Session;
    let workspaceId: string;
    let icpId: string;

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    const importCsv = (body: unknown, session = admin) =>
      call(api, I.csv(workspaceId), { body, session });

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'imp-admin');
      viewer = await signedInUser(api, 'imp-viewer');
      outsider = await signedInUser(api, 'imp-outsider');
      workspaceId = await newWorkspace(admin, 'Import team');
      await newWorkspace(outsider, 'Elsewhere');
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
      expect(
        (
          await call(api, R.acceptInvitation, {
            body: { token, workspaceId },
            session: viewer,
          })
        ).status,
      ).toBe(200);
      // A role that may see leads but not import them.
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
      icpId = (
        await api.prisma.icp.create({
          data: {
            tenantId: workspaceId,
            name: 'Software',
            criteria: { industries: ['software'] },
            status: 'ACTIVE',
          },
        })
      ).id;
    }, 120_000);

    afterAll(async () => {
      expectNoSecretsLogged();
      await api.app.close();
      await api.prisma.$disconnect();
      await db.drop();
    });

    it('imports a CSV larger than 100 KB, with a result for every row', async () => {
      const lines = ['Company,Domain,Industry'];
      for (let i = 1; i <= 480; i += 1) {
        lines.push(
          `Company ${String(i)} Holdings,company-${String(i)}.example,"${INDUSTRY}"`,
        );
      }
      lines.push(',missing-name.example,');
      const content = lines.join('\n');
      expect(content.length).toBeGreaterThan(100_000);
      const result = await importCsv({
        fileName: 'big.csv',
        content,
        mapping: { name: 'Company', domain: 'Domain', industry: 'Industry' },
      });
      expect(result.status, result.text).toBe(201);
      const run = importRunSchema.parse(result.json);
      expect(run).toMatchObject({
        source: 'CSV',
        status: 'COMPLETED',
        fileName: 'big.csv',
        counts: {
          found: 481,
          saved: 480,
          created: 480,
          excluded: 0,
          failed: 1,
        },
      });

      // Results page in file order, and filter by outcome.
      const first = importResultPageSchema.parse(
        (
          await call(api, `${I.results(workspaceId, run.id)}?limit=100`, {
            session: admin,
          })
        ).json,
      );
      expect(first.items).toHaveLength(100);
      expect(first.items[0]).toMatchObject({ position: 2, outcome: 'CREATED' });
      expect(first.nextCursor).not.toBeNull();
      const second = importResultPageSchema.parse(
        (
          await call(
            api,
            `${I.results(workspaceId, run.id)}?limit=100&cursor=${first.nextCursor ?? ''}`,
            { session: admin },
          )
        ).json,
      );
      expect(second.items[0]?.position).toBe(102);
      const failed = importResultPageSchema.parse(
        (
          await call(api, `${I.results(workspaceId, run.id)}?outcome=FAILED`, {
            session: admin,
          })
        ).json,
      );
      expect(failed.items).toEqual([
        expect.objectContaining({
          position: 482,
          outcome: 'FAILED',
          domain: 'missing-name.example',
          issues: [{ field: 'name', message: 'Enter a company name.' }],
        }),
      ]);
      expectError(
        await call(api, `${I.results(workspaceId, run.id)}?cursor=forged`, {
          session: admin,
        }),
        400,
        'validation_failed',
      );

      // The same file again: nothing new.
      const again = importRunSchema.parse(
        (
          await importCsv({
            fileName: 'big.csv',
            content,
            mapping: {
              name: 'Company',
              domain: 'Domain',
              industry: 'Industry',
            },
          })
        ).json,
      );
      expect(again.counts).toMatchObject({ saved: 480, created: 0 });
      expect(
        await api.prisma.organization.count({
          where: { tenantId: workspaceId },
        }),
      ).toBe(480);
    }, 120_000);

    it('lists runs, offers options, and cancels a queued search once', async () => {
      const options = importOptionsSchema.parse(
        (await call(api, I.options(workspaceId), { session: admin })).json,
      );
      expect(options.icps).toEqual([{ id: icpId, name: 'Software' }]);
      expect(options.search).toMatchObject({
        provider: 'FAKE',
        maxResults: 500,
      });

      const accepted = discoveryAcceptedSchema.parse(
        (
          await call(api, D.request(workspaceId), {
            body: { icpId, maxResults: 10 },
            session: admin,
          })
        ).json,
      );
      const list = importRunPageSchema.parse(
        (await call(api, I.imports(workspaceId), { session: admin })).json,
      );
      expect(list.items[0]).toMatchObject({
        id: accepted.runId,
        status: 'PENDING',
      });

      for (let i = 0; i < 2; i += 1) {
        const cancelled = await call(
          api,
          I.cancel(workspaceId, accepted.runId),
          {
            body: {},
            session: admin,
          },
        );
        expect(cancelled.status, cancelled.text).toBe(200);
        expect(importRunSchema.parse(cancelled.json).status).toBe('CANCELLED');
      }
      // A finished import can't be cancelled; the body is strict.
      const csv = list.items.find((item) => item.source === 'CSV');
      expectError(
        await call(api, I.cancel(workspaceId, csv?.id ?? randomUUID()), {
          body: {},
          session: admin,
        }),
        409,
        'import_not_cancellable',
      );
      expectError(
        await call(api, I.cancel(workspaceId, accepted.runId), {
          body: { reason: 'x' },
          session: admin,
        }),
        400,
        'validation_failed',
      );
    });

    it('explains files and mappings it cannot import, and limits the body', async () => {
      const unmapped = expectError(
        await importCsv({
          fileName: 'a.csv',
          content: 'Company\nAcme',
          mapping: { name: 'Company', domain: 'Domain' },
        }),
        400,
        'validation_failed',
      );
      expect(unmapped.error.message).toBe(
        "The file can't be imported as it is.",
      );
      expect(unmapped.error.issues).toEqual([
        { path: 'mapping.domain', message: 'The file has no column "Domain".' },
      ]);
      expect(
        expectError(
          await importCsv({
            fileName: 'a.csv',
            content: 'Company\n"Acme',
            mapping: { name: 'Company' },
          }),
          400,
          'validation_failed',
        ).error.issues,
      ).toEqual([
        { path: 'content', message: 'A quoted cell is not closed. (line 2)' },
      ]);
      expect(
        expectError(
          await importCsv({
            fileName: 'a.csv',
            content: 'x'.repeat(300_000),
            mapping: { name: 'Company' },
          }),
          400,
          'validation_failed',
        ).error.issues?.[0],
      ).toEqual({
        path: 'content',
        message: 'The file is larger than 256 KB. Split it into smaller files.',
      });
      // Over the 1 MB body limit: refused before any route runs.
      const huge = await importCsv({
        fileName: 'a.csv',
        content: 'x'.repeat(1_100_000),
        mapping: { name: 'Company' },
      });
      expect(huge.status).toBe(413);
    });

    it('needs imports.create and membership, and CSRF on changes', async () => {
      const file = {
        fileName: 'a.csv',
        content: 'Company\nAcme',
        mapping: { name: 'Company' },
      };
      expectError(await importCsv(file, viewer), 403, 'forbidden');
      for (const path of [
        I.imports(workspaceId),
        I.options(workspaceId),
        I.results(workspaceId, randomUUID()),
      ]) {
        expectError(
          await call(api, path, { session: viewer }),
          403,
          'forbidden',
        );
        expectError(
          await call(api, path, { session: outsider }),
          404,
          'not_found',
        );
      }
      expectError(await importCsv(file, outsider), 404, 'not_found');
      expectError(
        await call(api, I.csv(workspaceId), {
          body: file,
          session: admin,
          withoutCsrf: true,
        }),
        403,
        'csrf_failed',
      );
      expectError(
        await call(api, I.cancel(workspaceId, randomUUID()), {
          body: {},
          session: admin,
          withoutCsrf: true,
        }),
        403,
        'csrf_failed',
      );
      expectError(
        await call(api, I.results(workspaceId, randomUUID()), {
          session: admin,
        }),
        404,
        'not_found',
      );
    });
  },
);

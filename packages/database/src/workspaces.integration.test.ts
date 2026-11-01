import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_ROLES } from '@lead-fennec-ai/shared';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createPrismaClient } from './client.js';
import {
  createFixtureFactory,
  type FixtureFactory,
} from './fixtures/factories.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import {
  memberScope,
  platformAdminScope,
  platformConsole,
  systemScope,
} from './tenancy/access.js';
import {
  ActorNotAllowedError,
  TenantAccessDeniedError,
} from './tenancy/actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
} from './tenancy/authorization.js';
import {
  acceptInvitation,
  AlreadyMemberError,
  InvitationError,
  previewInvitation,
} from './tenancy/invitations.js';
import { LastAdminError } from './tenancy/members.js';
import {
  claimJob,
  defineWorker,
  enqueueJob,
  JobRejectedError,
} from './tenancy/worker-context.js';
import {
  createWorkspace,
  listUserWorkspaces,
  SlugTakenError,
} from './tenancy/workspaces.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Workspaces, invitations, role-based authorization and the worker context (task 04B,
// docs/decisions.md D-04B-*) on real PostgreSQL. The HTTP routes are tested in apps/api.
// Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped, never passed.
const db = new MigratedSchema('t04b');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const REASON = 'Support request FIX-0042: workspace review';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-02T09:00:00Z');
const WEEK = at('2026-11-09T09:00:00Z');

describe.runIf(testDatabaseUrl !== undefined)(
  'workspaces and invitations on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let client: Client;
    let factory: FixtureFactory;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      client = await db.connect();
      factory = createFixtureFactory(prisma);
    }, 60_000);

    afterAll(async () => {
      await client.end();
      await prisma.$disconnect();
      await db.drop();
    }, 60_000);

    async function verifiedUser(label: string) {
      return factory.user({
        email: `${label}.${randomUUID().slice(0, 8)}@example.test`,
        emailVerifiedAt: at('2026-11-01T00:00:00Z'),
      });
    }

    async function workspaceOf(label: string) {
      const owner = await verifiedUser(label);
      const created = await createWorkspace(
        prisma,
        {
          userId: owner.id,
          name: `${label} workspace`,
          slug: `${label}-${randomUUID().slice(0, 8)}`,
        },
        NOW,
      );
      const admin = await memberScope(
        prisma,
        {
          tenantId: created.workspace.id,
          userId: owner.id,
        },
        { now: () => NOW },
      );
      return { owner, created, admin, tenantId: created.workspace.id };
    }

    describe('workspace creation', () => {
      it('creates the workspace, its system roles and the creator as Client Admin, audited', async () => {
        const { owner, created, admin, tenantId } = await workspaceOf('acme');
        expect(created.membership.role.key).toBe('client_admin');
        expect(created.membership.permissions).toEqual(
          [...SYSTEM_ROLES.client_admin.permissions].sort(),
        );
        expect(admin.actor).toMatchObject({ kind: 'member', userId: owner.id });
        const roles = await admin.members.roles();
        expect(
          roles.map((r) => [r.key, r.isSystem, r.permissions.length]),
        ).toEqual([
          ['client_admin', true, SYSTEM_ROLES.client_admin.permissions.length],
          [
            'client_member',
            true,
            SYSTEM_ROLES.client_member.permissions.length,
          ],
        ]);
        const audit = await prisma.auditRecord.findMany({
          where: { tenantId },
        });
        expect(audit.map((a) => [a.action, a.actorUserId])).toEqual([
          ['workspace.created', owner.id],
        ]);
        expect(await listUserWorkspaces(prisma, owner.id)).toEqual([created]);
      });

      it('refuses taken slugs, unverified and disabled users', async () => {
        const owner = await verifiedUser('slug');
        await createWorkspace(
          prisma,
          { userId: owner.id, name: 'One', slug: 'taken-slug' },
          NOW,
        );
        await expect(
          createWorkspace(
            prisma,
            { userId: owner.id, name: 'Two', slug: 'taken-slug' },
            NOW,
          ),
        ).rejects.toThrow(SlugTakenError);
        const unverified = await factory.user();
        await expect(
          createWorkspace(
            prisma,
            {
              userId: unverified.id,
              name: 'X',
              slug: `x-${randomUUID().slice(0, 8)}`,
            },
            NOW,
          ),
        ).rejects.toThrow(ActorNotAllowedError);
        await expect(
          createWorkspace(
            prisma,
            { userId: owner.id, name: 'Bad', slug: 'Not A Slug' },
            NOW,
          ),
        ).rejects.toThrow(ZodError);
      });
    });

    describe('roles and permissions', () => {
      it('lets members read the team but only admins change roles', async () => {
        const { tenantId, admin, created } = await workspaceOf('team');
        const user = await verifiedUser('member');
        const roles = await admin.members.roles();
        const memberRole = roles.find((r) => r.key === 'client_member');
        const adminRole = roles.find((r) => r.key === 'client_admin');
        if (memberRole === undefined || adminRole === undefined) {
          throw new Error('roles missing');
        }
        const membership = await factory.membership({
          tenantId,
          userId: user.id,
          roleId: memberRole.id,
        });
        const member = await memberScope(prisma, { tenantId, userId: user.id });
        expect((await member.members.list({ limit: 10 })).items).toHaveLength(
          2,
        );
        await expect(
          member.members.changeRole(created.membership.id, memberRole.id),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
          member.invitations.create({
            email: 'x@example.test',
            roleId: memberRole.id,
            tokenHash: sha('x'),
            expiresAt: WEEK,
          }),
        ).rejects.toThrow(PermissionDeniedError);
        // Promote, then the original admin may step down; the last admin may not.
        expect(
          (await admin.members.changeRole(membership.id, adminRole.id)).role
            .key,
        ).toBe('client_admin');
        await admin.members.changeRole(created.membership.id, memberRole.id);
        const promoted = await memberScope(prisma, {
          tenantId,
          userId: user.id,
        });
        await expect(
          promoted.members.changeRole(membership.id, memberRole.id),
        ).rejects.toThrow(LastAdminError);
        const audit = await prisma.auditRecord.findMany({
          where: { tenantId, action: 'membership.role_changed' },
          orderBy: { id: 'asc' },
        });
        expect(audit.map((a) => a.metadata)).toEqual([
          { from: 'client_member', to: 'client_admin' },
          { from: 'client_admin', to: 'client_member' },
        ]);
      });

      it("treats another workspace's record ids as not found", async () => {
        const { admin } = await workspaceOf('isolated');
        const roles = await admin.members.roles();
        const ownRole = roles[0]?.id ?? '';
        const ownMember = (await admin.members.list({})).items[0]?.id ?? '';
        await expect(
          admin.members.changeRole(alpha.membershipShared, ownRole),
        ).rejects.toThrow(RecordNotFoundError);
        await expect(
          admin.members.changeRole(ownMember, alpha.roleAdmin),
        ).rejects.toThrow(RecordNotFoundError);
        await expect(
          admin.invitations.revoke(alpha.invitationOpen),
        ).rejects.toThrow(RecordNotFoundError);
        await expect(
          admin.invitations.create({
            email: 'y@example.test',
            roleId: alpha.roleMember,
            tokenHash: sha('y'),
            expiresAt: WEEK,
          }),
        ).rejects.toThrow(RecordNotFoundError);
        // Alpha's invitation is untouched.
        expect(
          await prisma.invitation.findUniqueOrThrow({
            where: {
              tenantId_id: { tenantId: alpha.tenant, id: alpha.invitationOpen },
            },
            select: { revokedAt: true },
          }),
        ).toEqual({ revokedAt: null });
      });

      it('lets platform admins read the team (audited access) but not change it, and workers neither', async () => {
        const support = await platformAdminScope(prisma, {
          tenantId: alpha.tenant,
          userId: FIXTURE_USERS.platformAdmin.id,
          reason: REASON,
        });
        expect((await support.members.list({ limit: 10 })).items).toHaveLength(
          2,
        );
        await expect(
          support.members.changeRole(alpha.membershipShared, alpha.roleAdmin),
        ).rejects.toThrow(ActorNotAllowedError);
        const worker = systemScope(prisma, {
          tenantId: alpha.tenant,
          name: 'test_worker',
        });
        await expect(worker.members.list({})).rejects.toThrow(
          ActorNotAllowedError,
        );
      });
    });

    describe('invitations', () => {
      async function invite(label: string) {
        const workspace = await workspaceOf(label);
        const roles = await workspace.admin.members.roles();
        const memberRole = roles.find((r) => r.key === 'client_member');
        if (memberRole === undefined) {
          throw new Error('role missing');
        }
        const invitee = await verifiedUser(`${label}-invitee`);
        const token = `token-${randomUUID()}`;
        const invitation = await workspace.admin.invitations.create({
          email: invitee.email.toUpperCase(),
          roleId: memberRole.id,
          tokenHash: sha(token),
          expiresAt: WEEK,
        });
        return { ...workspace, memberRole, invitee, token, invitation };
      }

      it('lets only the invited, signed-in address accept, once, into the intended workspace', async () => {
        const { tenantId, invitee, token, invitation } = await invite('accept');
        const stranger = await verifiedUser('stranger');
        await expect(
          previewInvitation(
            prisma,
            { tokenHash: sha(token), userId: stranger.id },
            NOW,
          ),
        ).rejects.toMatchObject({ reason: 'identity_mismatch' });
        expect(
          await previewInvitation(
            prisma,
            { tokenHash: sha(token), userId: invitee.id },
            NOW,
          ),
        ).toMatchObject({
          workspace: { id: tenantId },
          role: { key: 'client_member' },
          expiresAt: WEEK,
        });
        await expect(
          acceptInvitation(
            prisma,
            {
              tokenHash: sha(token),
              workspaceId: tenantId,
              userId: stranger.id,
            },
            NOW,
          ),
        ).rejects.toMatchObject({ reason: 'identity_mismatch' });
        await expect(
          acceptInvitation(
            prisma,
            {
              tokenHash: sha(token),
              workspaceId: alpha.tenant,
              userId: invitee.id,
            },
            NOW,
          ),
        ).rejects.toMatchObject({ reason: 'workspace_mismatch' });
        const accepted = await acceptInvitation(
          prisma,
          { tokenHash: sha(token), workspaceId: tenantId, userId: invitee.id },
          NOW,
        );
        const scope = await memberScope(prisma, {
          tenantId,
          userId: invitee.id,
        });
        expect(scope.actor).toMatchObject({
          kind: 'member',
          membershipId: accepted.membershipId,
        });
        expect(
          scope.actor.kind === 'member' &&
            scope.actor.permissions.has('members.manage'),
        ).toBe(false);
        await expect(
          acceptInvitation(
            prisma,
            {
              tokenHash: sha(token),
              workspaceId: tenantId,
              userId: invitee.id,
            },
            NOW,
          ),
        ).rejects.toMatchObject({ reason: 'invalid' });
        const row = await prisma.invitation.findUniqueOrThrow({
          where: { tenantId_id: { tenantId, id: invitation.id } },
        });
        expect(row).toMatchObject({
          acceptedAt: NOW,
          acceptedMembershipId: accepted.membershipId,
        });
        expect(
          await prisma.auditRecord.count({
            where: {
              tenantId,
              action: 'invitation.accepted',
              actorUserId: invitee.id,
            },
          }),
        ).toBe(1);
      });

      it('refuses expired, revoked, replaced and unknown invitations alike', async () => {
        const { tenantId, admin, memberRole, invitee, token, invitation } =
          await invite('refuse');
        const expect400 = (tokenHash: string, now = NOW) =>
          expect(
            acceptInvitation(
              prisma,
              { tokenHash, workspaceId: tenantId, userId: invitee.id },
              now,
            ),
          ).rejects.toMatchObject({ reason: 'invalid' });
        await expect400(sha(token), WEEK);
        await expect400(sha('never issued'));
        // Inviting again replaces the open invitation: the first link stops working.
        const second = `token-${randomUUID()}`;
        await admin.invitations.create({
          email: invitee.email,
          roleId: memberRole.id,
          tokenHash: sha(second),
          expiresAt: WEEK,
        });
        await expect400(sha(token));
        const open = await admin.invitations.listOpen({});
        expect(open.items.map((i) => i.id)).not.toContain(invitation.id);
        expect(open.items).toHaveLength(1);
        await admin.invitations.revoke(open.items[0]?.id ?? '');
        await expect400(sha(second));
        await expect(
          admin.invitations.revoke(open.items[0]?.id ?? ''),
        ).rejects.toThrow(RecordNotFoundError);
      });

      it('refuses to invite an active member and reactivates a suspended one with the new role', async () => {
        const { tenantId, admin, memberRole, invitee, token } =
          await invite('rejoin');
        await acceptInvitation(
          prisma,
          { tokenHash: sha(token), workspaceId: tenantId, userId: invitee.id },
          NOW,
        );
        await expect(
          admin.invitations.create({
            email: invitee.email,
            roleId: memberRole.id,
            tokenHash: sha(`again-${token}`),
            expiresAt: WEEK,
          }),
        ).rejects.toThrow(AlreadyMemberError);
        await prisma.membership.update({
          where: { tenantId_userId: { tenantId, userId: invitee.id } },
          data: { status: 'SUSPENDED' },
        });
        const roles = await admin.members.roles();
        const adminRole = roles.find((r) => r.key === 'client_admin');
        const back = `back-${token}`;
        await admin.invitations.create({
          email: invitee.email,
          roleId: adminRole?.id ?? '',
          tokenHash: sha(back),
          expiresAt: WEEK,
        });
        await acceptInvitation(
          prisma,
          { tokenHash: sha(back), workspaceId: tenantId, userId: invitee.id },
          NOW,
        );
        const membership = await prisma.membership.findUniqueOrThrow({
          where: { tenantId_userId: { tenantId, userId: invitee.id } },
          include: { role: true },
        });
        expect([membership.status, membership.role.key]).toEqual([
          'ACTIVE',
          'client_admin',
        ]);
      });

      it('refuses invitations of a suspended workspace', async () => {
        const { tenantId, invitee, token } = await invite('suspended');
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { status: 'SUSPENDED' },
        });
        await expect(
          acceptInvitation(
            prisma,
            {
              tokenHash: sha(token),
              workspaceId: tenantId,
              userId: invitee.id,
            },
            NOW,
          ),
        ).rejects.toThrow(InvitationError);
      });

      it('keeps the binding immutable and enforces the state rules (SQL)', async () => {
        const { tenantId, invitation } = await invite('sql');
        await client.query('BEGIN');
        try {
          for (const [sql, code] of [
            [
              'UPDATE invitations SET normalized_email = $3 WHERE tenant_id = $1 AND id = $2',
              '23000',
            ],
            [
              'UPDATE invitations SET expires_at = $3::timestamptz WHERE tenant_id = $1 AND id = $2',
              '23000',
            ],
            [
              'UPDATE invitations SET accepted_at = now() WHERE tenant_id = $1 AND id = $2 AND $3::text IS NOT NULL',
              '23514',
            ],
            [
              'UPDATE invitations SET revoked_at = created_at, accepted_at = created_at, accepted_membership_id = invited_by_membership_id WHERE tenant_id = $1 AND id = $2 AND $3::text IS NOT NULL',
              '23514',
            ],
          ] as const) {
            await client.query('SAVEPOINT s');
            const params = sql.includes('normalized_email')
              ? [tenantId, invitation.id, 'other@example.test']
              : sql.includes('expires_at')
                ? [tenantId, invitation.id, '2030-01-01T00:00:00Z']
                : [tenantId, invitation.id, 'x'];
            await expect(client.query(sql, params)).rejects.toMatchObject({
              code,
            });
            await client.query('ROLLBACK TO SAVEPOINT s');
          }
        } finally {
          await client.query('ROLLBACK');
        }
      });
    });

    describe('platform admin operations', () => {
      it('suspends and reactivates a workspace explicitly, with platform audit records', async () => {
        const { tenantId, owner } = await workspaceOf('lifecycle');
        const console = await platformConsole(prisma, {
          userId: FIXTURE_USERS.platformAdmin.id,
          reason: REASON,
          requestId: 'req-04b-1',
        });
        await console.setTenantStatus({
          tenantId,
          status: 'SUSPENDED',
          reason: 'Payment dispute (test)',
        });
        await expect(
          memberScope(prisma, { tenantId, userId: owner.id }),
        ).rejects.toThrow(TenantAccessDeniedError);
        await console.setTenantStatus({
          tenantId,
          status: 'ACTIVE',
          reason: 'Dispute resolved (test)',
        });
        await memberScope(prisma, { tenantId, userId: owner.id });
        const records = await prisma.platformAuditRecord.findMany({
          where: { subjectTenantId: tenantId, action: 'tenant.status_changed' },
          orderBy: { id: 'asc' },
        });
        expect(records.map((r) => [r.metadata, r.reason, r.requestId])).toEqual(
          [
            [
              { from: 'ACTIVE', to: 'SUSPENDED' },
              'Payment dispute (test)',
              'req-04b-1',
            ],
            [
              { from: 'SUSPENDED', to: 'ACTIVE' },
              'Dispute resolved (test)',
              'req-04b-1',
            ],
          ],
        );
        await expect(
          console.setTenantStatus({
            tenantId,
            status: 'ACTIVE',
            reason: 'short',
          }),
        ).rejects.toThrow(ZodError);
        await expect(
          console.setTenantStatus({
            tenantId: randomUUID(),
            status: 'ACTIVE',
            reason: REASON,
          }),
        ).rejects.toThrow(RecordNotFoundError);
      });
    });

    describe('worker authorization context', () => {
      const sender = defineWorker({
        name: 'outbound_sender',
        taskTypes: ['outbound.send'],
      });
      const other = defineWorker({
        name: 'draft_writer',
        taskTypes: ['draft.generate'],
      });

      async function newTask(tenantId: string, taskType = 'outbound.send') {
        const scope = systemScope(prisma, { tenantId, name: 'scheduler' });
        return enqueueJob(scope, {
          taskType,
          idempotencyKey: `test:${randomUUID()}`,
          payload: { outboundIntentId: alpha.intent },
        });
      }

      it('takes the tenant from the task row and claims it once', async () => {
        const envelope = await newTask(beta.tenant);
        expect(Object.keys(envelope).sort()).toEqual(['taskId', 'v']);
        const context = await claimJob(prisma, sender, envelope);
        expect(context.tenantId).toBe(beta.tenant);
        expect(context.task).toMatchObject({
          status: 'RUNNING',
          attemptCount: 1,
        });
        expect(context.scope.actor).toEqual({
          kind: 'system',
          name: 'outbound_sender',
        });
        // The payload names an Alpha record: in Beta's scope it does not exist.
        await expect(
          context.scope.db.outboundIntent.findFirst({
            where: { id: alpha.intent },
          }),
        ).resolves.toBeNull();
        await expect(claimJob(prisma, sender, envelope)).rejects.toMatchObject({
          reason: 'not_claimable',
        });
        await context.complete();
        expect(
          await prisma.jobTask.findUniqueOrThrow({
            where: { id: envelope.taskId },
            select: { status: true },
          }),
        ).toEqual({ status: 'SUCCEEDED' });
      });

      it.each([
        [
          'a message that names a tenant',
          (taskId: string) => ({ v: 1, taskId, tenantId: alpha.tenant }),
          'malformed',
        ],
        [
          'a message without a version',
          (taskId: string) => ({ taskId }),
          'malformed',
        ],
        [
          'an unknown task',
          () => ({ v: 1, taskId: randomUUID() }),
          'unknown_task',
        ],
      ])('rejects %s', async (_name, message, reason) => {
        const envelope = await newTask(beta.tenant);
        await expect(
          claimJob(prisma, sender, message(envelope.taskId)),
        ).rejects.toMatchObject({ reason });
      });

      it('refuses tasks of another type and of inactive workspaces', async () => {
        const envelope = await newTask(beta.tenant);
        await expect(claimJob(prisma, other, envelope)).rejects.toMatchObject({
          reason: 'wrong_worker',
        });
        const { tenantId } = await workspaceOf('inactive');
        const parked = await newTask(tenantId);
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { status: 'SUSPENDED' },
        });
        await expect(claimJob(prisma, sender, parked)).rejects.toThrow(
          JobRejectedError,
        );
        await expect(claimJob(prisma, sender, parked)).rejects.toMatchObject({
          reason: 'workspace_inactive',
        });
      });

      it('retries while attempts remain, then fails', async () => {
        const scope = systemScope(prisma, {
          tenantId: beta.tenant,
          name: 'scheduler',
        });
        const envelope = await enqueueJob(scope, {
          taskType: 'outbound.send',
          idempotencyKey: `retry:${randomUUID()}`,
          payload: {},
          maxAttempts: 2,
        });
        const first = await claimJob(prisma, sender, envelope);
        await first.fail({
          errorCode: 'provider_unavailable',
          retryAt: new Date(Date.now() - 1000),
        });
        const second = await claimJob(prisma, sender, envelope);
        expect(second.task.attemptCount).toBe(2);
        await second.fail({
          errorCode: 'provider_unavailable',
          retryAt: new Date(Date.now() - 1000),
        });
        expect(
          await prisma.jobTask.findUniqueOrThrow({
            where: { id: envelope.taskId },
            select: { status: true, lastErrorCode: true },
          }),
        ).toEqual({ status: 'FAILED', lastErrorCode: 'provider_unavailable' });
        await expect(claimJob(prisma, sender, envelope)).rejects.toMatchObject({
          reason: 'not_claimable',
        });
      });

      it('refuses to enqueue from a read-only platform-admin scope', async () => {
        const support = await platformAdminScope(prisma, {
          tenantId: alpha.tenant,
          userId: FIXTURE_USERS.platformAdmin.id,
          reason: REASON,
        });
        await expect(
          enqueueJob(support, {
            taskType: 'outbound.send',
            idempotencyKey: 'x',
            payload: {},
          }),
        ).rejects.toThrow(ActorNotAllowedError);
      });
    });

    describe('migration of INVITED memberships', () => {
      it('turns them into SUSPENDED memberships before the status is removed', async () => {
        const old = new MigratedSchema('t04bmig');
        await old.create({
          through: '20261101000700_user_authentication_checks',
        });
        const sql = await old.connect();
        try {
          const tenant = randomUUID();
          const user = randomUUID();
          const role = randomUUID();
          await sql.query(
            `INSERT INTO tenants (id, slug, name, updated_at) VALUES ($1, 'old-tenant', 'Old', now())`,
            [tenant],
          );
          await sql.query(
            `INSERT INTO users (id, email, normalized_email, updated_at) VALUES ($1, 'old@example.test', 'old@example.test', now())`,
            [user],
          );
          await sql.query(
            `INSERT INTO roles (tenant_id, id, key, name, updated_at) VALUES ($1, $2, 'client_member', 'Member', now())`,
            [tenant, role],
          );
          await sql.query(
            `INSERT INTO memberships (tenant_id, id, user_id, role_id, status, updated_at) VALUES ($1, $2, $3, $4, 'INVITED', now())`,
            [tenant, randomUUID(), user, role],
          );
          await old.migrate();
          const rows = await sql.query<{ status: string }>(
            'SELECT status::text FROM memberships',
          );
          expect(rows.rows).toEqual([{ status: 'SUSPENDED' }]);
        } finally {
          await sql.end();
          await old.drop();
        }
      });
    });
  },
);

import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  ACCESS_REASON_HEADER,
  AUTH_ROUTES,
  invitationPageSchema,
  invitationPreviewSchema,
  invitationSchema,
  memberPageSchema,
  platformWorkspaceDetailSchema,
  platformWorkspacePageSchema,
  roleListResponseSchema,
  sessionResponseSchema,
  userWorkspaceSchema,
  WORKSPACE_ROUTES as R,
  workspaceListResponseSchema,
  workspaceSchema,
  type UserWorkspace,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  advance,
  call,
  captured,
  expectError,
  expectNoSecretsLogged,
  lastMail,
  signedInUser,
  signIn,
  startApi,
  type Harness,
  type Session,
} from '../testing/api-harness.js';

// Workspaces, team management, invitations and platform-admin routes end to end (task 04B):
// real Nest app, real PostgreSQL (its own schema), fake mail, controllable clock. Runs only
// when TEST_DATABASE_URL is set; otherwise it is reported as skipped, never as passed.
const db = new MigratedSchema('tws');
const REASON = 'Support request FIX-0100: review the workspace';

describe.runIf(testDatabaseUrl !== undefined)(
  'workspace routes on PostgreSQL',
  () => {
    let api: Harness;

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
    }, 60_000);

    afterAll(async () => {
      await api.app.close();
      await db.drop();
      expectNoSecretsLogged();
    }, 60_000);

    async function newWorkspace(owner: Session, name = 'Acme Sales') {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json);
    }

    async function roleIds(session: Session, workspaceId: string) {
      const roles = roleListResponseSchema.parse(
        (await call(api, R.roles(workspaceId), { session })).json,
      ).items;
      const id = (key: string) => roles.find((r) => r.key === key)?.id ?? '';
      return { admin: id('client_admin'), member: id('client_member') };
    }

    /** Invites `invitee` into the workspace and returns the token from the email. */
    async function invite(
      admin: Session,
      workspaceId: string,
      invitee: string,
      roleId: string,
    ) {
      const result = await call(api, R.invitations(workspaceId), {
        body: { email: invitee, roleId },
        session: admin,
      });
      expect(result.status, result.text).toBe(201);
      const invitation = invitationSchema.parse(result.json);
      const { token } = lastMail(api, invitee, 'workspace.invitation');
      expect(result.text).not.toContain(token);
      return { invitation, token: token ?? '' };
    }

    /** A workspace with an admin and an accepted member. */
    async function team(label: string) {
      const admin = await signedInUser(api, `${label}-admin`);
      const created = await newWorkspace(admin, `${label} team`);
      const workspaceId = created.workspace.id;
      const roles = await roleIds(admin, workspaceId);
      const member = await signedInUser(api, `${label}-member`);
      const { token } = await invite(
        admin,
        workspaceId,
        member.email,
        roles.member,
      );
      expect(
        (
          await call(api, R.acceptInvitation, {
            body: { token, workspaceId },
            session: member,
          })
        ).status,
      ).toBe(200);
      return { admin, member, workspaceId, roles, created };
    }

    describe('workspaces', () => {
      it('creates a workspace for the signed-in user, as its Client Admin', async () => {
        const owner = await signedInUser(api, 'owner');
        const created = await newWorkspace(owner, 'Ünïcode & Co.');
        expect(created.workspace.slug).toMatch(/^unicode-co-[0-9a-f]{6}$/);
        expect(created.membership.role.key).toBe('client_admin');
        expect(created.membership.permissions).toContain('members.manage');
        const list = workspaceListResponseSchema.parse(
          (await call(api, R.workspaces, { session: owner })).json,
        );
        expect(list.items.map((i) => i.workspace.id)).toEqual([
          created.workspace.id,
        ]);
        const one = await call(api, R.workspace(created.workspace.id), {
          session: owner,
        });
        expect(userWorkspaceSchema.parse(one.json)).toEqual(created);
        expectError(
          await call(api, R.workspaces, {
            body: { name: 'Second', slug: created.workspace.slug },
            session: owner,
          }),
          409,
          'slug_taken',
        );
      });

      it('needs a session, the CSRF token and the app origin', async () => {
        const owner = await signedInUser(api, 'csrf');
        expectError(await call(api, R.workspaces), 401, 'unauthenticated');
        expectError(
          await call(api, R.workspaces, {
            body: { name: 'X' },
            session: owner,
            withoutCsrf: true,
          }),
          403,
          'csrf_failed',
        );
        expectError(
          await call(api, R.workspaces, {
            body: { name: 'X' },
            session: owner,
            browser: { origin: 'https://evil.test' },
          }),
          403,
          'forbidden_origin',
        );
        expectError(
          await call(api, R.workspaces, {
            body: { name: '', slug: 'Bad Slug' },
            session: owner,
          }),
          400,
          'validation_failed',
        );
      });
    });

    describe('invitations', () => {
      it('emails a link that only the invited account can preview and accept, once', async () => {
        const admin = await signedInUser(api, 'inviter');
        const { workspace } = await newWorkspace(admin);
        const roles = await roleIds(admin, workspace.id);
        const invitee = await signedInUser(api, 'invitee');
        const stranger = await signedInUser(api, 'stranger');
        const { invitation, token } = await invite(
          admin,
          workspace.id,
          invitee.email,
          roles.member,
        );
        const listed = invitationPageSchema.parse(
          (await call(api, R.invitations(workspace.id), { session: admin }))
            .json,
        );
        expect(listed.items.map((i) => i.id)).toEqual([invitation.id]);
        // Another signed-in account learns nothing about the workspace.
        const foreign = expectError(
          await call(api, R.previewInvitation, {
            body: { token },
            session: stranger,
          }),
          403,
          'invitation_for_another_account',
        );
        expect(JSON.stringify(foreign)).not.toContain(workspace.name);
        expectError(
          await call(api, R.acceptInvitation, {
            body: { token, workspaceId: workspace.id },
            session: stranger,
          }),
          403,
          'invitation_for_another_account',
        );
        const preview = invitationPreviewSchema.parse(
          (
            await call(api, R.previewInvitation, {
              body: { token },
              session: invitee,
            })
          ).json,
        );
        expect(preview).toMatchObject({
          workspace: { id: workspace.id, name: workspace.name },
          role: { key: 'client_member' },
        });
        const otherWorkspace = await newWorkspace(admin, 'Elsewhere');
        expectError(
          await call(api, R.acceptInvitation, {
            body: { token, workspaceId: otherWorkspace.workspace.id },
            session: invitee,
          }),
          400,
          'invitation_for_another_workspace',
        );
        const joined = await call(api, R.acceptInvitation, {
          body: { token, workspaceId: workspace.id },
          session: invitee,
        });
        expect(joined.status, joined.text).toBe(200);
        expect(userWorkspaceSchema.parse(joined.json).membership.role.key).toBe(
          'client_member',
        );
        expectError(
          await call(api, R.acceptInvitation, {
            body: { token, workspaceId: workspace.id },
            session: invitee,
          }),
          400,
          'invalid_or_expired_invitation',
        );
        expect(
          (await call(api, R.invitations(workspace.id), { session: admin }))
            .json,
        ).toEqual({ items: [], nextCursor: null });
      });

      it('expires invitations after 7 days and lets admins revoke them', async () => {
        let admin = await signedInUser(api, 'expiry');
        const { workspace } = await newWorkspace(admin);
        const roles = await roleIds(admin, workspace.id);
        let invitee = await signedInUser(api, 'late');
        const first = await invite(
          admin,
          workspace.id,
          invitee.email,
          roles.member,
        );
        advance(7 * 24 * 3600 + 1);
        // Sessions expired meanwhile: sign in again.
        admin = await signIn(api, admin.email);
        invitee = await signIn(api, invitee.email);
        expectError(
          await call(api, R.previewInvitation, {
            body: { token: first.token },
            session: invitee,
          }),
          400,
          'invalid_or_expired_invitation',
        );
        const second = await invite(
          admin,
          workspace.id,
          invitee.email,
          roles.member,
        );
        expect(
          (
            await call(api, R.invitation(workspace.id, second.invitation.id), {
              method: 'DELETE',
              session: admin,
            })
          ).status,
        ).toBe(204);
        expectError(
          await call(api, R.acceptInvitation, {
            body: { token: second.token, workspaceId: workspace.id },
            session: invitee,
          }),
          400,
          'invalid_or_expired_invitation',
        );
      });

      it('refuses to invite an active member', async () => {
        const { admin, member, workspaceId, roles } = await team('dupe');
        expectError(
          await call(api, R.invitations(workspaceId), {
            body: { email: member.email.toUpperCase(), roleId: roles.member },
            session: admin,
          }),
          409,
          'already_member',
        );
      });
    });

    describe('role-based authorization', () => {
      it('lets members read the team but not change it', async () => {
        const { admin, member, workspaceId, roles, created } =
          await team('rbac');
        const page = memberPageSchema.parse(
          (await call(api, R.members(workspaceId), { session: member })).json,
        );
        expect(page.items.map((m) => m.role.key).sort()).toEqual([
          'client_admin',
          'client_member',
        ]);
        expectError(
          await call(api, R.member(workspaceId, created.membership.id), {
            method: 'PATCH',
            body: { roleId: roles.member },
            session: member,
          }),
          403,
          'forbidden',
        );
        expectError(
          await call(api, R.invitations(workspaceId), {
            body: { email: 'someone@example.test', roleId: roles.member },
            session: member,
          }),
          403,
          'forbidden',
        );
        const memberId =
          page.items.find((m) => m.user.id === member.userId)?.id ?? '';
        const promoted = await call(api, R.member(workspaceId, memberId), {
          method: 'PATCH',
          body: { roleId: roles.admin },
          session: admin,
        });
        expect(promoted.status, promoted.text).toBe(200);
        // The member now has the admin's permissions, on the next request.
        expect(
          (
            await call(api, R.invitations(workspaceId), {
              body: { email: 'someone@example.test', roleId: roles.member },
              session: member,
            })
          ).status,
        ).toBe(201);
      });

      it('keeps the last Client Admin', async () => {
        const admin = await signedInUser(api, 'solo');
        const { workspace, membership } = await newWorkspace(admin);
        const roles = await roleIds(admin, workspace.id);
        expectError(
          await call(api, R.member(workspace.id, membership.id), {
            method: 'PATCH',
            body: { roleId: roles.member },
            session: admin,
          }),
          409,
          'last_admin',
        );
      });

      it("answers 404 for another workspace and for another workspace's record ids", async () => {
        const a = await team('tenant-a');
        const b = await team('tenant-b');
        for (const path of [
          R.workspace(b.workspaceId),
          R.members(b.workspaceId),
          R.roles(b.workspaceId),
        ]) {
          expectError(
            await call(api, path, { session: a.admin }),
            404,
            'not_found',
          );
        }
        expectError(
          await call(api, R.members('not-a-uuid'), { session: a.admin }),
          404,
          'not_found',
        );
        // A's membership id under B's workspace, and B's role id under A's.
        expectError(
          await call(api, R.member(b.workspaceId, a.created.membership.id), {
            method: 'PATCH',
            body: { roleId: b.roles.member },
            session: a.admin,
          }),
          404,
          'not_found',
        );
        expectError(
          await call(api, R.member(a.workspaceId, a.created.membership.id), {
            method: 'PATCH',
            body: { roleId: b.roles.admin },
            session: a.admin,
          }),
          404,
          'not_found',
        );
        const bInvitation = await invite(
          b.admin,
          b.workspaceId,
          'x@example.test',
          b.roles.member,
        );
        expectError(
          await call(
            api,
            R.invitation(a.workspaceId, bInvitation.invitation.id),
            {
              method: 'DELETE',
              session: a.admin,
            },
          ),
          404,
          'not_found',
        );
        expectError(
          await call(api, R.invitations(a.workspaceId), {
            body: { email: 'y@example.test', roleId: b.roles.member },
            session: a.admin,
          }),
          404,
          'not_found',
        );
      });
    });

    describe('platform admin operations', () => {
      async function platformAdmin() {
        const admin = await signedInUser(api, 'platform');
        await api.prisma.user.update({
          where: { id: admin.userId },
          data: { isPlatformAdmin: true },
        });
        return admin;
      }

      it('are refused to everyone else, and the refusal is recorded', async () => {
        const { admin, workspaceId } = await team('not-platform');
        expectError(
          await call(api, R.platformWorkspaces, {
            session: admin,
            headers: { [ACCESS_REASON_HEADER]: REASON },
          }),
          403,
          'forbidden',
        );
        expectError(
          await call(api, R.platformWorkspaceAccess(workspaceId), {
            body: { reason: REASON },
            session: admin,
          }),
          403,
          'forbidden',
        );
        expect(
          await api.prisma.platformAuditRecord.count({
            where: {
              action: 'platform_admin.access_denied',
              targetId: admin.userId,
            },
          }),
        ).toBe(2);
      });

      it('need a reason, grant nothing on member routes, and are audited', async () => {
        const operator = await platformAdmin();
        const { workspaceId, member } = await team('supported');
        // The session says who is a platform admin (navigation, task 05A).
        const flagOf = async (session: typeof operator) =>
          sessionResponseSchema.parse(
            (await call(api, AUTH_ROUTES.session, { session })).json,
          ).user.platformAdmin;
        expect(await flagOf(operator)).toBe(true);
        expect(await flagOf(member)).toBe(false);
        expectError(
          await call(api, R.platformWorkspaces, { session: operator }),
          400,
          'validation_failed',
        );
        const page = platformWorkspacePageSchema.parse(
          (
            await call(api, R.platformWorkspaces, {
              session: operator,
              headers: { [ACCESS_REASON_HEADER]: REASON },
            })
          ).json,
        );
        expect(page.items.map((w) => w.id)).toContain(workspaceId);
        // Being a platform admin is not membership.
        expectError(
          await call(api, R.members(workspaceId), { session: operator }),
          404,
          'not_found',
        );
        const detail = platformWorkspaceDetailSchema.parse(
          (
            await call(api, R.platformWorkspaceAccess(workspaceId), {
              body: { reason: REASON },
              session: operator,
            })
          ).json,
        );
        expect(detail.memberCount).toBe(2);
        expect(
          await api.prisma.auditRecord.count({
            where: {
              tenantId: workspaceId,
              action: 'platform_admin.access_opened',
              actorUserId: operator.userId,
            },
          }),
        ).toBe(1);
        // Suspending the workspace locks its members out; reactivating lets them back in.
        const suspended = await call(
          api,
          R.platformWorkspaceStatus(workspaceId),
          {
            body: {
              status: 'SUSPENDED',
              reason: 'Abuse report FIX-0101 (test)',
            },
            session: operator,
          },
        );
        expect(workspaceSchema.parse(suspended.json).status).toBe('SUSPENDED');
        expectError(
          await call(api, R.members(workspaceId), { session: member }),
          404,
          'not_found',
        );
        expect(
          (
            (await call(api, R.workspaces, { session: member })).json as {
              items: UserWorkspace[];
            }
          ).items,
        ).toEqual([]);
        await call(api, R.platformWorkspaceStatus(workspaceId), {
          body: { status: 'ACTIVE', reason: 'Report reviewed FIX-0101 (test)' },
          session: operator,
        });
        expect(
          (await call(api, R.members(workspaceId), { session: member })).status,
        ).toBe(200);
        const changes = await api.prisma.platformAuditRecord.findMany({
          where: {
            subjectTenantId: workspaceId,
            action: 'tenant.status_changed',
          },
          orderBy: { id: 'asc' },
        });
        expect(changes.map((c) => [c.actorUserId, c.metadata])).toEqual([
          [operator.userId, { from: 'ACTIVE', to: 'SUSPENDED' }],
          [operator.userId, { from: 'SUSPENDED', to: 'ACTIVE' }],
        ]);
        expect(changes.every((c) => typeof c.requestId === 'string')).toBe(
          true,
        );
      });
    });

    it('records the security and membership changes without secrets', async () => {
      const { admin, workspaceId } = await team('audited');
      const records = await api.prisma.auditRecord.findMany({
        where: { tenantId: workspaceId },
        orderBy: { id: 'asc' },
      });
      expect(records.map((r) => r.action)).toEqual([
        'workspace.created',
        'invitation.created',
        'invitation.accepted',
      ]);
      expect(records[0]?.actorUserId).toBe(admin.userId);
      const stored = JSON.stringify(records);
      for (const secret of captured.secrets) {
        expect(stored.includes(secret)).toBe(false);
      }
    });
  },
);

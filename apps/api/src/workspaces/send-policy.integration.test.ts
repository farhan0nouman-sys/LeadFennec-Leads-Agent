import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  invitationSchema,
  roleListResponseSchema,
  SEND_POLICY_ROUTES as S,
  sendPolicyStateSchema,
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

// The send policy over HTTP (task 10B, docs/decisions.md D-10B-*): real Nest app, real PostgreSQL
// (its own schema). Reading and saving need settings.manage; a save names its version (409
// otherwise), is validated (a policy can never allow unnamed countries) and audited; another
// workspace is a 404. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as
// skipped, never as passed.
const db = new MigratedSchema('tsnd');

const POLICY = {
  regions: {
    countries: { US: 'ALLOW', DE: 'REVIEW' },
    otherCountries: 'BLOCK',
  },
  sources: { APOLLO: 'ALLOW', CSV_IMPORT: 'REVIEW' },
};

describe.runIf(testDatabaseUrl !== undefined)(
  'send policy routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let member: Session;
    let outsider: Session;
    let workspaceId: string;

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    const save = (body: unknown, session = admin) =>
      call(api, S.sendPolicy(workspaceId), { method: 'PATCH', body, session });

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'snd-admin');
      member = await signedInUser(api, 'snd-member');
      outsider = await signedInUser(api, 'snd-outsider');
      workspaceId = await newWorkspace(admin, 'Policy team');
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
    }, 120_000);

    afterAll(async () => {
      expectNoSecretsLogged();
      await api.app.close();
      await api.prisma.$disconnect();
      await db.drop();
    });

    it('starts without a policy, saves one with a version check, and audits it', async () => {
      const empty = await call(api, S.sendPolicy(workspaceId), {
        session: admin,
      });
      expect(empty.status, empty.text).toBe(200);
      expect(empty.headers.get('cache-control')).toBe('no-store');
      expect(sendPolicyStateSchema.parse(empty.json)).toEqual({
        version: 0,
        policy: null,
      });
      const saved = await save({ version: 0, policy: POLICY });
      expect(saved.status, saved.text).toBe(200);
      expect(sendPolicyStateSchema.parse(saved.json)).toEqual({
        version: 1,
        policy: POLICY,
      });
      expectError(
        await save({ version: 0, policy: null }),
        409,
        'version_conflict',
      );
      const audit = await api.prisma.auditRecord.findFirst({
        where: { tenantId: workspaceId, action: 'send_policy.updated' },
      });
      expect(audit?.metadata).toEqual({
        version: 1,
        configured: true,
        countries: 2,
        sources: ['APOLLO', 'CSV_IMPORT'],
      });
      const cleared = await save({ version: 1, policy: null });
      expect(sendPolicyStateSchema.parse(cleared.json)).toEqual({
        version: 2,
        policy: null,
      });
    });

    it('refuses a policy that could permit anything it does not name', async () => {
      const refused = (policy: unknown) => save({ version: 2, policy });
      const issues = async (policy: unknown) =>
        expectError(await refused(policy), 400, 'validation_failed').error
          .issues;
      expect(
        await issues({
          ...POLICY,
          regions: { ...POLICY.regions, otherCountries: 'ALLOW' },
        }),
      ).toEqual([
        {
          path: 'policy.regions.otherCountries',
          message: 'Choose REVIEW or BLOCK.',
        },
      ]);
      expect(await issues({ ...POLICY, allowAll: true })).toEqual([
        {
          path: 'policy',
          message: 'Lead Fennec doesn\'t recognize the setting "allowAll".',
        },
      ]);
      expect(
        await issues({
          ...POLICY,
          regions: { ...POLICY.regions, countries: { usa: 'ALLOW' } },
        }),
      ).toEqual([
        {
          path: 'policy.regions.countries.usa',
          message: 'Use two-letter country codes in capitals, such as US.',
        },
      ]);
      // Nothing was saved.
      expect(
        sendPolicyStateSchema.parse(
          (await call(api, S.sendPolicy(workspaceId), { session: admin })).json,
        ).version,
      ).toBe(2);
    });

    it('needs settings.manage, a CSRF token and membership', async () => {
      expectError(
        await call(api, S.sendPolicy(workspaceId), { session: member }),
        403,
        'forbidden',
      );
      expectError(
        await save({ version: 2, policy: POLICY }, member),
        403,
        'forbidden',
      );
      expectError(
        await call(api, S.sendPolicy(workspaceId), {
          method: 'PATCH',
          body: { version: 2, policy: POLICY },
          session: admin,
          withoutCsrf: true,
        }),
        403,
        'csrf_failed',
      );
      expectError(
        await call(api, S.sendPolicy(workspaceId), { session: outsider }),
        404,
        'not_found',
      );
      expectError(
        await call(api, S.sendPolicy(workspaceId), {}),
        401,
        'unauthenticated',
      );
    });
  },
);

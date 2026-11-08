import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  LEAD_PROFILE_ROUTES as P,
  LEAD_ROUTES as L,
  leadDetailSchema,
  leadEvidencePageSchema,
  leadSearchPageSchema,
  invitationSchema,
  roleListResponseSchema,
  userWorkspaceSchema,
  WORKSPACE_ROUTES as R,
  type LeadSearchItem,
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

// Lead search over HTTP (task 11A, docs/decisions.md D-11A-*): real Nest app, real PostgreSQL
// (its own schema). Search, detail and evidence need contacts.read; combined filters and pages
// return each lead once and nothing of another workspace; an unknown sort, filter or value and
// a cursor of another search are 400s; no results is an empty page; another workspace is a 404.
// Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped, never passed.
const db = new MigratedSchema('t11aa');

describe.runIf(testDatabaseUrl !== undefined)(
  'lead search routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let member: Session;
    let outsider: Session;
    let workspaceId: string;
    let otherWorkspaceId: string;
    const ids: Record<string, string> = {};
    let theirs = '';

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    const search = (
      query: Record<string, string>,
      session = admin,
      workspace = workspaceId,
    ) =>
      call(
        api,
        `${L.search(workspace)}?${new URLSearchParams(query).toString()}`,
        {
          session,
        },
      );

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'lds-admin');
      member = await signedInUser(api, 'lds-member');
      outsider = await signedInUser(api, 'lds-outsider');
      workspaceId = await newWorkspace(admin, 'Searching team');
      otherWorkspaceId = await newWorkspace(outsider, 'Other team');
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
      const company = async (tenantId: string, name: string, country: string) =>
        (
          await prisma.organization.create({
            data: {
              tenantId,
              name,
              normalizedDomain: `${name.toLowerCase()}.example`,
              industry: 'software',
              countryCode: country,
            },
          })
        ).id;
      const ours = await company(workspaceId, 'Widgets', 'US');
      const other = await company(otherWorkspaceId, 'Widgets', 'US');
      const names = ['Avery', 'Blake', 'Casey', 'Drew', 'Emery'];
      for (const [i, first] of names.entries()) {
        const email = `${first.toLowerCase()}@widgets.example`;
        const contact = await prisma.contact.create({
          data: {
            tenantId: workspaceId,
            organizationId: ours,
            firstName: first,
            lastName: 'Synthetic',
            title: i % 2 === 0 ? 'VP Sales' : 'Engineer',
            email,
            normalizedEmail: email,
            emailDomain: 'widgets.example',
            createdAt: new Date(Date.UTC(2026, 9, 1, i)),
          },
        });
        ids[first] = contact.id;
      }
      await prisma.evidence.create({
        data: {
          tenantId: workspaceId,
          kind: 'WEBSITE_EXCERPT',
          organizationId: ours,
          excerpt: 'Widgets makes synthetic widgets.',
          sourceUrl: 'https://widgets.example/',
        },
      });
      // The same person in another workspace.
      theirs = (
        await prisma.contact.create({
          data: {
            tenantId: otherWorkspaceId,
            organizationId: other,
            firstName: 'Avery',
            lastName: 'Synthetic',
            title: 'VP Sales',
            email: 'avery@widgets.example',
            normalizedEmail: 'avery@widgets.example',
            emailDomain: 'widgets.example',
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

    it('pages through combined filters, each lead once, none of another workspace', async () => {
      const seen: LeadSearchItem[] = [];
      let cursor: string | null = null;
      do {
        const result = await search(
          {
            company: 'widgets',
            country: 'US',
            sort: 'name',
            order: 'asc',
            limit: '2',
            ...(cursor === null ? {} : { cursor }),
          },
          member,
        );
        expect(result.status, result.text).toBe(200);
        expect(result.headers.get('cache-control')).toBe('no-store');
        const page = leadSearchPageSchema.parse(result.json);
        seen.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(seen.map((item) => item.name)).toEqual([
        'Avery Synthetic',
        'Blake Synthetic',
        'Casey Synthetic',
        'Drew Synthetic',
        'Emery Synthetic',
      ]);
      expect(seen.map((item) => item.id)).not.toContain(theirs);
      const vps = leadSearchPageSchema.parse(
        (await search({ title: 'vp', sort: 'created', order: 'asc' })).json,
      );
      expect(vps.items.map((item) => item.name)).toEqual([
        'Avery Synthetic',
        'Casey Synthetic',
        'Emery Synthetic',
      ]);
      expect(vps.items[0]?.company).toMatchObject({
        name: 'Widgets',
        industry: 'software',
        countryCode: 'US',
      });
    });

    it('answers no results with an empty last page', async () => {
      const result = await search({ q: 'nobody-here' });
      expect(result.status, result.text).toBe(200);
      expect(leadSearchPageSchema.parse(result.json)).toEqual({
        items: [],
        nextCursor: null,
        sort: { field: 'created', order: 'desc' },
      });
    });

    it('refuses unknown sorts, filters and values, and cursors of another search', async () => {
      const sort = expectError(
        await search({ sort: 'email' }),
        400,
        'validation_failed',
      );
      expect(sort.error.issues?.map((issue) => issue.path)).toEqual(['sort']);
      expectError(await search({ sort: 'score' }), 400, 'validation_failed');
      expectError(await search({ orderBy: 'id' }), 400, 'validation_failed');
      expectError(
        await search({ verification: 'maybe' }),
        400,
        'validation_failed',
      );
      expectError(await search({ limit: '500' }), 400, 'validation_failed');
      const first = leadSearchPageSchema.parse(
        (await search({ limit: '1', sort: 'name' })).json,
      );
      const reused = expectError(
        await search({
          limit: '1',
          sort: 'created',
          cursor: first.nextCursor ?? '',
        }),
        400,
        'validation_failed',
      );
      expect(reused.error.issues).toEqual([
        { path: 'cursor', message: 'Start again from the first page.' },
      ]);
      expectError(
        await search({ campaignId: '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10' }),
        404,
        'not_found',
      );
    });

    it("shows one lead and its evidence, and keeps other workspaces' out", async () => {
      const detail = await call(api, L.lead(workspaceId, ids['Avery'] ?? ''), {
        session: member,
      });
      expect(detail.status, detail.text).toBe(200);
      expect(leadDetailSchema.parse(detail.json)).toMatchObject({
        name: 'Avery Synthetic',
        company: { name: 'Widgets' },
        quality: { level: 'review', email: { state: 'unverified' } },
        campaigns: [],
        leadLists: [],
      });
      const evidence = await call(
        api,
        `${L.evidence(workspaceId, ids['Avery'] ?? '')}?limit=10`,
        { session: member },
      );
      expect(evidence.status, evidence.text).toBe(200);
      expect(leadEvidencePageSchema.parse(evidence.json).items).toEqual([
        expect.objectContaining({
          about: 'company',
          kind: 'WEBSITE_EXCERPT',
          excerpt: 'Widgets makes synthetic widgets.',
        }) as unknown,
      ]);
      expectError(
        await call(api, L.lead(workspaceId, theirs), { session: admin }),
        404,
        'not_found',
      );
      expectError(
        await call(api, L.evidence(workspaceId, theirs), { session: admin }),
        404,
        'not_found',
      );
      expectError(await search({}, outsider), 404, 'not_found');
      expectError(await search({}, admin, otherWorkspaceId), 404, 'not_found');
    });
    it('corrects, tags, notes and assigns a lead with version checks, and fails safely (task 11B)', async () => {
      const lead = ids['Blake'] ?? '';
      const detail = leadDetailSchema.parse(
        (await call(api, L.lead(workspaceId, lead), { session: admin })).json,
      );
      expect(detail.version).toBe(1);
      const corrected = await call(api, P.lead(workspaceId, lead), {
        method: 'PATCH',
        body: {
          version: 1,
          changes: { title: 'Head of Sales', countryCode: 'de' },
          reason: 'Confirmed on a call (synthetic).',
        },
        session: member,
      });
      expect(corrected.status, corrected.text).toBe(200);
      expect(leadDetailSchema.parse(corrected.json)).toMatchObject({
        version: 2,
        title: 'Head of Sales',
        countryCode: 'DE',
        notes: [
          expect.objectContaining({
            body: 'Corrected title, country: Confirmed on a call (synthetic).',
          }) as unknown,
        ],
      });
      // A stale edit, another lead's address, no reason, no CSRF token.
      expectError(
        await call(api, P.lead(workspaceId, lead), {
          method: 'PATCH',
          body: { version: 1, changes: { title: 'CEO' }, reason: 'stale' },
          session: member,
        }),
        409,
        'version_conflict',
      );
      expectError(
        await call(api, P.lead(workspaceId, lead), {
          method: 'PATCH',
          body: {
            version: 2,
            changes: { email: 'avery@widgets.example' },
            reason: 'typo',
          },
          session: member,
        }),
        409,
        'email_taken',
      );
      expectError(
        await call(api, P.lead(workspaceId, lead), {
          method: 'PATCH',
          body: { version: 2, changes: { title: 'CEO' } },
          session: member,
        }),
        400,
        'validation_failed',
      );
      expectError(
        await call(api, P.lead(workspaceId, lead), {
          method: 'PATCH',
          body: { version: 2, changes: { title: 'CEO' }, reason: 'x' },
          session: member,
          withoutCsrf: true,
        }),
        403,
        'csrf_failed',
      );
      const tagged = await call(api, P.tags(workspaceId, lead), {
        method: 'PATCH',
        body: { version: 2, tags: ['VIP', 'warm'] },
        session: member,
      });
      expect(tagged.status, tagged.text).toBe(200);
      expect(leadDetailSchema.parse(tagged.json)).toMatchObject({
        version: 3,
        tags: ['vip', 'warm'],
      });
      const noted = await call(api, P.notes(workspaceId, lead), {
        body: { body: 'Prefers mornings (synthetic).' },
        session: member,
      });
      expect(noted.status, noted.text).toBe(201);
      // Assignment: another workspace's campaign is refused like a missing one; a campaign
      // without a lead list is refused; the lead's own workspace and version are checked.
      const theirs = await api.prisma.campaign.create({
        data: { tenantId: otherWorkspaceId, name: 'Their campaign' },
      });
      const refused = expectError(
        await call(api, P.campaigns(workspaceId, lead), {
          body: { version: 3, campaignId: theirs.id },
          session: member,
        }),
        409,
        'assignment_not_possible',
      );
      expect(refused.error.issues).toEqual([
        { path: 'campaignId', message: 'Not found in this workspace.' },
      ]);
      const list = await api.prisma.leadList.create({
        data: { tenantId: workspaceId, name: 'Assigned leads' },
      });
      const ours = await api.prisma.campaign.create({
        data: {
          tenantId: workspaceId,
          name: 'Our campaign',
          leadListId: list.id,
        },
      });
      expectError(
        await call(api, P.campaigns(workspaceId, lead), {
          body: { version: 2, campaignId: ours.id },
          session: member,
        }),
        409,
        'version_conflict',
      );
      const assigned = await call(api, P.campaigns(workspaceId, lead), {
        body: { version: 3, campaignId: ours.id },
        session: member,
      });
      expect(assigned.status, assigned.text).toBe(200);
      expect(leadDetailSchema.parse(assigned.json).campaigns).toEqual([
        expect.objectContaining({ id: ours.id, onLeadList: true }) as unknown,
      ]);
      // Another workspace's lead: 404, whatever the change.
      expectError(
        await call(api, P.lead(workspaceId, theirs.id), {
          method: 'PATCH',
          body: { version: 1, changes: { title: 'x' }, reason: 'x' },
          session: admin,
        }),
        404,
        'not_found',
      );
    });
  },
);

import { systemScope } from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  CONTACT_IMPORT_ROUTES as CI,
  EXPORT_ROUTES as E,
  IMPORT_ROUTES as I,
  LEAD_ROUTES as L,
  SUPPRESSION_ROUTES as S,
  addSuppressionResponseSchema,
  deletionResultSchema,
  exportPageSchema,
  exportSchema,
  importResultPageSchema,
  importRunSchema,
  invitationSchema,
  leadDetailSchema,
  roleListResponseSchema,
  suppressionPageSchema,
  userWorkspaceSchema,
  SESSION_COOKIE_NAME,
  WORKSPACE_ROUTES as R,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  captured,
  clock,
  expectError,
  expectNoSecretsLogged,
  lastMail,
  signedInUser,
  startApi,
  type Harness,
  type Session,
} from '../testing/api-harness.js';

// People imports, lead exports, the do-not-contact list and deletion requests over HTTP (task 11C,
// docs/api/exports.md, docs/api/suppressions.md): real Nest app, real PostgreSQL (its own
// schema). A people file is checked in the request (201) and saved by the worker's steps; a 180 KB
// file is accepted; an export is a CSV attachment (no-store, nosniff, a BOM, formulas as text)
// for its maker only, 410 once expired; list entries are added, repeated, removed when a member's
// own and kept otherwise; a lead is suppressed or erased (stale version 409), and gone (404).
// Members without the permissions get 403, other workspaces 404, requests without CSRF 403.
// Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped, never passed.
const db = new MigratedSchema('t11ca');
const BOM = String.fromCharCode(0xfeff);
const MAPPING = {
  firstName: 'First',
  lastName: 'Last',
  email: 'Email',
  company: 'Company',
  companyDomain: 'Domain',
};

describe.runIf(testDatabaseUrl !== undefined)(
  'imports, exports and privacy routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let member: Session;
    let outsider: Session;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let leadA = '';
    let otherList = '';

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    /** A download as the browser makes it: the session cookie, no JSON. */
    async function download(path: string, session: Session) {
      const response = await fetch(`${api.baseUrl}${path}`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
      });
      // The raw bytes: decoding text would drop a byte-order mark.
      const bytes = Buffer.from(await response.arrayBuffer());
      return { response, bytes, text: bytes.toString('utf8') };
    }

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'prv-admin');
      member = await signedInUser(api, 'prv-member');
      outsider = await signedInUser(api, 'prv-outsider');
      workspaceId = await newWorkspace(admin, 'Privacy team');
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
      expect(
        (
          await call(api, R.acceptInvitation, {
            body: { token, workspaceId },
            session: member,
          })
        ).status,
      ).toBe(200);
      const prisma = api.prisma;
      const org = await prisma.organization.create({
        data: {
          tenantId: workspaceId,
          name: 'Acme',
          normalizedDomain: 'acme.example',
        },
      });
      for (const [first, email] of [
        ['=cmd|calc', 'a@acme.example'],
        ['Blake', 'b@acme.example'],
      ] as const) {
        const contact = await prisma.contact.create({
          data: {
            tenantId: workspaceId,
            organizationId: org.id,
            firstName: first,
            lastName: 'Lead',
            email,
            normalizedEmail: email,
            emailDomain: 'acme.example',
          },
        });
        if (email.startsWith('a@')) {
          leadA = contact.id;
        }
      }
      otherList = (
        await prisma.leadList.create({
          data: { tenantId: otherWorkspaceId, name: 'Theirs' },
        })
      ).id;
    }, 120_000);

    afterAll(async () => {
      expectNoSecretsLogged();
      await api.app.close();
      await api.prisma.$disconnect();
      await db.drop();
    });

    it('imports people: every row checked in the request, the rest saved by the worker', async () => {
      const file = [
        'First,Last,Email,Company,Domain,Notes',
        'Nora,Field,nora@field.example,Field Co,field.example,private',
        'Bad,Row,not-an-address,Bad Co,bad.example,private',
        'Blake,Lead,b@acme.example,Acme,acme.example,private',
      ].join('\n');
      const created = await call(api, CI.contacts(workspaceId), {
        body: { fileName: 'people.csv', content: file, mapping: MAPPING },
        session: admin,
      });
      expect(created.status, created.text).toBe(201);
      const run = importRunSchema.parse(created.json);
      expect(run).toMatchObject({
        source: 'CONTACT_CSV',
        status: 'PENDING',
        counts: { found: 3, failed: 1 },
        contactImport: { rows: 3, processed: 1, leadListId: null },
      });
      // The worker's steps (the API never runs them).
      const worker = systemScope(api.prisma, {
        tenantId: workspaceId,
        name: 'contact_import',
      }).contactImports;
      await worker.begin(run.id);
      expect(await worker.saveBatch(run.id)).toEqual({ state: 'done' });
      await worker.finish(run.id);
      const results = importResultPageSchema.parse(
        (await call(api, I.results(workspaceId, run.id), { session: admin }))
          .json,
      );
      expect(
        results.items.map((r) => [r.kind, r.outcome, r.name, r.email]),
      ).toEqual([
        ['person', 'CREATED', 'Nora Field', 'nora@field.example'],
        ['person', 'FAILED', 'Bad Row', 'not-an-address'],
        ['person', 'MATCHED', 'Blake Lead', 'b@acme.example'],
      ]);
      expect(results.items[0]?.contactId).not.toBeNull();
      expect(created.text).not.toContain('private');

      // A large file (180 KB) is accepted; the API's body limit is 1 MB.
      const big = [
        'First,Last,Email,Company,Domain,Notes',
        ...Array.from(
          { length: 900 },
          (_, i) =>
            `Person${String(i)},Bulk,p${String(i)}@bulk.example,Bulk Co,bulk.example,${'x'.repeat(150)}`,
        ),
      ].join('\n');
      expect(big.length).toBeGreaterThan(150_000);
      const large = await call(api, CI.contacts(workspaceId), {
        body: { fileName: 'big.csv', content: big, mapping: MAPPING },
        session: member,
      });
      expect(large.status, large.text).toBe(201);
      expect(importRunSchema.parse(large.json).counts.found).toBe(900);

      // Another workspace's lead list; a strict body; no CSRF; another workspace.
      const theirs = expectError(
        await call(api, CI.contacts(workspaceId), {
          body: {
            fileName: 'x.csv',
            content: file,
            mapping: MAPPING,
            leadListId: otherList,
          },
          session: admin,
        }),
        400,
        'validation_failed',
      );
      expect(theirs.error.issues).toEqual([
        { path: 'leadListId', message: 'Not found in this workspace.' },
      ]);
      expectError(
        await call(api, CI.contacts(workspaceId), {
          body: {
            fileName: 'x.csv',
            content: file,
            mapping: MAPPING,
            extra: 1,
          },
          session: admin,
        }),
        400,
        'validation_failed',
      );
      expectError(
        await call(api, CI.contacts(workspaceId), {
          body: { fileName: 'x.csv', content: file, mapping: MAPPING },
          session: admin,
          withoutCsrf: true,
        }),
        403,
        'csrf_failed',
      );
      expectError(
        await call(api, CI.contacts(workspaceId), {
          body: { fileName: 'x.csv', content: file, mapping: MAPPING },
          session: outsider,
        }),
        404,
        'not_found',
      );
    });

    it('exports leads as a spreadsheet-safe attachment for their maker, until it expires', async () => {
      const made = await call(api, E.exports(workspaceId), {
        body: { filters: { sort: 'name', order: 'asc' } },
        session: admin,
      });
      expect(made.status, made.text).toBe(201);
      const file = exportSchema.parse(made.json);
      expect(file).toMatchObject({ status: 'READY', truncated: false });
      const listed = exportPageSchema.parse(
        (await call(api, E.exports(workspaceId), { session: admin })).json,
      );
      expect(listed.items.map((item) => item.id)).toContain(file.id);

      const { response, text, bytes } = await download(
        E.download(workspaceId, file.id),
        admin,
      );
      // UTF-8's byte-order mark, so spreadsheets read the file as UTF-8.
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/csv; charset=utf-8',
      );
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${file.fileName}"`,
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(text.startsWith(BOM)).toBe(true);
      expect(text).toContain(`'=cmd|calc Lead`);
      expect(text).not.toContain('Other team');

      // The member lacks contacts.export; the outsider isn't a member.
      expectError(
        await call(api, E.exports(workspaceId), {
          body: { filters: {} },
          session: member,
        }),
        403,
        'forbidden',
      );
      expectError(
        await call(api, E.exports(workspaceId), { session: member }),
        403,
        'forbidden',
      );
      expect(
        (await download(E.download(workspaceId, file.id), member)).response
          .status,
      ).toBe(403);
      expect(
        (await download(E.download(workspaceId, file.id), outsider)).response
          .status,
      ).toBe(404);
      expect(
        (await download(E.download(otherWorkspaceId, file.id), outsider))
          .response.status,
      ).toBe(404);
      expectError(
        await call(api, E.exports(workspaceId), {
          body: { filters: { cursor: 'abc' } },
          session: admin,
        }),
        400,
        'validation_failed',
      );

      // A file past its time: 410, and its content is deleted.
      const membership = await api.prisma.membership.findFirstOrThrow({
        where: { tenantId: workspaceId, userId: admin.userId },
      });
      const old = await api.prisma.export.create({
        data: {
          tenantId: workspaceId,
          kind: 'LEADS',
          requestedByMembershipId: membership.id,
          fileName: 'leads-202611010000.csv',
          filters: {},
          rowCount: 0,
          truncated: false,
          byteSize: 4,
          contentSha256: '0'.repeat(64),
          content: 'a,b\n',
          // The API runs on the harness clock.
          createdAt: new Date(clock.now.getTime() - 48 * 3_600_000),
          expiresAt: new Date(clock.now.getTime() - 24 * 3_600_000),
        },
      });
      const expired = await download(E.download(workspaceId, old.id), admin);
      expect(expired.response.status, expired.text).toBe(410);
      expect(JSON.parse(expired.text)).toMatchObject({
        error: { code: 'export_expired' },
      });
      expect(
        await api.prisma.export.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: workspaceId, id: old.id } },
        }),
      ).toMatchObject({ status: 'EXPIRED', content: null });
    });

    it('manages the do-not-contact list, and suppresses or erases a lead', async () => {
      const added = await call(api, S.suppressions(workspaceId), {
        body: { kind: 'email', value: 'B@Acme.example', reason: 'OPT_OUT' },
        session: admin,
      });
      expect(added.status, added.text).toBe(200);
      expect(addSuppressionResponseSchema.parse(added.json)).toMatchObject({
        created: true,
        reopenedLeads: 1,
        suppression: { value: 'b@acme.example', removable: false },
      });
      const again = addSuppressionResponseSchema.parse(
        (
          await call(api, S.suppressions(workspaceId), {
            body: { kind: 'email', value: 'b@acme.example' },
            session: admin,
          })
        ).json,
      );
      expect(again.created).toBe(false);
      expectError(
        await call(api, S.suppressions(workspaceId), {
          body: { kind: 'domain', value: 'not a domain' },
          session: admin,
        }),
        400,
        'validation_failed',
      );
      // A person's request stays; a member's own entry can go.
      expectError(
        await call(api, S.suppression(workspaceId, again.suppression.id), {
          method: 'DELETE',
          session: admin,
        }),
        409,
        'suppression_not_removable',
      );
      const domain = addSuppressionResponseSchema.parse(
        (
          await call(api, S.suppressions(workspaceId), {
            body: { kind: 'domain', value: 'rival.example' },
            session: admin,
          })
        ).json,
      );
      const removed = await call(
        api,
        S.suppression(workspaceId, domain.suppression.id),
        { method: 'DELETE', session: admin },
      );
      expect(removed.status, removed.text).toBe(204);
      const list = suppressionPageSchema.parse(
        (
          await call(api, `${S.suppressions(workspaceId)}?kind=email`, {
            session: admin,
          })
        ).json,
      );
      expect(list.items.map((s) => s.value)).toEqual(['b@acme.example']);

      // The lead's own address; then a deletion request at a stale, then the current, version.
      const suppressed = await call(api, S.suppressLead(workspaceId, leadA), {
        body: { reason: 'MANUAL' },
        session: admin,
      });
      expect(suppressed.status, suppressed.text).toBe(200);
      const detail = leadDetailSchema.parse(suppressed.json);
      expect(detail.doNotContact).toBe(true);
      expectError(
        await call(api, S.deleteLead(workspaceId, leadA), {
          body: { version: detail.version + 1 },
          session: admin,
        }),
        409,
        'version_conflict',
      );
      const erased = await call(api, S.deleteLead(workspaceId, leadA), {
        body: { version: detail.version },
        session: admin,
      });
      expect(erased.status, erased.text).toBe(200);
      expect(deletionResultSchema.parse(erased.json)).toMatchObject({
        deleted: { contacts: 1 },
      });
      expectError(
        await call(api, L.lead(workspaceId, leadA), { session: admin }),
        404,
        'not_found',
      );
      const byAddress = await call(api, S.deletionRequests(workspaceId), {
        body: { email: 'Gone@Acme.example' },
        session: admin,
      });
      expect(byAddress.status, byAddress.text).toBe(200);
      expect(deletionResultSchema.parse(byAddress.json).deleted).toEqual({
        contacts: 0,
        sourceRecords: 0,
      });

      // Without suppressions.manage: 403; another workspace: 404; no CSRF: 403.
      expectError(
        await call(api, S.suppressions(workspaceId), { session: member }),
        403,
        'forbidden',
      );
      expectError(
        await call(api, S.deletionRequests(workspaceId), {
          body: { email: 'b@acme.example' },
          session: member,
        }),
        403,
        'forbidden',
      );
      expectError(
        await call(api, S.suppressions(workspaceId), { session: outsider }),
        404,
        'not_found',
      );
      expectError(
        await call(api, S.suppressions(workspaceId), {
          body: { kind: 'email', value: 'x@acme.example' },
          session: admin,
          withoutCsrf: true,
        }),
        403,
        'csrf_failed',
      );

      // A search of the list never reaches the logs: request lines leave out the query.
      const searched = await call(
        api,
        `${S.suppressions(workspaceId)}?q=${encodeURIComponent('b@acme')}`,
        { session: admin },
      );
      expect(searched.status, searched.text).toBe(200);
      const logged = JSON.stringify(captured.lines);
      expect(logged).not.toContain('b%40acme');
      expect(logged).not.toContain('b@acme');
    });
  },
);

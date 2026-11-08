import { randomUUID } from 'node:crypto';
import {
  RECHECK_TASK_TYPE,
  systemScope,
  VerificationUnavailableError,
} from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  DISCOVERY_ROUTES as D,
  ENRICHMENT_ROUTES as E,
  QUALIFICATION_ROUTES as Q,
  discoveryAcceptedSchema,
  enrichmentAcceptedSchema,
  enrichmentResultPageSchema,
  importRunSchema,
  invitationSchema,
  leadPageSchema,
  leadQualificationViewSchema,
  normalizeCompanyIdentity,
  parseContactEnrichmentOutput,
  recheckAcceptedSchema,
  roleListResponseSchema,
  userWorkspaceSchema,
  WORKSPACE_ROUTES as R,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toApiException } from '../http/api-errors.js';
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

// Contact enrichment over HTTP (task 08C, docs/decisions.md D-08C-*): real Nest app, real
// PostgreSQL (its own schema). A request (imports.create; contacts.write in the repository) is
// validated and queued with 202; a run's progress is the run view; its people are listed with
// their outcomes and reasons; the lead view shows the contact's quality; a recheck needs
// verifications.run, is limited (429 with Retry-After), refuses a contact without an address and
// fails closed without a verifier (409); another workspace is a 404. The worker's part is played
// by the system scope. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as
// skipped, never as passed.
const db = new MigratedSchema('t08ca');
const DOMAIN = 'acme-people.example';

describe.runIf(testDatabaseUrl !== undefined)(
  'contact enrichment routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let member: Session;
    let outsider: Session;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let sourceRunId: string;
    let campaignId: string;
    let runId: string;
    let adaId: string;
    let noEmailId: string;

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    const enrich = (body: unknown, session = admin, importId = sourceRunId) =>
      call(api, E.request(workspaceId, importId), { body, session });
    const recheck = (contactId: string, session = admin) =>
      call(api, E.recheck(workspaceId, contactId), { body: {}, session });

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'enr-admin');
      member = await signedInUser(api, 'enr-member');
      outsider = await signedInUser(api, 'enr-outsider');
      workspaceId = await newWorkspace(admin, 'Enriching team');
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

      // A finished search that saved one company, and a campaign with a lead list.
      const prisma = api.prisma;
      const icp = await prisma.icp.create({
        data: {
          tenantId: workspaceId,
          name: 'Revenue leaders',
          criteria: { industries: ['software'], titles: ['VP Sales'] },
        },
      });
      const search = await call(api, D.request(workspaceId), {
        body: { icpId: icp.id, maxResults: 10 },
        session: admin,
      });
      expect(search.status, search.text).toBe(202);
      sourceRunId = discoveryAcceptedSchema.parse(search.json).runId;
      const discovery = systemScope(prisma, {
        tenantId: workspaceId,
        name: 'lead_discovery',
      }).discovery;
      await discovery.beginSearch(sourceRunId);
      await discovery.saveSearchPage(sourceRunId, {
        organizations: [
          {
            identity: normalizeCompanyIdentity({
              name: 'Acme',
              domain: DOMAIN,
            }),
            websiteUrl: `https://${DOMAIN}/`,
            industry: 'software',
            employeeCount: 80,
            countryCode: 'US',
            source: {
              provider: 'FAKE',
              externalId: 'org-acme',
              retrievedAt: clock.now,
            },
            raw: { synthetic: true },
          },
        ],
        rejected: [],
        received: 1,
        nextPageToken: null,
      });
      await discovery.finishSearch(sourceRunId);
      const list = await prisma.leadList.create({
        data: { tenantId: workspaceId, name: 'Prospects', icpId: icp.id },
      });
      const campaign = await prisma.campaign.create({
        data: {
          tenantId: workspaceId,
          name: 'Q1 outreach',
          icpId: icp.id,
          leadListId: list.id,
        },
      });
      campaignId = campaign.id;
      const org = await prisma.organization.findFirstOrThrow({
        where: { tenantId: workspaceId, normalizedDomain: DOMAIN },
      });
      const noEmail = await prisma.contact.create({
        data: {
          tenantId: workspaceId,
          organizationId: org.id,
          firstName: 'Nemo',
          lastName: 'Nobody',
        },
      });
      noEmailId = noEmail.id;
    }, 120_000);

    afterAll(async () => {
      expectNoSecretsLogged();
      await api.app.close();
      await api.prisma.$disconnect();
      await db.drop();
    });

    it('queues people search for a finished run, and shows its progress', async () => {
      const result = await enrich(
        { campaignId, maxContactsPerCompany: 2 },
        member,
      );
      expect(result.status, result.text).toBe(202);
      expect(result.headers.get('cache-control')).toBe('no-store');
      const accepted = enrichmentAcceptedSchema.parse(result.json);
      runId = accepted.runId;
      expect(accepted).toEqual({
        runId,
        status: 'PENDING',
        statusUrl: D.run(workspaceId, runId),
      });
      const status = await call(api, accepted.statusUrl, { session: admin });
      expect(status.status, status.text).toBe(200);
      expect(importRunSchema.parse(status.json)).toMatchObject({
        source: 'CONTACT_ENRICHMENT',
        status: 'PENDING',
        search: null,
        enrichment: {
          sourceImportId: sourceRunId,
          campaignId,
          provider: 'FAKE',
          targeting: { titles: ['VP Sales'], seniorities: [], countries: [] },
          maxContactsPerCompany: 2,
          companies: { total: 1, done: 0, skipped: 0, beyondLimit: 0 },
        },
      });
    });

    it('validates requests and keeps other workspaces out', async () => {
      expectError(
        await enrich({ maxContactsPerCompany: 9 }),
        400,
        'validation_failed',
      );
      expectError(await enrich({ titles: ['CEO'] }), 400, 'validation_failed');
      const foreign = expectError(
        await enrich({ campaignId: randomUUID() }),
        400,
        'validation_failed',
      );
      expect(foreign.error.issues).toContainEqual({
        path: 'campaignId',
        message: 'Not found in this workspace.',
      });
      // An enrichment run is not a source of companies.
      expect(
        expectError(await enrich({}, admin, runId), 400, 'validation_failed')
          .error.issues?.[0]?.path,
      ).toBe('importId');
      expectError(await enrich({}, outsider), 404, 'not_found');
      expectError(
        await call(api, E.request(otherWorkspaceId, sourceRunId), {
          body: {},
          session: outsider,
        }),
        404,
        'not_found',
      );
      expectError(
        await call(api, E.contacts(otherWorkspaceId, runId), {
          session: outsider,
        }),
        404,
        'not_found',
      );
    });

    it("lists the run's people and shows their quality in the lead views", async () => {
      // The worker's part: one company, one person saved with a verified address.
      const worker = systemScope(api.prisma, {
        tenantId: workspaceId,
        name: 'contact_enrichment',
      }).enrichment;
      await worker.begin(runId);
      const step = await worker.nextCompany(runId);
      if (step.state !== 'company' || step.organization === null) {
        throw new Error('expected a company');
      }
      const address = `ada.lovelace@${DOMAIN}`;
      const provenance = {
        provider: 'FAKE' as const,
        externalId: 'p-ada',
        retrievedAt: clock.now.toISOString(),
        attribution: 'Synthetic people.',
      };
      const parsed = parseContactEnrichmentOutput(
        {
          contacts: [
            {
              firstName: 'Ada',
              lastName: 'Lovelace',
              title: 'VP Sales',
              seniority: 'vp',
              linkedinUrl: null,
              email: { address, provenance },
              provenance,
            },
          ],
        },
        {
          organization: {
            id: step.organization.id,
            name: step.organization.name,
            domain: DOMAIN,
          },
          targeting: { titles: ['VP Sales'], seniorities: [] },
          maxContacts: 2,
        },
      );
      if (!parsed.ok || parsed.contacts[0] === undefined) {
        throw new Error('not accepted');
      }
      await worker.saveCompany(runId, step.index, {
        kind: 'enriched',
        people: [
          {
            kind: 'accepted',
            contact: parsed.contacts[0],
            received: {
              search: { synthetic: true },
              enrichment: { synthetic: true },
              providerClaim: null,
              emailDropped: null,
            },
            check: {
              kind: 'checked',
              check: {
                address,
                status: 'verified',
                reason: null,
                provider: 'FAKE',
                checkedAt: clock.now.toISOString(),
              },
            },
          },
        ],
        holds: [],
      });
      await worker.finish(runId);

      const people = await call(api, E.contacts(workspaceId, runId), {
        session: member,
      });
      expect(people.status, people.text).toBe(200);
      const page = enrichmentResultPageSchema.parse(people.json);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        kind: 'person',
        outcome: 'CREATED',
        company: { name: 'Acme', domain: DOMAIN },
        person: {
          name: 'Ada Lovelace',
          email: address,
          check: 'verified',
          reused: false,
        },
        issues: [],
      });
      adaId = page.items[0]?.person?.contactId ?? '';

      const lead = await call(api, Q.lead(workspaceId, campaignId, adaId), {
        session: admin,
      });
      expect(lead.status, lead.text).toBe(200);
      expect(
        leadQualificationViewSchema.parse(lead.json).quality,
      ).toMatchObject({
        level: 'good',
        source: { provider: 'FAKE', fresh: true },
        email: { address, state: 'eligible', check: { status: 'verified' } },
        recheck: { pending: false, availableAt: null, lastErrorCode: null },
      });
      const leads = leadPageSchema.parse(
        (await call(api, Q.leads(workspaceId, campaignId), { session: admin }))
          .json,
      );
      expect(leads.items.find((item) => item.id === adaId)?.quality).toEqual({
        level: 'good',
        emailState: 'eligible',
      });
    });

    it('limits rechecks of an address and refuses what it can not check', async () => {
      // Client Team Members don't have verifications.run.
      expectError(await recheck(adaId, member), 403, 'forbidden');
      expectError(await recheck(noEmailId), 409, 'no_email_address');
      expectError(await recheck(randomUUID()), 404, 'not_found');
      const queued = await recheck(adaId);
      expect(queued.status, queued.text).toBe(202);
      expect(recheckAcceptedSchema.parse(queued.json)).toEqual({
        contactId: adaId,
        status: 'queued',
      });
      expect(
        recheckAcceptedSchema.parse((await recheck(adaId)).json).status,
      ).toBe('already_queued');
      await api.prisma.jobTask.updateMany({
        where: { tenantId: workspaceId, taskType: RECHECK_TASK_TYPE },
        data: {
          status: 'SUCCEEDED',
          startedAt: clock.now,
          finishedAt: clock.now,
        },
      });
      const limited = await recheck(adaId);
      const body = expectError(limited, 429, 'too_many_requests');
      expect(body.error.retryAfterSeconds).toBeGreaterThan(80_000);
      expect(Number(limited.headers.get('retry-after'))).toBe(
        body.error.retryAfterSeconds,
      );
      // Without a verification service (staging and production today), a recheck is refused.
      expect(
        toApiException(new VerificationUnavailableError())?.toBody(),
      ).toEqual({
        error: {
          code: 'verification_unavailable',
          message:
            "Email addresses can't be checked yet: no verification service is set up.",
        },
      });
    });
  },
);

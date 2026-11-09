import { randomUUID } from 'node:crypto';
import type { LeadSearchItem, LeadSearchQuery } from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { InvalidCursorError } from './pagination.js';
import {
  memberScope,
  systemScope,
  type TenantScope,
} from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
} from './tenancy/authorization.js';
import {
  assertTenant,
  createLeadSearchRepository,
  TenantLeakError,
} from './tenancy/lead-search.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Lead search (task 11A, docs/decisions.md D-11A-*) on real PostgreSQL: every allowlisted filter
// and sort, alone and combined; keyset pages that return every lead once, in order, even while
// leads are added; no results; refused sorts, values and cursors; LIKE wildcards matched
// literally; permissions per part; lead detail and evidence; the last-activity triggers; and no
// row of another workspace, ever. Runs only when TEST_DATABASE_URL is set; otherwise it is
// reported as skipped.
const db = new MigratedSchema('t11a');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const T = `z${randomUUID().slice(0, 6)}`;
const BASE = new Date('2026-10-01T00:00:00Z');
const at = (hours: number) => new Date(BASE.getTime() + hours * 3_600_000);

describe.runIf(testDatabaseUrl !== undefined)(
  'lead search on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let campaignId: string;
    const people: Record<string, string> = {};
    const orgs: Record<string, string> = {};
    let betaAda = '';

    const admin = (): Promise<TenantScope> =>
      memberScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.alphaAdmin.id,
      });
    const search = async (query: LeadSearchQuery, scope?: TenantScope) =>
      (scope ?? (await admin())).leads.search(query);
    /** Every page, `limit` at a time. */
    async function allPages(query: LeadSearchQuery, limit: number) {
      const scope = await admin();
      const items: LeadSearchItem[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await scope.leads.search({
          ...query,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
        });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        pages += 1;
        expect(pages).toBeLessThan(50);
      } while (cursor !== undefined);
      return items;
    }
    const names = (items: readonly LeadSearchItem[]) =>
      items.map((item) => item.name);

    async function person(
      tenantId: string,
      key: string,
      data: {
        first: string;
        last: string;
        title: string | null;
        org: string | null;
        email: string | null;
        country?: string;
        created: number;
        status?: 'ACTIVE' | 'ARCHIVED';
        source?: 'APOLLO' | 'CSV_IMPORT' | 'MANUAL' | 'FAKE';
      },
    ) {
      const email = data.email;
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          firstName: data.first,
          lastName: data.last,
          title: data.title,
          organizationId: data.org,
          email,
          normalizedEmail: email,
          emailDomain:
            email === null ? null : email.slice(email.indexOf('@') + 1),
          countryCode: data.country ?? null,
          status: data.status ?? 'ACTIVE',
          createdAt: at(data.created),
        },
      });
      if (data.source !== undefined) {
        await prisma.sourceRecord.create({
          data: {
            tenantId,
            provider: data.source,
            contactId: contact.id,
            organizationId: data.org,
            payload: { synthetic: true },
            payloadSha256: 'a'.repeat(64),
            fetchedAt: at(data.created + 1),
          },
        });
      }
      people[key] = contact.id;
      return contact.id;
    }

    const check = (
      key: string,
      status: 'VALID' | 'INVALID' | 'RISKY',
      hours: number,
    ) =>
      prisma.verification.create({
        data: {
          tenantId: alpha.tenant,
          contactId: people[key] ?? '',
          normalizedEmail: `${key.toLowerCase()}@acme-x.example`,
          provider: 'fake',
          status,
          checkedAt: at(hours),
        },
      });

    const score = (
      key: string,
      value: number,
      band: 'HIGH_PRIORITY' | 'REVIEW' | 'LOW_PRIORITY',
      version: number,
      hours: number,
    ) =>
      prisma.score.create({
        data: {
          tenantId: alpha.tenant,
          contactId: people[key] ?? '',
          campaignId,
          campaignVersion: 1,
          version,
          value,
          band,
          reason: 'Synthetic test score.',
          method: 'RULES',
          inputs: { synthetic: true },
          inputSha256: 'b'.repeat(64),
          scoredAt: at(hours),
        },
      });

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      const org = async (
        tenantId: string,
        key: string,
        name: string,
        industry: string,
        country: string | null,
      ) => {
        const row = await prisma.organization.create({
          data: {
            tenantId,
            name: `${name} ${T}`,
            normalizedDomain: `${name.toLowerCase()}-${T}.example`,
            industry,
            countryCode: country,
          },
        });
        orgs[`${tenantId === alpha.tenant ? '' : 'beta-'}${key}`] = row.id;
        return row.id;
      };
      const acme = await org(alpha.tenant, 'acme', 'Acme', 'Software', 'US');
      const globex = await org(
        alpha.tenant,
        'globex',
        'Globex',
        'retail',
        'DE',
      );
      const initech = await org(
        alpha.tenant,
        'initech',
        'Initech',
        'software',
        null,
      );
      const mail = (who: string) => `${who.toLowerCase()}@acme-x.example`;
      // Addresses are synthetic; verifications below use the same shape.
      await person(alpha.tenant, 'Ada', {
        first: 'Ada',
        last: `Lovelace${T}`,
        title: 'VP Sales',
        org: acme,
        email: mail('Ada'),
        created: 1,
        source: 'FAKE',
      });
      await person(alpha.tenant, 'Grace', {
        first: 'Grace',
        last: `Hopper${T}`,
        title: 'Head of Revenue',
        org: acme,
        email: mail('Grace'),
        country: 'GB',
        created: 2,
        source: 'APOLLO',
      });
      await person(alpha.tenant, 'Alan', {
        first: 'Alan',
        last: `Turing${T}`,
        title: 'CTO',
        org: globex,
        email: mail('Alan'),
        created: 3,
        source: 'CSV_IMPORT',
      });
      await person(alpha.tenant, 'Linus', {
        first: 'Linus',
        last: `Torvalds${T}`,
        title: 'Engineer',
        org: globex,
        email: null,
        created: 4,
        source: 'FAKE',
      });
      // Same creation time as Linus: the id breaks the tie.
      await person(alpha.tenant, 'Margaret', {
        first: 'Margaret',
        last: `Hamilton${T}`,
        title: 'VP Engineering',
        org: initech,
        email: mail('Margaret'),
        created: 4,
      });
      await person(alpha.tenant, 'Dennis', {
        first: 'Dennis',
        last: `Ritchie${T}`,
        title: 'Sales Manager',
        org: initech,
        email: mail('Dennis'),
        created: 5,
        status: 'ARCHIVED',
      });
      await person(alpha.tenant, 'Barbara', {
        first: 'Barbara',
        last: `Liskov${T}`,
        title: 'Lead_Gen 100% owner',
        org: null,
        email: null,
        created: 6,
        source: 'MANUAL',
      });
      await person(alpha.tenant, 'Ken', {
        first: 'Ken',
        last: `Thompson${T}`,
        title: 'Lead Gen',
        org: null,
        email: `ken@thompson-${T}-x.example`,
        created: 7,
        source: 'MANUAL',
      });
      // The other workspace has the same company and person: never returned here.
      const betaAcme = await org(beta.tenant, 'acme', 'Acme', 'Software', 'US');
      betaAda = await person(beta.tenant, 'BetaAda', {
        first: 'Ada',
        last: `Lovelace${T}`,
        title: 'VP Sales',
        org: betaAcme,
        email: mail('Ada'),
        created: 1,
        source: 'FAKE',
      });

      const list = await prisma.leadList.create({
        data: { tenantId: alpha.tenant, name: `Leads ${T}` },
      });
      const campaign = await prisma.campaign.create({
        data: {
          tenantId: alpha.tenant,
          name: `Campaign ${T}`,
          leadListId: list.id,
        },
      });
      campaignId = campaign.id;
      await prisma.leadListMember.createMany({
        data: ['Ada', 'Grace', 'Alan', 'Margaret'].map((key) => ({
          tenantId: alpha.tenant,
          leadListId: list.id,
          contactId: people[key] ?? '',
        })),
      });
      // Ken is enrolled in the fixture's running campaign.
      await prisma.campaignLead.create({
        data: {
          tenantId: alpha.tenant,
          campaignId: alpha.campaign,
          sequenceId: alpha.sequence,
          contactId: people['Ken'] ?? '',
          timezone: 'UTC',
          enrolledAt: at(20),
          updatedAt: at(20),
        },
      });
      await check('Ada', 'VALID', 30);
      await check('Grace', 'INVALID', 31);
      await check('Alan', 'RISKY', 32);
      await score('Ada', 90, 'HIGH_PRIORITY', 1, 40);
      await score('Grace', 40, 'LOW_PRIORITY', 1, 41);
      await score('Alan', 70, 'REVIEW', 1, 42);
      await score('Alan', 85, 'HIGH_PRIORITY', 2, 43);
      const decide = (
        key: string,
        state: 'QUALIFIED' | 'REJECTED',
        eligibilityStatus: string,
        hours: number,
      ) =>
        prisma.leadQualification.create({
          data: {
            tenantId: alpha.tenant,
            campaignId,
            contactId: people[key] ?? '',
            version: 1,
            state,
            origin: 'AUTOMATIC',
            eligibilityStatus,
            reasons: [
              {
                code: 'synthetic',
                message: 'Synthetic test decision.',
                details: {},
              },
            ],
            decidedAt: at(hours),
          },
        });
      await decide('Ada', 'QUALIFIED', 'eligible', 50);
      await decide('Grace', 'REJECTED', 'blocked', 51);
      // Evidence: Ada's own, her company's, and another person's at her company.
      await prisma.evidence.createMany({
        data: [
          {
            tenantId: alpha.tenant,
            kind: 'PROVIDER_FIELD',
            contactId: people['Ada'] ?? '',
            organizationId: acme,
            excerpt: 'Title: VP Sales',
            capturedAt: at(60),
          },
          {
            tenantId: alpha.tenant,
            kind: 'WEBSITE_EXCERPT',
            organizationId: acme,
            excerpt: 'Acme builds sales software.',
            sourceUrl: `https://acme-${T}.example/`,
            capturedAt: at(61),
          },
          {
            tenantId: alpha.tenant,
            kind: 'PROVIDER_FIELD',
            contactId: people['Grace'] ?? '',
            organizationId: acme,
            excerpt: 'Title: Head of Revenue',
            capturedAt: at(62),
          },
        ],
      });
    }, 120_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('keeps each lead’s last activity: creation, then each later event, never back', async () => {
      const rows = await prisma.contact.findMany({
        where: { tenantId: alpha.tenant, id: { in: Object.values(people) } },
        select: { id: true, createdAt: true, lastActivityAt: true },
      });
      const of = (key: string) => rows.find((r) => r.id === people[key]);
      // Linus: created, then a source record an hour later.
      expect(of('Linus')?.lastActivityAt).toEqual(at(5));
      // Margaret: nothing after her creation.
      expect(of('Margaret')?.lastActivityAt).toEqual(at(4));
      // Ada: data, check, score, then the qualification at hour 50.
      expect(of('Ada')?.lastActivityAt).toEqual(at(50));
      // Ken: enrolled at hour 20.
      expect(of('Ken')?.lastActivityAt).toEqual(at(20));
      // An older event never moves it back.
      await prisma.sourceRecord.create({
        data: {
          tenantId: alpha.tenant,
          provider: 'MANUAL',
          contactId: people['Ada'] ?? '',
          payload: { synthetic: true },
          payloadSha256: 'c'.repeat(64),
          fetchedAt: at(2),
        },
      });
      expect(
        (
          await prisma.contact.findUniqueOrThrow({
            where: {
              tenantId_id: { tenantId: alpha.tenant, id: people['Ada'] ?? '' },
            },
          })
        ).lastActivityAt,
      ).toEqual(at(50));
    });

    it('pages through every sort, once each, in order, and never into another workspace', async () => {
      const sorts = ['created', 'activity', 'name', 'company'] as const;
      for (const sort of sorts) {
        for (const order of ['asc', 'desc'] as const) {
          const whole = (await search({ q: T, sort, order, limit: 100 })).items;
          const paged = await allPages({ q: T, sort, order }, 2);
          expect(
            paged.map((i) => i.id),
            `${sort} ${order}`,
          ).toEqual(whole.map((i) => i.id));
          expect(new Set(paged.map((i) => i.id)).size).toBe(paged.length);
          // Active people only (Dennis is archived), and none of the other workspace.
          expect(paged).toHaveLength(7);
          expect(paged.map((i) => i.id)).not.toContain(betaAda);
        }
      }
      // Name, A to Z: by last name, then first name.
      expect(
        names(
          (await search({ q: T, sort: 'name', order: 'asc', limit: 100 }))
            .items,
        ),
      ).toEqual([
        `Margaret Hamilton${T}`,
        `Grace Hopper${T}`,
        `Barbara Liskov${T}`,
        `Ada Lovelace${T}`,
        `Ken Thompson${T}`,
        `Linus Torvalds${T}`,
        `Alan Turing${T}`,
      ]);
      // Newest first; Linus and Margaret were created together, so the id decides between them.
      const created = (await search({ q: T, limit: 100 })).items;
      expect(created.slice(0, 2).map((i) => i.name)).toEqual([
        `Ken Thompson${T}`,
        `Barbara Liskov${T}`,
      ]);
      const tied = created.slice(2, 4).map((i) => i.id);
      expect(tied).toEqual([...tied].sort().reverse());
      // Score in a campaign, highest first; unscored people last.
      const byScore = await allPages(
        { campaignId, sort: 'score', order: 'desc' },
        1,
      );
      expect(byScore.map((i) => [i.name, i.score?.value ?? null])).toEqual([
        [`Ada Lovelace${T}`, 90],
        [`Alan Turing${T}`, 85],
        [`Grace Hopper${T}`, 40],
        [`Margaret Hamilton${T}`, null],
      ]);
    });

    it('stays stable while people are added between pages', async () => {
      const scope = await admin();
      const first = await scope.leads.search({ q: T, limit: 3 });
      // A newer and an older person arrive before the next page is asked for.
      await person(alpha.tenant, 'Newer', {
        first: 'Newer',
        last: `Person${T}`,
        title: null,
        org: null,
        email: null,
        created: 100,
      });
      await person(alpha.tenant, 'Older', {
        first: 'Older',
        last: `Person${T}`,
        title: null,
        org: null,
        email: null,
        created: -100,
      });
      const rest = await allPages({ q: T, cursor: first.nextCursor ?? '' }, 3);
      const ids = [...first.items, ...rest].map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      // The newer one sorts before the cursor (not seen); the older one comes last.
      expect(ids).not.toContain(people['Newer']);
      expect(ids.at(-1)).toBe(people['Older']);
      await prisma.contact.updateMany({
        where: {
          tenantId: alpha.tenant,
          id: { in: [people['Newer'] ?? '', people['Older'] ?? ''] },
        },
        data: { status: 'ARCHIVED' },
      });
    });

    it('filters by each allowlisted field, alone and combined', async () => {
      const run = async (query: LeadSearchQuery) =>
        names(
          (
            await search({
              q: T,
              sort: 'name',
              order: 'asc',
              limit: 100,
              ...query,
            })
          ).items,
        );
      expect(await run({ company: 'acme' })).toEqual([
        `Grace Hopper${T}`,
        `Ada Lovelace${T}`,
      ]);
      expect(await run({ company: `globex-${T}.example` })).toEqual([
        `Linus Torvalds${T}`,
        `Alan Turing${T}`,
      ]);
      expect(await run({ contact: 'ada@' })).toEqual([`Ada Lovelace${T}`]);
      expect(await run({ title: 'vp' })).toEqual([
        `Margaret Hamilton${T}`,
        `Ada Lovelace${T}`,
      ]);
      // The person's own country first (Grace: GB), else the company's (Ada: US).
      expect(await run({ country: 'us' })).toEqual([`Ada Lovelace${T}`]);
      expect(await run({ country: 'GB,DE' })).toEqual([
        `Grace Hopper${T}`,
        `Linus Torvalds${T}`,
        `Alan Turing${T}`,
      ]);
      expect(await run({ industry: 'SOFTWARE' })).toEqual([
        `Margaret Hamilton${T}`,
        `Grace Hopper${T}`,
        `Ada Lovelace${T}`,
      ]);
      expect(await run({ source: 'apollo,csv_import' })).toEqual([
        `Grace Hopper${T}`,
        `Alan Turing${T}`,
      ]);
      expect(await run({ campaignId })).toEqual([
        `Margaret Hamilton${T}`,
        `Grace Hopper${T}`,
        `Ada Lovelace${T}`,
        `Alan Turing${T}`,
      ]);
      expect(await run({ campaignStatus: 'ACTIVE' })).toEqual([
        `Ken Thompson${T}`,
      ]);
      expect(await run({ campaignStatus: 'DRAFT,ACTIVE' })).toHaveLength(5);
      // Current scores only: Alan's first score (70) no longer counts.
      expect(await run({ scoreMin: 80 })).toEqual([
        `Ada Lovelace${T}`,
        `Alan Turing${T}`,
      ]);
      expect(await run({ scoreMin: 60, scoreMax: 75 })).toEqual([]);
      expect(await run({ campaignId, band: 'LOW_PRIORITY' })).toEqual([
        `Grace Hopper${T}`,
      ]);
      expect(await run({ verification: 'verified' })).toEqual([
        `Ada Lovelace${T}`,
      ]);
      expect(await run({ verification: 'invalid,risky' })).toEqual([
        `Grace Hopper${T}`,
        `Alan Turing${T}`,
      ]);
      expect(await run({ verification: 'unchecked' })).toEqual([
        `Margaret Hamilton${T}`,
        `Ken Thompson${T}`,
      ]);
      expect(await run({ verification: 'no_address' })).toEqual([
        `Barbara Liskov${T}`,
        `Linus Torvalds${T}`,
      ]);
      expect(await run({ eligibility: 'blocked' })).toEqual([
        `Grace Hopper${T}`,
      ]);
      expect(
        await run({ campaignId, eligibility: 'eligible,not_qualified' }),
      ).toEqual([
        `Margaret Hamilton${T}`,
        `Ada Lovelace${T}`,
        `Alan Turing${T}`,
      ]);
      expect(await run({ activeAfter: at(45).toISOString() })).toEqual([
        `Grace Hopper${T}`,
        `Ada Lovelace${T}`,
      ]);
      expect(
        await run({
          activeAfter: at(4).toISOString(),
          activeBefore: at(6).toISOString(),
        }),
      ).toEqual([`Margaret Hamilton${T}`, `Linus Torvalds${T}`]);
      expect(await run({ status: 'ARCHIVED' })).toEqual([
        `Newer Person${T}`,
        `Older Person${T}`,
        `Dennis Ritchie${T}`,
      ]);
      // Combined: a campaign's verified high scorers at a software company.
      expect(
        await run({
          campaignId,
          industry: 'software',
          scoreMin: 80,
          verification: 'verified',
        }),
      ).toEqual([`Ada Lovelace${T}`]);
      // Combined and paged: every page holds only matches, each once.
      const paged = await allPages(
        { q: T, campaignId, sort: 'score', order: 'asc' },
        1,
      );
      expect(paged.map((i) => i.score?.value ?? null)).toEqual([
        null,
        40,
        85,
        90,
      ]);
    });

    it('returns what each lead is, with its score, check, sources and qualification', async () => {
      const [ada] = (await search({ q: `ada@`, campaignId })).items;
      expect(ada).toMatchObject({
        id: people['Ada'],
        name: `Ada Lovelace${T}`,
        title: 'VP Sales',
        status: 'ACTIVE',
        countryCode: 'US',
        company: {
          id: orgs['acme'],
          name: `Acme ${T}`,
          domain: `acme-${T}.example`,
          industry: 'Software',
          countryCode: 'US',
        },
        sources: ['FAKE', 'MANUAL'],
        verification: { status: 'verified', checkedAt: at(30).toISOString() },
        score: { campaignId, value: 90, band: 'HIGH_PRIORITY', version: 1 },
        qualification: {
          campaignId,
          state: 'QUALIFIED',
          eligibilityStatus: 'eligible',
        },
        lastActivityAt: at(50).toISOString(),
      });
      // Without a campaign: the highest current score anywhere.
      const [alan] = (await search({ q: `Turing${T}` })).items;
      expect(alan?.score).toMatchObject({ value: 85, version: 2 });
    });

    it('answers no results as an empty last page', async () => {
      expect(await search({ q: `nobody-${T}` })).toEqual({
        items: [],
        nextCursor: null,
        sort: { field: 'created', order: 'desc' },
      });
      expect((await search({ q: T, country: 'JP' })).items).toEqual([]);
      expect(
        (await search({ q: T, campaignId, verification: 'no_address' })).items,
      ).toEqual([]);
    });

    it('matches typed text literally, wildcards included', async () => {
      expect(names((await search({ q: 'd_G' })).items)).toEqual([
        `Barbara Liskov${T}`,
      ]);
      expect(names((await search({ q: '100%' })).items)).toEqual([
        `Barbara Liskov${T}`,
      ]);
      expect((await search({ q: '%%' })).items).toEqual([]);
    });

    it('refuses unknown sorts, filters and values, and cursors of another search', async () => {
      const refused = async (query: unknown) => {
        const error = await (
          await admin()
        ).leads
          .search(query)
          .catch((e: unknown) => e);
        expect(error, JSON.stringify(query)).toBeInstanceOf(ZodError);
        return (error as ZodError).issues.map((issue) => issue.path.join('.'));
      };
      expect(await refused({ sort: 'email' })).toEqual(['sort']);
      expect(await refused({ sort: 'created; DROP TABLE contacts' })).toEqual([
        'sort',
      ]);
      expect(await refused({ order: 'sideways' })).toEqual(['order']);
      expect(await refused({ sort: 'score' })).toEqual(['sort']);
      expect(await refused({ orderBy: 'id' })).toEqual(['']);
      expect(await refused({ verification: 'maybe' })).toEqual([
        'verification',
      ]);
      expect(await refused({ band: 'TOP' })).toEqual(['band']);
      expect(await refused({ country: 'USA' })).toEqual(['country']);
      expect(await refused({ scoreMin: 90, scoreMax: 10 })).toEqual([
        'scoreMax',
      ]);
      expect(await refused({ limit: 1000 })).toEqual(['limit']);
      expect(await refused({ q: 'a' })).toEqual(['q']);
      expect(
        await refused({
          country: Array.from({ length: 21 }, () => 'US').join(','),
        }),
      ).toEqual(['country']);
      const scope = await admin();
      const page = await scope.leads.search({ q: T, limit: 1 });
      const cursor = page.nextCursor ?? '';
      // The cursor belongs to its sort, order and filters.
      for (const other of [
        { q: T, limit: 1, cursor, sort: 'name' },
        { q: T, limit: 1, cursor, order: 'asc' },
        { q: `${T}x`, limit: 1, cursor },
        { q: T, limit: 1, cursor: 'not-a-cursor!' },
        {
          q: T,
          limit: 1,
          cursor: Buffer.from('{"v":1}').toString('base64url'),
        },
      ] as const) {
        await expect(scope.leads.search(other)).rejects.toBeInstanceOf(
          InvalidCursorError,
        );
      }
      // A campaign of another workspace is not found.
      await expect(
        scope.leads.search({ campaignId: beta.campaign }),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
    });

    it('needs scores.read for scores and campaigns.read for campaign data', async () => {
      const reader = createLeadSearchRepository(
        prisma,
        alpha.tenant,
        {
          kind: 'member',
          userId: FIXTURE_USERS.alphaAdmin.id,
          membershipId: alpha.membershipAdmin,
          roleId: alpha.roleAdmin,
          permissions: new Set(['contacts.read']),
        },
        () => new Date(),
      );
      const [ada] = (await reader.search({ q: 'ada@' })).items;
      expect(ada).toMatchObject({
        score: null,
        qualification: null,
        verification: { status: 'verified' },
      });
      await expect(reader.search({ scoreMin: 10 })).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        reader.search({ campaignStatus: 'ACTIVE' }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect((await reader.detail(people['Ada'] ?? '')).campaigns).toEqual([]);
      await expect(
        createLeadSearchRepository(
          prisma,
          alpha.tenant,
          {
            kind: 'member',
            userId: 'x',
            membershipId: 'x',
            roleId: 'x',
            permissions: new Set(),
          },
          () => new Date(),
        ).search({}),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        systemScope(prisma, {
          tenantId: alpha.tenant,
          name: 'lead_search',
        }).leads.search({}),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
    });

    it('shows one lead in detail, and only this workspace’s', async () => {
      const scope = await admin();
      const detail = await scope.leads.detail(people['Alan'] ?? '');
      expect(detail).toMatchObject({
        name: `Alan Turing${T}`,
        countryCode: 'DE',
        company: { id: orgs['globex'], industry: 'retail' },
        quality: { level: 'review', email: { state: 'needs_review' } },
        sources: [{ provider: 'CSV_IMPORT' }],
        verifications: [{ status: 'risky', provider: 'FAKE' }],
        campaigns: [
          {
            id: campaignId,
            status: 'DRAFT',
            onLeadList: true,
            enrollment: null,
            score: { value: 85, version: 2 },
            qualification: null,
          },
        ],
        leadLists: [{ name: `Leads ${T}` }],
        truncated: {
          sources: false,
          verifications: false,
          campaigns: false,
          leadLists: false,
        },
      });
      const ken = await scope.leads.detail(people['Ken'] ?? '');
      expect(ken.campaigns).toEqual([
        expect.objectContaining({
          id: alpha.campaign,
          status: 'ACTIVE',
          onLeadList: false,
          enrollment: 'PENDING',
        }),
      ]);
      await expect(scope.leads.detail(betaAda)).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
      await expect(scope.leads.detail('not-a-uuid')).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
    });

    it("lists a lead's evidence and their company's, never another person's", async () => {
      const scope = await admin();
      const page = await scope.leads.evidence(people['Ada'] ?? '', {});
      expect(page.items.map((e) => `${e.about}: ${e.excerpt}`).sort()).toEqual([
        'company: Acme builds sales software.',
        'person: Title: VP Sales',
      ]);
      // Newest first (ids are time-ordered).
      expect(page.items.map((e) => e.id)).toEqual(
        page.items
          .map((e) => e.id)
          .sort()
          .reverse(),
      );
      const first = await scope.leads.evidence(people['Ada'] ?? '', {
        limit: 1,
      });
      const second = await scope.leads.evidence(people['Ada'] ?? '', {
        limit: 1,
        cursor: first.nextCursor ?? '',
      });
      expect([...first.items, ...second.items].map((e) => e.id)).toEqual(
        page.items.map((e) => e.id),
      );
      expect(second.nextCursor).toBeNull();
      expect(
        (
          await scope.leads.evidence(people['Ada'] ?? '', {
            kind: 'WEBSITE_EXCERPT',
          })
        ).items,
      ).toHaveLength(1);
      expect(
        (await scope.leads.evidence(people['Ken'] ?? '', {})).items,
      ).toEqual([]);
      await expect(scope.leads.evidence(betaAda, {})).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
    });

    it('refuses any row of another tenant read through a join', () => {
      expect(() => {
        assertTenant(alpha.tenant, 'company', [
          { tenantId: alpha.tenant },
          { tenantId: null },
        ]);
      }).not.toThrow();
      expect(() => {
        assertTenant(alpha.tenant, 'company', [{ tenantId: beta.tenant }]);
      }).toThrow(TenantLeakError);
    });
  },
);

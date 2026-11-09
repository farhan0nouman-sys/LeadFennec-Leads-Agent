// Lead search (task 11A, docs/decisions.md D-11A-*): the workspace's people, filtered and sorted
// only as `leadSearchQuerySchema` allows, one page at a time; one lead in detail; the evidence
// about a lead.
//
// - The search is one SQL statement built from fixed fragments: every value is a bind parameter,
//   and sorts and directions come from allowlists, never from the request's text. Every join and
//   subquery repeats the contact's tenant_id, and every row read back is checked against the
//   active tenant before anything is returned (assertTenant).
// - Pages are keyset pages on (sort key, id): stable while rows are added, without OFFSET, and
//   without duplicates or gaps. A cursor carries its sort and a hash of its filters, so it only
//   works with the search it came from.
// - Bounded: at most 100 rows a page, at most 20 values a list filter, at most 100 characters a
//   text filter, and the database stops a search after 5 seconds.
// - Scores need scores.read and campaign data campaigns.read: without them, those filters are
//   refused and those fields are left out.
import { createHash } from 'node:crypto';
import {
  CONTACT_SOURCE_PROVIDERS,
  LEAD_EVIDENCE_KINDS,
  LEAD_SEARCH_LIMITS,
  leadEvidenceQuerySchema,
  leadSearchFilters,
  likeContains,
  type ContactSourceProvider,
  type EmailVerificationStatus,
  type LeadDetail,
  type LeadEvidenceItem,
  type LeadSearchFilters,
  type LeadSearchItem,
  type LeadSearchPage,
  type LeadSortField,
  type PermissionKey,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { InvalidCursorError, paginate, type Page } from '../pagination.js';
import { uuidSchema, type TenantActor } from './actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
  requireReadPermission,
} from './authorization.js';
import { CHECK_STATUS, contactQualities } from './contact-quality.js';
import { suppressedAddresses } from './contact-store.js';
import {
  createLeadChangeRepository,
  type LeadChangeRepository,
} from './lead-changes.js';

/** A row read through a join belongs to another tenant: nothing is returned. */
export class TenantLeakError extends Error {
  constructor(readonly what: string) {
    super(`A ${what} of another tenant was read`);
    this.name = 'TenantLeakError';
  }
}

/** Every row must belong to `tenantId` (null tenants are rows a LEFT JOIN didn't find). */
export function assertTenant(
  tenantId: string,
  what: string,
  rows: readonly { readonly tenantId: string | null }[],
): void {
  for (const row of rows) {
    if (row.tenantId !== null && row.tenantId !== tenantId) {
      throw new TenantLeakError(what);
    }
  }
}

/** Search, detail and evidence (11A), and a member's changes (11B). */
export interface LeadSearchRepository extends LeadChangeRepository {
  /** One page of the workspace's people (contacts.read; scores.read and campaigns.read for those parts). */
  search(query: unknown): Promise<LeadSearchPage>;
  /** One person in detail (contacts.read). */
  detail(contactId: string): Promise<LeadDetail>;
  /** The evidence about a person and their company, newest first (contacts.read). */
  evidence(contactId: string, query: unknown): Promise<Page<LeadEvidenceItem>>;
}

const sql = Prisma.sql;
const ELIGIBILITY = z.enum(['eligible', 'review', 'blocked']);
/** A decision's reasons as stored; only their messages are shown. */
const REASONS = z.array(z.looseObject({ message: z.string() }));
const pagePayload = z.looseObject({ url: z.string().max(2000).optional() });

/** A website record's page address, when it is an http(s) URL (shown as a link). */
function pageUrl(provider: string, payload: unknown): string | null {
  if (provider !== 'WEBSITE') {
    return null;
  }
  const parsed = pagePayload.safeParse(payload);
  if (!parsed.success || parsed.data.url === undefined) {
    return null;
  }
  try {
    const url = new URL(parsed.data.url);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const CURSOR_TEXT = /^[A-Za-z0-9_-]{1,600}$/;

/** What a sort orders by; the expression is fixed SQL, never request text. */
const SORTS: Readonly<
  Record<
    LeadSortField,
    { readonly expression: Prisma.Sql; readonly key: 'time' | 'text' | 'int' }
  >
> = {
  created: { expression: sql`c.created_at`, key: 'time' },
  activity: { expression: sql`c.last_activity_at`, key: 'time' },
  name: {
    expression: sql`(lower(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, '')) COLLATE "C")`,
    key: 'text',
  },
  company: {
    expression: sql`(lower(coalesce(o.name, '')) COLLATE "C")`,
    key: 'text',
  },
  // Only with a campaign (the query refuses it otherwise); unscored people sort last when descending.
  score: { expression: sql`coalesce(sc.value, -1)`, key: 'int' },
};

const cursorSchema = z
  .object({
    v: z.literal(1),
    /** Sort field and order. */
    f: z.string(),
    o: z.enum(['asc', 'desc']),
    /** Hash of the filters. */
    h: z.string().regex(/^[0-9a-f]{16}$/),
    /** The last row's sort key and id. */
    k: z.union([z.string().max(400), z.number().int()]),
    id: z.uuid(),
  })
  .strict();
type Cursor = z.output<typeof cursorSchema>;

/** The filters a cursor belongs to (everything but the page). */
function filtersHash(filters: LeadSearchFilters): string {
  // The page (cursor and size) isn't part of what is searched.
  const searched = JSON.stringify(filters, (key, value: unknown) =>
    key === 'cursor' || key === 'limit' ? undefined : value,
  );
  return createHash('sha256').update(searched).digest('hex').slice(0, 16);
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify(cursorSchema.parse(cursor)),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(
  text: string,
  filters: LeadSearchFilters,
  hash: string,
): Cursor {
  if (!CURSOR_TEXT.test(text)) {
    throw new InvalidCursorError();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  const parsed = cursorSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.f !== filters.sort ||
    parsed.data.o !== filters.order ||
    parsed.data.h !== hash
  ) {
    throw new InvalidCursorError();
  }
  const cursor = parsed.data;
  const kind = SORTS[filters.sort].key;
  if (
    (kind === 'int') !== (typeof cursor.k === 'number') ||
    (kind === 'time' && Number.isNaN(Date.parse(String(cursor.k))))
  ) {
    throw new InvalidCursorError();
  }
  return cursor;
}

/** The cursor's key as a typed SQL value, compared like the sort expression. */
function cursorKey(
  kind: 'time' | 'text' | 'int',
  key: string | number,
): Prisma.Sql {
  switch (kind) {
    case 'time':
      return sql`${new Date(String(key))}::timestamptz`;
    case 'text':
      return sql`(${String(key)}::text COLLATE "C")`;
    case 'int':
      return sql`${Number(key)}::int`;
  }
}

/** Leads of a campaign: on its lead list, or enrolled. `campaign` narrows the campaigns. */
const campaignMembership = (campaign: Prisma.Sql) => sql`EXISTS (
  SELECT 1 FROM campaigns ca
  WHERE ca.tenant_id = c.tenant_id AND ${campaign} AND (
    EXISTS (SELECT 1 FROM lead_list_members m
            WHERE m.tenant_id = ca.tenant_id AND m.lead_list_id = ca.lead_list_id AND m.contact_id = c.id)
    OR EXISTS (SELECT 1 FROM campaign_leads cl
               WHERE cl.tenant_id = ca.tenant_id AND cl.campaign_id = ca.id AND cl.contact_id = c.id)))`;

interface SearchRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly title: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly country_code: string | null;
  readonly created_at: Date;
  readonly last_activity_at: Date;
  readonly org_tenant_id: string | null;
  readonly org_id: string | null;
  readonly org_name: string | null;
  readonly org_domain: string | null;
  readonly org_industry: string | null;
  readonly org_country: string | null;
  readonly sort_key: Date | string | number;
}

const displayName = (first: string | null, last: string | null) => {
  const name = [first, last]
    .filter((part) => part !== null && part !== '')
    .join(' ');
  return name === '' ? null : name;
};

const isSource = (value: string): value is ContactSourceProvider =>
  (CONTACT_SOURCE_PROVIDERS as readonly string[]).includes(value);

export function createLeadSearchRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): LeadSearchRepository {
  /** Reads with a permission: a member who has it, or a platform admin's audited scope. */
  const canRead = (permission: PermissionKey) =>
    actor.kind === 'platform_admin' ||
    (actor.kind === 'member' && actor.permissions.has(permission));

  const idOrNotFound = (rawId: string) => {
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new RecordNotFoundError('contact');
    }
    return parsed.data;
  };

  /** The search statement: allowlisted fragments and bind parameters only. */
  function searchStatement(
    filters: LeadSearchFilters,
    cursor: Cursor | null,
  ): Prisma.Sql {
    const sort = SORTS[filters.sort];
    const direction = Prisma.raw(filters.order === 'asc' ? 'ASC' : 'DESC');
    const where: Prisma.Sql[] = [
      sql`c.tenant_id = ${tenantId}::uuid`,
      sql`c.status::text = ANY(${[...filters.statuses]}::text[])`,
    ];
    const laterals: Prisma.Sql[] = [];

    if (filters.q !== null) {
      const p = likeContains(filters.q);
      where.push(sql`(c.first_name ILIKE ${p} OR c.last_name ILIKE ${p}
        OR (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ILIKE ${p}
        OR c.normalized_email ILIKE ${p} OR c.title ILIKE ${p}
        OR o.name ILIKE ${p} OR o.normalized_domain ILIKE ${p})`);
    }
    if (filters.company !== null) {
      const p = likeContains(filters.company);
      where.push(sql`(o.name ILIKE ${p} OR o.normalized_domain ILIKE ${p})`);
    }
    if (filters.contact !== null) {
      const p = likeContains(filters.contact);
      where.push(sql`(c.first_name ILIKE ${p} OR c.last_name ILIKE ${p}
        OR (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ILIKE ${p}
        OR c.normalized_email ILIKE ${p})`);
    }
    if (filters.title !== null) {
      where.push(sql`c.title ILIKE ${likeContains(filters.title)}`);
    }
    if (filters.countries.length > 0) {
      where.push(
        sql`coalesce(c.country_code, o.country_code)::text = ANY(${[...filters.countries]}::text[])`,
      );
    }
    if (filters.industries.length > 0) {
      where.push(
        sql`lower(o.industry) = ANY(${[...filters.industries]}::text[])`,
      );
    }
    if (filters.sources.length > 0) {
      where.push(sql`EXISTS (SELECT 1 FROM source_records sr
        WHERE sr.tenant_id = c.tenant_id AND sr.contact_id = c.id
          AND sr.provider::text = ANY(${[...filters.sources]}::text[]))`);
    }
    if (filters.campaignId !== null) {
      where.push(campaignMembership(sql`ca.id = ${filters.campaignId}::uuid`));
    }
    if (filters.campaignStatuses.length > 0) {
      where.push(
        campaignMembership(
          sql`ca.status::text = ANY(${[...filters.campaignStatuses]}::text[])`,
        ),
      );
    }

    // Scores: the current score (highest version) of a campaign.
    const scoreConditions = (alias: Prisma.Sql) => {
      const conditions: Prisma.Sql[] = [];
      if (filters.scoreMin !== null) {
        conditions.push(sql`${alias}.value >= ${filters.scoreMin}::int`);
      }
      if (filters.scoreMax !== null) {
        conditions.push(sql`${alias}.value <= ${filters.scoreMax}::int`);
      }
      if (filters.bands.length > 0) {
        conditions.push(
          sql`${alias}.band::text = ANY(${[...filters.bands]}::text[])`,
        );
      }
      return conditions;
    };
    const scored = scoreConditions(Prisma.raw('sc'));
    if (
      filters.campaignId !== null &&
      (scored.length > 0 || filters.sort === 'score')
    ) {
      laterals.push(sql`LEFT JOIN LATERAL (
        SELECT s.value, s.band FROM scores s
        WHERE s.tenant_id = c.tenant_id AND s.campaign_id = ${filters.campaignId}::uuid
          AND s.contact_id = c.id AND s.version IS NOT NULL
        ORDER BY s.version DESC LIMIT 1) sc ON true`);
      where.push(...scored);
    } else if (scored.length > 0) {
      const anyScored = scoreConditions(Prisma.raw('s'));
      where.push(sql`EXISTS (SELECT 1 FROM scores s
        WHERE s.tenant_id = c.tenant_id AND s.contact_id = c.id AND s.campaign_id IS NOT NULL
          AND s.version = (SELECT max(s2.version) FROM scores s2
                           WHERE s2.tenant_id = s.tenant_id AND s2.campaign_id = s.campaign_id
                             AND s2.contact_id = s.contact_id AND s2.version IS NOT NULL)
          AND ${Prisma.join(anyScored, ' AND ')})`);
    }

    if (filters.verification.length > 0) {
      laterals.push(sql`LEFT JOIN LATERAL (
        SELECT v.status FROM verifications v
        WHERE v.tenant_id = c.tenant_id AND v.contact_id = c.id
          AND v.normalized_email = c.normalized_email
        ORDER BY v.checked_at DESC, v.id DESC LIMIT 1) vf ON true`);
      const stored = filters.verification.flatMap((value) => {
        const entry = Object.entries(CHECK_STATUS).find(
          ([, status]) => status === value,
        );
        return entry === undefined ? [] : [entry[0]];
      });
      const options: Prisma.Sql[] = [];
      if (stored.length > 0) {
        options.push(sql`vf.status::text = ANY(${stored}::text[])`);
      }
      if (filters.verification.includes('unchecked')) {
        options.push(
          sql`(c.normalized_email IS NOT NULL AND vf.status IS NULL)`,
        );
      }
      if (filters.verification.includes('no_address')) {
        options.push(sql`c.normalized_email IS NULL`);
      }
      where.push(sql`(${Prisma.join(options, ' OR ')})`);
    }

    if (filters.eligibility.length > 0) {
      laterals.push(sql`LEFT JOIN LATERAL (
        SELECT q.eligibility_status FROM lead_qualifications q
        WHERE q.tenant_id = c.tenant_id AND q.contact_id = c.id
          ${filters.campaignId === null ? Prisma.empty : sql`AND q.campaign_id = ${filters.campaignId}::uuid`}
        ORDER BY q.decided_at DESC, q.version DESC LIMIT 1) ql ON true`);
      const recorded = filters.eligibility.filter(
        (value) => value !== 'not_qualified',
      );
      const options: Prisma.Sql[] = [];
      if (recorded.length > 0) {
        options.push(sql`ql.eligibility_status = ANY(${recorded}::text[])`);
      }
      if (filters.eligibility.includes('not_qualified')) {
        options.push(sql`ql.eligibility_status IS NULL`);
      }
      where.push(sql`(${Prisma.join(options, ' OR ')})`);
    }

    if (filters.activeAfter !== null) {
      where.push(
        sql`c.last_activity_at >= ${filters.activeAfter}::timestamptz`,
      );
    }
    if (filters.activeBefore !== null) {
      where.push(
        sql`c.last_activity_at < ${filters.activeBefore}::timestamptz`,
      );
    }
    if (cursor !== null) {
      const key = cursorKey(sort.key, cursor.k);
      where.push(
        filters.order === 'asc'
          ? sql`(${sort.expression}, c.id) > (${key}, ${cursor.id}::uuid)`
          : sql`(${sort.expression}, c.id) < (${key}, ${cursor.id}::uuid)`,
      );
    }

    return sql`SELECT c.tenant_id::text AS tenant_id, c.id::text AS id, c.first_name, c.last_name,
        c.title, c.email, c.status::text AS status, c.country_code::text AS country_code,
        c.created_at, c.last_activity_at,
        o.tenant_id::text AS org_tenant_id, o.id::text AS org_id, o.name AS org_name,
        o.normalized_domain AS org_domain, o.industry AS org_industry,
        o.country_code::text AS org_country,
        ${sort.expression} AS sort_key
      FROM contacts c
      LEFT JOIN organizations o ON o.tenant_id = c.tenant_id AND o.id = c.organization_id
      ${laterals.length === 0 ? Prisma.empty : Prisma.join(laterals, '\n')}
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY ${sort.expression} ${direction}, c.id ${direction}
      LIMIT ${filters.limit + 1}`;
  }

  /** Tags, notes, research, score versions and decisions of one person (task 11B). */
  async function profileHistory(contactId: string, cap: number) {
    const tags = await prisma.contactTag.findMany({
      where: { tenantId, contactId },
      orderBy: { tag: 'asc' },
      take: 50,
      select: { tenantId: true, tag: true },
    });
    assertTenant(tenantId, 'tag', tags);
    const notes = await prisma.contactNote.findMany({
      where: { tenantId, contactId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: cap + 1,
      select: {
        tenantId: true,
        id: true,
        body: true,
        createdAt: true,
        createdBy: {
          select: { tenantId: true, user: { select: { displayName: true } } },
        },
      },
    });
    assertTenant(tenantId, 'note', notes);
    assertTenant(
      tenantId,
      'note author',
      notes.map((note) => note.createdBy),
    );
    const contact = await prisma.contact.findUnique({
      where: { tenantId_id: { tenantId, id: contactId } },
      select: { organizationId: true },
    });
    const research =
      contact?.organizationId == null
        ? null
        : await prisma.research.findFirst({
            where: {
              tenantId,
              organizationId: contact.organizationId,
              contactId: null,
              version: { not: null },
            },
            orderBy: { version: 'desc' },
            select: {
              tenantId: true,
              id: true,
              version: true,
              status: true,
              completedAt: true,
            },
          });
    assertTenant(tenantId, 'research', research === null ? [] : [research]);
    const scores =
      canRead('scores.read') && canRead('campaigns.read')
        ? await prisma.score.findMany({
            where: {
              tenantId,
              contactId,
              version: { not: null },
              campaignId: { not: null },
            },
            orderBy: [{ scoredAt: 'desc' }, { id: 'desc' }],
            take: cap + 1,
            select: {
              tenantId: true,
              campaignId: true,
              version: true,
              value: true,
              band: true,
              scoredAt: true,
              campaign: { select: { tenantId: true, name: true } },
            },
          })
        : [];
    assertTenant(tenantId, 'score', scores);
    assertTenant(
      tenantId,
      'campaign',
      scores.flatMap((score) =>
        score.campaign === null ? [] : [score.campaign],
      ),
    );
    const decisions = canRead('campaigns.read')
      ? await prisma.leadQualification.findMany({
          where: { tenantId, contactId },
          orderBy: [{ decidedAt: 'desc' }, { version: 'desc' }],
          take: cap + 1,
          select: {
            tenantId: true,
            campaignId: true,
            version: true,
            state: true,
            origin: true,
            reasons: true,
            decidedAt: true,
            campaign: { select: { tenantId: true, name: true } },
            decidedBy: {
              select: {
                tenantId: true,
                user: { select: { displayName: true } },
              },
            },
          },
        })
      : [];
    assertTenant(tenantId, 'qualification', decisions);
    assertTenant(
      tenantId,
      'campaign',
      decisions.map((decision) => decision.campaign),
    );
    return {
      tags: tags.map((row) => row.tag),
      notes: notes.map((note) => ({
        id: note.id,
        body: note.body,
        author: note.createdBy.user.displayName,
        createdAt: note.createdAt.toISOString(),
      })),
      research:
        research?.version == null
          ? null
          : {
              id: research.id,
              version: research.version,
              status: research.status,
              completedAt: research.completedAt?.toISOString() ?? null,
            },
      scores: scores.flatMap((score) =>
        score.campaignId === null ||
        score.campaign === null ||
        score.version === null ||
        score.band === null
          ? []
          : [
              {
                campaignId: score.campaignId,
                campaignName: score.campaign.name,
                version: score.version,
                value: score.value,
                band: score.band,
                scoredAt: score.scoredAt.toISOString(),
              },
            ],
      ),
      activity: decisions.map((decision) => {
        const reasons = REASONS.safeParse(decision.reasons);
        return {
          campaignId: decision.campaignId,
          campaignName: decision.campaign.name,
          version: decision.version,
          state: decision.state,
          origin: decision.origin,
          reasons: reasons.success ? reasons.data.map((r) => r.message) : [],
          decidedBy: decision.decidedBy?.user.displayName ?? null,
          decidedAt: decision.decidedAt.toISOString(),
        };
      }),
    };
  }

  /** Sources, the newest check, a score and a qualification for a page of people. */
  async function pageDetails(
    tx: Prisma.TransactionClient,
    rows: readonly SearchRow[],
    filters: LeadSearchFilters,
  ) {
    const ids = rows.map((row) => row.id);
    const emails = new Map(
      rows.map((row) => [
        row.id,
        row.email === null ? null : row.email.toLowerCase(),
      ]),
    );
    const sources = await tx.sourceRecord.findMany({
      where: { tenantId, contactId: { in: ids } },
      distinct: ['contactId', 'provider'],
      select: { tenantId: true, contactId: true, provider: true },
    });
    assertTenant(tenantId, 'source record', sources);
    const contacts = await tx.contact.findMany({
      where: { tenantId, id: { in: ids } },
      select: { tenantId: true, id: true, normalizedEmail: true },
    });
    assertTenant(tenantId, 'contact', contacts);
    for (const contact of contacts) {
      emails.set(contact.id, contact.normalizedEmail);
    }
    const checks = await tx.verification.findMany({
      where: { tenantId, contactId: { in: ids } },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      select: {
        tenantId: true,
        contactId: true,
        normalizedEmail: true,
        status: true,
        checkedAt: true,
      },
      take: ids.length * LEAD_SEARCH_LIMITS.detailItems,
    });
    assertTenant(tenantId, 'verification', checks);
    const scores = canRead('scores.read')
      ? await tx.score.findMany({
          where: {
            tenantId,
            contactId: { in: ids },
            version: { not: null },
            campaignId: filters.campaignId ?? { not: null },
          },
          orderBy: [{ version: 'desc' }],
          distinct: ['campaignId', 'contactId'],
          select: {
            tenantId: true,
            campaignId: true,
            contactId: true,
            value: true,
            band: true,
            version: true,
            scoredAt: true,
          },
        })
      : [];
    assertTenant(tenantId, 'score', scores);
    const qualifications = canRead('campaigns.read')
      ? await tx.leadQualification.findMany({
          where: {
            tenantId,
            contactId: { in: ids },
            ...(filters.campaignId === null
              ? {}
              : { campaignId: filters.campaignId }),
          },
          orderBy: [{ decidedAt: 'desc' }, { version: 'desc' }],
          distinct: ['contactId'],
          select: {
            tenantId: true,
            campaignId: true,
            contactId: true,
            state: true,
            eligibilityStatus: true,
            decidedAt: true,
          },
        })
      : [];
    assertTenant(tenantId, 'qualification', qualifications);

    return (
      row: SearchRow,
    ): Pick<
      LeadSearchItem,
      'sources' | 'verification' | 'score' | 'qualification'
    > => {
      const email = emails.get(row.id) ?? null;
      const check =
        email === null
          ? undefined
          : checks.find(
              (c) => c.contactId === row.id && c.normalizedEmail === email,
            );
      // The highest current score (ties: the newest).
      const best = scores
        .filter(
          (s) =>
            s.contactId === row.id && s.band !== null && s.version !== null,
        )
        .sort(
          (a, b) =>
            b.value - a.value || b.scoredAt.getTime() - a.scoredAt.getTime(),
        )[0];
      const decision = qualifications.find((q) => q.contactId === row.id);
      const eligibility =
        decision === undefined
          ? null
          : ELIGIBILITY.safeParse(decision.eligibilityStatus);
      return {
        sources: [
          ...new Set(
            sources
              .filter((s) => s.contactId === row.id)
              .map((s) => s.provider)
              .filter(isSource),
          ),
        ].sort(),
        verification:
          check === undefined
            ? null
            : {
                status: CHECK_STATUS[check.status],
                checkedAt: check.checkedAt.toISOString(),
              },
        score:
          best?.campaignId == null ||
          best.band === null ||
          best.version === null
            ? null
            : {
                campaignId: best.campaignId,
                value: best.value,
                band: best.band,
                version: best.version,
                scoredAt: best.scoredAt.toISOString(),
              },
        qualification:
          decision === undefined || eligibility?.success !== true
            ? null
            : {
                campaignId: decision.campaignId,
                state: decision.state,
                eligibilityStatus: eligibility.data,
                decidedAt: decision.decidedAt.toISOString(),
              },
      };
    };
  }

  const repository = {
    async search(rawQuery: unknown): Promise<LeadSearchPage> {
      requireReadPermission(actor, 'contacts.read');
      const filters = leadSearchFilters(rawQuery);
      const usesScores =
        filters.scoreMin !== null ||
        filters.scoreMax !== null ||
        filters.bands.length > 0 ||
        filters.sort === 'score';
      if (usesScores && !canRead('scores.read')) {
        throw new PermissionDeniedError('scores.read');
      }
      if (
        (filters.campaignId !== null ||
          filters.campaignStatuses.length > 0 ||
          filters.eligibility.length > 0) &&
        !canRead('campaigns.read')
      ) {
        throw new PermissionDeniedError('campaigns.read');
      }
      const hash = filtersHash(filters);
      const cursor =
        filters.cursor === null
          ? null
          : decodeCursor(filters.cursor, filters, hash);

      return prisma.$transaction(
        async (tx) => {
          // The database stops a search that runs too long (this transaction only).
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(LEAD_SEARCH_LIMITS.statementTimeoutMs)}, true)`;
          if (filters.campaignId !== null) {
            const campaign = await tx.campaign.findUnique({
              where: { tenantId_id: { tenantId, id: filters.campaignId } },
              select: { id: true },
            });
            if (campaign === null) {
              throw new RecordNotFoundError('campaign');
            }
          }
          const rows = await tx.$queryRaw<SearchRow[]>(
            searchStatement(filters, cursor),
          );
          // Every row, and the company joined to it, must be this tenant's.
          assertTenant(
            tenantId,
            'contact',
            rows.map((row) => ({ tenantId: row.tenant_id })),
          );
          assertTenant(
            tenantId,
            'company',
            rows.map((row) => ({ tenantId: row.org_tenant_id })),
          );
          const page = rows.slice(0, filters.limit);
          const details = await pageDetails(tx, page, filters);
          const last = page.at(-1);
          const keyOf = (row: SearchRow) =>
            row.sort_key instanceof Date
              ? row.sort_key.toISOString()
              : row.sort_key;
          return {
            items: page.map((row): LeadSearchItem => ({
              id: row.id,
              name: displayName(row.first_name, row.last_name),
              title: row.title,
              email: row.email,
              status: row.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
              countryCode: row.country_code ?? row.org_country,
              company:
                row.org_id === null || row.org_name === null
                  ? null
                  : {
                      id: row.org_id,
                      name: row.org_name,
                      domain: row.org_domain,
                      industry: row.org_industry,
                      countryCode: row.org_country,
                    },
              ...details(row),
              createdAt: row.created_at.toISOString(),
              lastActivityAt: row.last_activity_at.toISOString(),
            })),
            nextCursor:
              rows.length > filters.limit && last !== undefined
                ? encodeCursor({
                    v: 1,
                    f: filters.sort,
                    o: filters.order,
                    h: hash,
                    k: keyOf(last),
                    id: last.id,
                  })
                : null,
            sort: { field: filters.sort, order: filters.order },
          };
        },
        { timeout: LEAD_SEARCH_LIMITS.statementTimeoutMs * 2, maxWait: 10_000 },
      );
    },

    async detail(rawId: string): Promise<LeadDetail> {
      requireReadPermission(actor, 'contacts.read');
      const id = idOrNotFound(rawId);
      const contact = await prisma.contact.findUnique({
        where: { tenantId_id: { tenantId, id } },
        select: {
          tenantId: true,
          id: true,
          firstName: true,
          lastName: true,
          title: true,
          email: true,
          normalizedEmail: true,
          linkedinUrl: true,
          countryCode: true,
          status: true,
          version: true,
          createdAt: true,
          lastActivityAt: true,
          organization: {
            select: {
              tenantId: true,
              id: true,
              name: true,
              normalizedDomain: true,
              industry: true,
              countryCode: true,
            },
          },
        },
      });
      if (contact === null) {
        throw new RecordNotFoundError('contact');
      }
      assertTenant(tenantId, 'contact', [contact]);
      assertTenant(
        tenantId,
        'company',
        contact.organization === null ? [] : [contact.organization],
      );
      const cap = LEAD_SEARCH_LIMITS.detailItems;
      const sources = await prisma.sourceRecord.findMany({
        where: { tenantId, contactId: id },
        orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
        take: cap + 1,
        select: {
          tenantId: true,
          id: true,
          provider: true,
          externalId: true,
          importId: true,
          outcome: true,
          confidence: true,
          fetchedAt: true,
          payload: true,
        },
      });
      assertTenant(tenantId, 'source record', sources);
      const checks = await prisma.verification.findMany({
        where: { tenantId, contactId: id },
        orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
        take: cap + 1,
        select: {
          tenantId: true,
          normalizedEmail: true,
          status: true,
          reason: true,
          provider: true,
          checkedAt: true,
        },
      });
      assertTenant(tenantId, 'verification', checks);

      const campaignCap = LEAD_SEARCH_LIMITS.detailCampaigns;
      const campaigns = canRead('campaigns.read')
        ? await prisma.campaign.findMany({
            where: {
              tenantId,
              OR: [
                {
                  leadList: { members: { some: { tenantId, contactId: id } } },
                },
                { leads: { some: { tenantId, contactId: id } } },
              ],
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: campaignCap + 1,
            select: {
              tenantId: true,
              id: true,
              name: true,
              status: true,
              leadListId: true,
            },
          })
        : [];
      assertTenant(tenantId, 'campaign', campaigns);
      const campaignIds = campaigns.slice(0, campaignCap).map((c) => c.id);
      const memberships = await prisma.leadListMember.findMany({
        where: { tenantId, contactId: id },
        orderBy: [{ addedAt: 'desc' }],
        take: campaignCap + 1,
        select: {
          tenantId: true,
          leadListId: true,
          leadList: { select: { tenantId: true, id: true, name: true } },
        },
      });
      assertTenant(tenantId, 'lead list member', memberships);
      assertTenant(
        tenantId,
        'lead list',
        memberships.map((m) => m.leadList),
      );
      const enrollments =
        campaignIds.length === 0
          ? []
          : await prisma.campaignLead.findMany({
              where: {
                tenantId,
                contactId: id,
                campaignId: { in: campaignIds },
              },
              select: { tenantId: true, campaignId: true, status: true },
            });
      assertTenant(tenantId, 'campaign lead', enrollments);
      const scores =
        campaignIds.length === 0 || !canRead('scores.read')
          ? []
          : await prisma.score.findMany({
              where: {
                tenantId,
                contactId: id,
                campaignId: { in: campaignIds },
                version: { not: null },
              },
              orderBy: [{ version: 'desc' }],
              distinct: ['campaignId'],
              select: {
                tenantId: true,
                campaignId: true,
                value: true,
                band: true,
                version: true,
                scoredAt: true,
              },
            });
      assertTenant(tenantId, 'score', scores);
      const decisions =
        campaignIds.length === 0
          ? []
          : await prisma.leadQualification.findMany({
              where: {
                tenantId,
                contactId: id,
                campaignId: { in: campaignIds },
              },
              orderBy: [{ version: 'desc' }],
              distinct: ['campaignId'],
              select: {
                tenantId: true,
                campaignId: true,
                version: true,
                state: true,
                eligibilityStatus: true,
                decidedAt: true,
              },
            });
      assertTenant(tenantId, 'qualification', decisions);
      const history = await profileHistory(id, cap);
      const listIds = new Set(memberships.map((m) => m.leadListId));
      const quality = (
        await contactQualities(prisma, tenantId, [id], now())
      ).get(id);
      if (quality === undefined) {
        throw new RecordNotFoundError('contact');
      }
      const organization = contact.organization;
      const doNotContact =
        contact.normalizedEmail !== null &&
        (await suppressedAddresses(prisma, tenantId, [contact.normalizedEmail]))
          .size > 0;
      return {
        id: contact.id,
        name: displayName(contact.firstName, contact.lastName),
        firstName: contact.firstName,
        lastName: contact.lastName,
        title: contact.title,
        email: contact.email,
        linkedinUrl: contact.linkedinUrl,
        countryCode: contact.countryCode ?? organization?.countryCode ?? null,
        status: contact.status,
        version: contact.version,
        doNotContact,
        createdAt: contact.createdAt.toISOString(),
        lastActivityAt: contact.lastActivityAt.toISOString(),
        company:
          organization === null
            ? null
            : {
                id: organization.id,
                name: organization.name,
                domain: organization.normalizedDomain,
                industry: organization.industry,
                countryCode: organization.countryCode,
              },
        research: history.research,
        quality,
        tags: history.tags,
        notes: history.notes.slice(0, cap),
        sources: sources.slice(0, cap).flatMap((record) =>
          isSource(record.provider)
            ? [
                {
                  id: record.id,
                  provider: record.provider,
                  externalId: record.externalId,
                  importId: record.importId,
                  outcome: record.outcome,
                  confidence: record.confidence,
                  url: pageUrl(record.provider, record.payload),
                  retrievedAt: record.fetchedAt.toISOString(),
                },
              ]
            : [],
        ),
        verifications: checks.slice(0, cap).map((check) => ({
          address: check.normalizedEmail,
          status: CHECK_STATUS[check.status] satisfies EmailVerificationStatus,
          reason: check.reason,
          provider: check.provider.toUpperCase(),
          checkedAt: check.checkedAt.toISOString(),
        })),
        campaigns: campaigns.slice(0, campaignCap).map((campaign) => {
          const score = scores.find((s) => s.campaignId === campaign.id);
          const decision = decisions.find((d) => d.campaignId === campaign.id);
          const eligibility =
            decision === undefined
              ? null
              : ELIGIBILITY.safeParse(decision.eligibilityStatus);
          return {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            onLeadList:
              campaign.leadListId !== null && listIds.has(campaign.leadListId),
            enrollment:
              enrollments.find((e) => e.campaignId === campaign.id)?.status ??
              null,
            score:
              score === undefined ||
              score.band === null ||
              score.version === null
                ? null
                : {
                    value: score.value,
                    band: score.band,
                    version: score.version,
                    scoredAt: score.scoredAt.toISOString(),
                  },
            qualification:
              decision === undefined || eligibility?.success !== true
                ? null
                : {
                    version: decision.version,
                    state: decision.state,
                    eligibilityStatus: eligibility.data,
                    decidedAt: decision.decidedAt.toISOString(),
                  },
          };
        }),
        scoreHistory: history.scores.slice(0, cap),
        activity: history.activity.slice(0, cap),
        leadLists: canRead('lead_lists.read')
          ? memberships.slice(0, campaignCap).map((m) => ({
              id: m.leadList.id,
              name: m.leadList.name,
            }))
          : [],
        truncated: {
          sources: sources.length > cap,
          verifications: checks.length > cap,
          campaigns: campaigns.length > campaignCap,
          leadLists: memberships.length > campaignCap,
          notes: history.notes.length > cap,
          scoreHistory: history.scores.length > cap,
          activity: history.activity.length > cap,
        },
      };
    },

    async evidence(
      rawId: string,
      rawQuery: unknown,
    ): Promise<Page<LeadEvidenceItem>> {
      requireReadPermission(actor, 'contacts.read');
      const id = idOrNotFound(rawId);
      const query = leadEvidenceQuerySchema.parse(rawQuery);
      const contact = await prisma.contact.findUnique({
        where: { tenantId_id: { tenantId, id } },
        select: { tenantId: true, organizationId: true },
      });
      if (contact === null) {
        throw new RecordNotFoundError('contact');
      }
      assertTenant(tenantId, 'contact', [contact]);
      const page = await paginate(
        {
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        },
        (keyset) =>
          prisma.evidence.findMany({
            where: {
              tenantId,
              // The person's own evidence, and their company's that isn't about someone else.
              OR: [
                { contactId: id },
                ...(contact.organizationId === null
                  ? []
                  : [
                      {
                        organizationId: contact.organizationId,
                        contactId: null,
                      },
                    ]),
              ],
              ...(query.kind === undefined ? {} : { kind: query.kind }),
              ...keyset.cursorWhere,
            },
            orderBy: keyset.orderBy,
            take: keyset.take,
            select: {
              tenantId: true,
              id: true,
              kind: true,
              contactId: true,
              excerpt: true,
              sourceUrl: true,
              extractLabel: true,
              researchId: true,
              capturedAt: true,
            },
          }),
      );
      assertTenant(tenantId, 'evidence', page.items);
      return {
        nextCursor: page.nextCursor,
        items: page.items.map((row) => ({
          id: row.id,
          kind: z.enum(LEAD_EVIDENCE_KINDS).parse(row.kind),
          about: row.contactId === null ? 'company' : 'person',
          excerpt: row.excerpt,
          sourceUrl: row.sourceUrl,
          extractLabel: row.extractLabel,
          researchId: row.researchId,
          capturedAt: row.capturedAt.toISOString(),
        })),
      };
    },
  };
  return {
    ...repository,
    ...createLeadChangeRepository(prisma, tenantId, actor, now, (id) =>
      repository.detail(id),
    ),
  };
}

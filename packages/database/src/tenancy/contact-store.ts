// Saving people found by contact enrichment (task 08C, docs/decisions.md D-08C-02): one place
// for the do-not-contact check, the campaign's exclusions and the identity match, inside the
// caller's transaction. Writes to a workspace's contacts are serialized (a transaction-scoped
// advisory lock), so two runs can never create the same person twice. A person is matched, in
// this order, by the provider's id for them (an earlier record of theirs), their address, their
// LinkedIn profile, and their name at the same company when neither record has an address that
// tells them apart. What someone saved is never overwritten: only missing details are filled in.
// Every query is filtered by the tenant.
import type {
  ContactDataProvider,
  ContactIdentity,
  EnrichmentIssue,
} from '@lead-fennec-ai/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { domainAndParents } from './organization-store.js';

type Tx = Prisma.TransactionClient;

/** A person to save: identity from normalizeContactIdentity, details as found. */
export interface IncomingContact {
  readonly kind: 'found';
  readonly identity: ContactIdentity;
  readonly title: string | null;
  readonly organizationId: string;
  /** The people provider and its id for the person (the provider mapping). */
  readonly source: {
    readonly provider: ContactDataProvider;
    readonly externalId: string | null;
  };
}

/** A person the workspace already has fresh data for (found by their provider id). */
export interface ReusedContact {
  readonly kind: 'reused';
  readonly contactId: string;
}

/** The campaign's own exclusions, normalized (the workspace's suppressions always apply). */
export interface ContactExclusions {
  readonly emails: readonly string[];
  readonly domains: readonly string[];
  readonly leadListIds: readonly string[];
}

export type ContactMatch = 'provider' | 'email' | 'linkedin' | 'name';

export type ContactSaveOutcome =
  | {
      readonly outcome: 'CREATED' | 'MATCHED';
      readonly contactId: string;
      /** How a MATCHED person was recognized (reused people: by the provider's id). */
      readonly matchedBy: ContactMatch | null;
      /** The contact's address after saving (an earlier one is kept). */
      readonly email: string | null;
      /** Saved, but not to be added to the campaign's lead list (and why). */
      readonly notListed: readonly EnrichmentIssue[];
    }
  | {
      /** EXCLUDED: not to be contacted; FAILED: a reused contact deleted meanwhile. */
      readonly outcome: 'EXCLUDED' | 'FAILED';
      readonly issues: readonly EnrichmentIssue[];
    };

const SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  title: true,
  email: true,
  normalizedEmail: true,
  linkedinUrl: true,
  nameKey: true,
  organizationId: true,
} as const;

type Existing = Prisma.ContactGetPayload<{ select: typeof SELECT }>;

const SUPPRESSED: EnrichmentIssue = {
  field: 'email',
  message: 'This address is on the do-not-contact list.',
};
const CAMPAIGN_EXCLUDED: EnrichmentIssue = {
  field: 'email',
  message: 'The campaign excludes this address or its domain.',
};
const LIST_EXCLUDED: EnrichmentIssue = {
  field: 'person',
  message:
    'This person is on a lead list the campaign excludes: not added to its list.',
};

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1);
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * Saves people in order and says what happened to each:
 * - EXCLUDED: the address, or its domain, is on the workspace's do-not-contact list or among the
 *   campaign's exclusions; nothing is saved;
 * - MATCHED: the workspace already has the person; missing details are filled in;
 * - CREATED: new.
 * A saved person on a lead list the campaign excludes is kept, but marked not to be listed.
 */
export async function saveContacts(
  tx: Tx,
  tenantId: string,
  incoming: readonly (IncomingContact | ReusedContact)[],
  exclusions: ContactExclusions | null,
): Promise<ContactSaveOutcome[]> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contacts:${tenantId}`}, 0))`;
  const reusedIds = incoming.flatMap((c) =>
    c.kind === 'reused' ? [c.contactId] : [],
  );
  const reusedRows = new Map(
    reusedIds.length === 0
      ? []
      : (
          await tx.contact.findMany({
            where: { tenantId, id: { in: reusedIds } },
            select: SELECT,
          })
        ).map((row) => [row.id, row]),
  );
  const emails = unique([
    ...incoming.flatMap((c) =>
      c.kind === 'found' && c.identity.email !== null ? [c.identity.email] : [],
    ),
    ...[...reusedRows.values()].flatMap((row) =>
      row.normalizedEmail === null ? [] : [row.normalizedEmail],
    ),
  ]);
  const domains = unique(emails.map(domainOf).flatMap(domainAndParents));
  const suppressions =
    emails.length === 0
      ? []
      : await tx.suppression.findMany({
          where: {
            tenantId,
            OR: [
              { normalizedEmail: { in: emails } },
              { normalizedDomain: { in: domains } },
            ],
          },
          select: { normalizedEmail: true, normalizedDomain: true },
        });
  const suppressedEmails = new Set(
    suppressions.flatMap((row) =>
      row.normalizedEmail === null ? [] : [row.normalizedEmail],
    ),
  );
  const suppressedDomains = new Set(
    suppressions.flatMap((row) =>
      row.normalizedDomain === null ? [] : [row.normalizedDomain],
    ),
  );
  const excludedEmails = new Set(exclusions?.emails ?? []);
  const excludedDomains = new Set(exclusions?.domains ?? []);

  /** Why an address may not be saved for this run, if it may not. */
  const blocked = (email: string | null): EnrichmentIssue | null => {
    if (email === null) {
      return null;
    }
    const parents = domainAndParents(domainOf(email));
    if (
      suppressedEmails.has(email) ||
      parents.some((d) => suppressedDomains.has(d))
    ) {
      return SUPPRESSED;
    }
    if (
      excludedEmails.has(email) ||
      parents.some((d) => excludedDomains.has(d))
    ) {
      return CAMPAIGN_EXCLUDED;
    }
    return null;
  };

  /** Saved people on a lead list the campaign excludes are kept off its list. */
  async function listIssues(contactId: string): Promise<EnrichmentIssue[]> {
    const lists = exclusions?.leadListIds ?? [];
    if (lists.length === 0) {
      return [];
    }
    const member = await tx.leadListMember.findFirst({
      where: { tenantId, contactId, leadListId: { in: [...lists] } },
      select: { contactId: true },
    });
    return member === null ? [] : [LIST_EXCLUDED];
  }

  async function findExisting(
    contact: IncomingContact,
  ): Promise<{ row: Existing; by: ContactMatch } | null> {
    const { identity, source } = contact;
    if (source.externalId !== null) {
      const mapped = await tx.sourceRecord.findFirst({
        where: {
          tenantId,
          provider: source.provider,
          externalId: source.externalId,
          contactId: { not: null },
        },
        orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
        select: { contact: { select: SELECT } },
      });
      if (mapped?.contact != null) {
        return { row: mapped.contact, by: 'provider' };
      }
    }
    if (identity.email !== null) {
      const row = await tx.contact.findUnique({
        where: {
          tenantId_normalizedEmail: {
            tenantId,
            normalizedEmail: identity.email,
          },
        },
        select: SELECT,
      });
      if (row !== null) {
        return { row, by: 'email' };
      }
    }
    if (identity.linkedinUrl !== null) {
      const row = await tx.contact.findFirst({
        where: { tenantId, linkedinUrl: identity.linkedinUrl },
        orderBy: { id: 'asc' },
        select: SELECT,
      });
      if (row !== null) {
        return { row, by: 'linkedin' };
      }
    }
    // The same name at the same company is the same person only when no address tells them
    // apart: one of the two has none.
    const row = await tx.contact.findFirst({
      where: {
        tenantId,
        organizationId: contact.organizationId,
        nameKey: identity.nameKey,
        ...(identity.email === null ? {} : { normalizedEmail: null }),
      },
      orderBy: { id: 'asc' },
      select: SELECT,
    });
    return row === null ? null : { row, by: 'name' };
  }

  /** Only details the contact doesn't have yet. An address another contact has stays there. */
  async function missingDetails(
    existing: Existing,
    contact: IncomingContact,
  ): Promise<Prisma.ContactUpdateInput> {
    const { identity } = contact;
    const fill: Prisma.ContactUpdateInput = {};
    if (existing.firstName === null) {
      fill.firstName = identity.firstName;
    }
    if (existing.lastName === null) {
      fill.lastName = identity.lastName;
    }
    if (existing.title === null && contact.title !== null) {
      fill.title = contact.title;
    }
    if (existing.linkedinUrl === null && identity.linkedinUrl !== null) {
      fill.linkedinUrl = identity.linkedinUrl;
    }
    if (existing.nameKey === null) {
      fill.nameKey = identity.nameKey;
    }
    if (existing.organizationId === null) {
      fill.organization = {
        connect: {
          tenantId_id: { tenantId, id: contact.organizationId },
        },
      };
    }
    if (existing.normalizedEmail === null && identity.email !== null) {
      const holder = await tx.contact.findUnique({
        where: {
          tenantId_normalizedEmail: {
            tenantId,
            normalizedEmail: identity.email,
          },
        },
        select: { id: true },
      });
      if (holder === null) {
        fill.email = identity.email;
        fill.normalizedEmail = identity.email;
        fill.emailDomain = domainOf(identity.email);
      }
    }
    return fill;
  }

  const outcomes: ContactSaveOutcome[] = [];
  for (const contact of incoming) {
    if (contact.kind === 'reused') {
      const row = reusedRows.get(contact.contactId);
      if (row === undefined) {
        // Deleted since it was found: nothing to link (the caller records it as failed).
        outcomes.push({
          outcome: 'FAILED',
          issues: [
            { field: 'person', message: 'The contact no longer exists.' },
          ],
        });
        continue;
      }
      const issue = blocked(row.normalizedEmail);
      outcomes.push(
        issue !== null
          ? { outcome: 'EXCLUDED', issues: [issue] }
          : {
              outcome: 'MATCHED',
              contactId: row.id,
              matchedBy: 'provider',
              email: row.normalizedEmail,
              notListed: await listIssues(row.id),
            },
      );
      continue;
    }
    const issue = blocked(contact.identity.email);
    if (issue !== null) {
      outcomes.push({ outcome: 'EXCLUDED', issues: [issue] });
      continue;
    }
    const found = await findExisting(contact);
    if (found !== null) {
      const fill = await missingDetails(found.row, contact);
      if (Object.keys(fill).length > 0) {
        await tx.contact.update({
          where: { tenantId_id: { tenantId, id: found.row.id } },
          data: fill,
        });
      }
      const email =
        found.row.normalizedEmail ??
        (typeof fill.normalizedEmail === 'string'
          ? fill.normalizedEmail
          : null);
      // An address the person had before stays theirs.
      const notListed = await listIssues(found.row.id);
      outcomes.push({
        outcome: 'MATCHED',
        contactId: found.row.id,
        matchedBy: found.by,
        email,
        notListed,
      });
      continue;
    }
    const { identity } = contact;
    const created = await tx.contact.create({
      data: {
        tenantId,
        organizationId: contact.organizationId,
        firstName: identity.firstName,
        lastName: identity.lastName,
        nameKey: identity.nameKey,
        title: contact.title,
        email: identity.email,
        normalizedEmail: identity.email,
        emailDomain: identity.email === null ? null : domainOf(identity.email),
        linkedinUrl: identity.linkedinUrl,
      },
      select: { id: true },
    });
    outcomes.push({
      outcome: 'CREATED',
      contactId: created.id,
      matchedBy: null,
      email: identity.email,
      notListed: [],
    });
  }
  return outcomes;
}

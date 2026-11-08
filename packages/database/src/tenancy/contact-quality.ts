// Contact quality (task 08C, docs/decisions.md D-08C-05): the stored facts about a contact's data
// (the newest record it came from, its role match, the newest check of its address, its manual
// rechecks), read for many contacts at once and judged by the shared contactQuality. Nothing is
// cached or stored as a verdict: every read decides again. Every query is filtered by the tenant.
import {
  CONTACT_SOURCE_PROVIDERS,
  contactQuality,
  type ContactQuality,
  type ContactQualityFacts,
  type EmailVerificationStatus,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** The job a manual recheck queues; its payload is only the contact id. */
export const RECHECK_TASK_TYPE = 'contact_verification.recheck';

/** Stored statuses in the words of an email check (D-08A-04). */
export const CHECK_STATUS = {
  VALID: 'verified',
  RISKY: 'risky',
  UNKNOWN: 'unknown',
  INVALID: 'invalid',
} as const satisfies Record<string, EmailVerificationStatus>;

/** What a person record's payload says about the source; anything else is ignored. */
const sourcePayloadSchema = z.looseObject({
  attribution: z.string().max(300).nullish(),
  providerClaim: z.enum(['provider_verified', 'provider_unverified']).nullish(),
});

const isSourceProvider = (
  value: string,
): value is (typeof CONTACT_SOURCE_PROVIDERS)[number] =>
  (CONTACT_SOURCE_PROVIDERS as readonly string[]).includes(value);

/** Recheck tasks of a contact are keyed by this prefix. */
export const recheckKeyPrefix = (contactId: string) =>
  `contact_recheck:${contactId}:`;

/** The quality of each contact (missing ids are left out). */
export async function contactQualities(
  db: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  contactIds: readonly string[],
  now: Date,
): Promise<Map<string, ContactQuality>> {
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) {
    return new Map();
  }
  const contacts = await db.contact.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, normalizedEmail: true },
  });
  // Newest record first, per contact. A reused record (task 08C) repeats an earlier lookup; the
  // lookup itself is the source.
  const records = await db.sourceRecord.findMany({
    where: {
      tenantId,
      contactId: { in: ids },
      NOT: { payload: { path: ['reused'], equals: true } },
    },
    orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
    distinct: ['contactId'],
    select: {
      contactId: true,
      provider: true,
      fetchedAt: true,
      confidence: true,
      payload: true,
    },
  });
  const checks = await db.verification.findMany({
    where: { tenantId, contactId: { in: ids } },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    select: {
      contactId: true,
      normalizedEmail: true,
      status: true,
      reason: true,
      provider: true,
      checkedAt: true,
    },
    take: ids.length * 20,
  });
  const rechecks = await db.jobTask.findMany({
    where: {
      tenantId,
      taskType: RECHECK_TASK_TYPE,
      OR: ids.map((id) => ({
        idempotencyKey: { startsWith: recheckKeyPrefix(id) },
      })),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      idempotencyKey: true,
      status: true,
      createdAt: true,
      lastErrorCode: true,
    },
    take: ids.length * 5,
  });

  const result = new Map<string, ContactQuality>();
  for (const contact of contacts) {
    const record = records.find((r) => r.contactId === contact.id);
    const payload =
      record === undefined
        ? null
        : sourcePayloadSchema.safeParse(record.payload);
    const check =
      contact.normalizedEmail === null
        ? undefined
        : checks.find(
            (c) =>
              c.contactId === contact.id &&
              c.normalizedEmail === contact.normalizedEmail,
          );
    const own = rechecks.filter((task) =>
      task.idempotencyKey.startsWith(recheckKeyPrefix(contact.id)),
    );
    const last = own[0];
    const facts: ContactQualityFacts = {
      email: contact.normalizedEmail,
      source:
        record === undefined || !isSourceProvider(record.provider)
          ? null
          : {
              provider: record.provider,
              attribution:
                payload?.success === true
                  ? (payload.data.attribution ?? null)
                  : null,
              retrievedAt: record.fetchedAt,
              confidence: record.confidence,
              providerClaim:
                payload?.success === true
                  ? (payload.data.providerClaim ?? null)
                  : null,
            },
      check:
        check === undefined
          ? null
          : {
              address: check.normalizedEmail,
              status: CHECK_STATUS[check.status],
              reason: check.reason,
              provider: check.provider.toUpperCase(),
              checkedAt: check.checkedAt,
            },
      recheck: {
        pending: own.some(
          (task) => task.status === 'PENDING' || task.status === 'RUNNING',
        ),
        lastRequestedAt: last?.createdAt ?? null,
        lastErrorCode: last?.status === 'FAILED' ? last.lastErrorCode : null,
      },
    };
    result.set(contact.id, contactQuality(facts, now));
  }
  return result;
}

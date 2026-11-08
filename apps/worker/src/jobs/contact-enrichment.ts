// The contact enrichment jobs (task 08C, docs/decisions.md D-08C-*). A queue message names a job
// task; claimJob loads it and gives a scope of the task's own workspace.
//
// An enrichment run handles its companies one at a time:
// 1. The repository says which company is next, or why it is skipped (no domain, a country
//    outside the targets, its domain on the do-not-contact list or excluded by the campaign).
// 2. A paid provider's work reserves the workspace's budget first (LEAD_ENRICHMENTS), under a key
//    of the run, the company and the attempt.
// 3. The ContactEnrichmentAgent finds and ranks people for the ICP's roles. People the workspace
//    looked up recently are reused, so they are neither looked up nor paid for again.
// 4. Addresses without a recent check are checked (only the free fake verifier exists, O-35).
//    Without a verification service the addresses stay unverified (fails closed).
// 5. The company is saved in one transaction with the usage it used (saveCompany): a retry after
//    a failure saves and charges nothing twice.
// A recheck task checks one contact's address again.
import {
  claimJob,
  defineWorker,
  ENRICHMENT_TASK_TYPE,
  NoEntitledSubscriptionError,
  RECHECK_TASK_TYPE,
  UsageLimitExceededError,
  type CheckInput,
  type HoldInput,
  type WorkerContext,
  type PersonInput,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  ContactEnrichmentAgent,
  ProviderError,
  type ContactEnrichmentProvider,
  type EmailVerificationProvider,
  type PeopleSearchProvider,
} from '@lead-fennec-ai/integrations';
import type { EmailCheck } from '@lead-fennec-ai/shared';
import { z } from 'zod';

export const CONTACT_ENRICHMENT_WORKER = defineWorker({
  name: 'contact_enrichment',
  taskTypes: [ENRICHMENT_TASK_TYPE, RECHECK_TASK_TYPE],
});

export interface EnrichmentTaskDeps {
  /** The environment's people providers; may throw LiveProvidersUnavailableError. */
  readonly providers: () => {
    readonly peopleSearch: PeopleSearchProvider;
    readonly contactEnrichment: ContactEnrichmentProvider;
  };
  /** The environment's verifier, or null when it has none (addresses stay unverified). */
  readonly verifier: () => EmailVerificationProvider | null;
  readonly now?: () => Date;
  /** Seconds before a retry when the provider gives no time. Default 60. */
  readonly retryDelaySeconds?: number;
}

export type EnrichmentTaskOutcome =
  'completed' | 'cancelled' | 'skipped' | 'retrying' | 'failed';

const runPayloadSchema = z.object({ importId: z.uuid() }).strict();
const recheckPayloadSchema = z.object({ contactId: z.uuid() }).strict();

/**
 * Runs one enrichment or recheck task to the end, to a retry, or to a failure. Throws
 * JobRejectedError for a message that must be dropped (the caller logs the reason only).
 */
export async function runEnrichmentTask(
  prisma: PrismaClient,
  message: unknown,
  deps: EnrichmentTaskDeps,
): Promise<EnrichmentTaskOutcome> {
  const now = deps.now ?? (() => new Date());
  const ctx = await claimJob(prisma, CONTACT_ENRICHMENT_WORKER, message, {
    now,
  });
  return ctx.task.taskType === RECHECK_TASK_TYPE
    ? runRecheck(ctx, deps, now)
    : runEnrichment(ctx, deps, now);
}

/** Checks addresses one by one; a failed check is recorded, never a status. */
async function checkAddresses(
  verifier: EmailVerificationProvider,
  addresses: readonly string[],
): Promise<Map<string, CheckInput>> {
  const checks = new Map<string, CheckInput>();
  for (const address of addresses) {
    try {
      const result = await verifier.verify(address);
      const check: EmailCheck = {
        address: result.address,
        status: result.status,
        reason: result.reason,
        provider: verifier.source,
        checkedAt: result.checkedAt.toISOString(),
      };
      checks.set(address, { kind: 'checked', check });
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }
      checks.set(address, {
        kind: 'failed',
        code: error.code,
        retryable: error.retryable,
      });
    }
  }
  return checks;
}

async function runEnrichment(
  ctx: WorkerContext,
  deps: EnrichmentTaskDeps,
  now: () => Date,
): Promise<EnrichmentTaskOutcome> {
  const parsed = runPayloadSchema.safeParse(ctx.task.payload);
  if (!parsed.success) {
    await ctx.fail({ errorCode: 'invalid_payload' });
    return 'failed';
  }
  const { importId } = parsed.data;
  const { enrichment, usage } = ctx.scope;
  const attempt = String(ctx.task.attemptCount);
  // The hold of the company being worked on: settled with its save, or released.
  let held: HoldInput | null = null;

  const releaseHeld = async () => {
    const open = held;
    held = null;
    if (open !== null) {
      await usage.release(open.reservationId).catch(() => undefined);
    }
  };
  const failRun = async (errorCode: string) => {
    await releaseHeld();
    await enrichment.fail(importId, errorCode, true);
    await ctx.fail({ errorCode });
    return 'failed' as const;
  };

  try {
    const start = await enrichment.begin(importId);
    if (start.state === 'stopped') {
      await ctx.complete();
      return start.status === 'CANCELLED' ? 'cancelled' : 'skipped';
    }
    if (start.state === 'run') {
      const { peopleSearch, contactEnrichment } = deps.providers();
      if (
        peopleSearch.source !== start.provider ||
        contactEnrichment.source !== start.provider
      ) {
        return await failRun('provider_mismatch');
      }
      const verifier = deps.verifier();
      const paid = start.provider !== 'FAKE';
      const agent = new ContactEnrichmentAgent(peopleSearch, contactEnrichment);
      for (;;) {
        const step = await enrichment.nextCompany(importId);
        if (step.state === 'stopped') {
          await ctx.complete();
          return 'cancelled';
        }
        if (step.state === 'done') {
          break;
        }
        if (step.skip !== null || step.organization === null) {
          const saved = await enrichment.saveCompany(importId, step.index, {
            kind: 'skipped',
            skip: step.skip ?? {
              outcome: 'FAILED',
              issues: [
                { field: 'company', message: 'The company no longer exists.' },
              ],
            },
          });
          if (saved.state === 'stopped') {
            await ctx.complete();
            return 'cancelled';
          }
          continue;
        }
        const organization = step.organization;
        // Paid work reserves its budget first: at most the people asked for a company.
        if (paid) {
          const hold = await usage.reserve({
            metric: 'LEAD_ENRICHMENTS',
            quantity: start.maxContactsPerCompany,
            idempotencyKey: `contact_enrichment:${importId}:${organization.id}:${attempt}`,
            purpose: 'contact_enrichment.company',
          });
          held = { reservationId: hold.id, used: 0 };
        }
        let known = new Map<string, string>();
        const run = await agent.run(
          {
            organization: {
              id: organization.id,
              name: organization.name,
              domain: organization.domain,
            },
            targeting: {
              titles: start.targeting.titles,
              seniorities: start.targeting.seniorities,
            },
            maxContacts: start.maxContactsPerCompany,
          },
          {
            known: async (ids) => {
              known = await enrichment.knownPeople(start.provider, ids);
              return new Set(known.keys());
            },
          },
        );
        if (held !== null) {
          // As the provider reports it, else one a person looked up and matched.
          held = {
            reservationId: held.reservationId,
            used: Math.min(
              start.maxContactsPerCompany,
              Math.ceil(
                run.usage.enrichmentCredits ??
                  run.records.size - run.usage.unmatched,
              ),
            ),
          };
        }

        // Addresses without a recent check are checked; recent ones aren't (or paid for) again.
        const accepted = run.result.ok ? run.result.contacts : [];

        const addresses = [
          ...new Set(
            accepted.flatMap((contact) =>
              contact.email === null ? [] : [contact.email.address],
            ),
          ),
        ];
        const fresh = await enrichment.freshChecks(addresses);
        const toCheck = addresses.filter((address) => !fresh.has(address));
        let checks = new Map<string, CheckInput>();
        // Only the free fake verifier exists (O-35). A live one must reserve EMAIL_VERIFICATIONS
        // here first and pass the hold with the company, like the lookups above.
        if (verifier !== null && toCheck.length > 0) {
          checks = await checkAddresses(verifier, toCheck);
        }

        const records = [...run.records.entries()];
        const people: PersonInput[] = [];
        for (const contact of accepted) {
          const id = contact.provenance.externalId;
          const record = id === null ? undefined : run.records.get(id);
          const address = contact.email?.address ?? null;
          people.push({
            kind: 'accepted',
            contact,
            received: {
              search: record?.person.raw ?? {},
              enrichment: record?.enrichment ?? null,
              providerClaim: record?.providerClaim ?? null,
              emailDropped: record?.emailDropped ?? null,
            },
            check:
              address === null
                ? { kind: 'none' }
                : fresh.has(address)
                  ? { kind: 'fresh' }
                  : verifier === null
                    ? { kind: 'unavailable' }
                    : (checks.get(address) ?? { kind: 'unavailable' }),
          });
        }
        for (const entry of run.reused) {
          const contactId = known.get(entry.person.externalId);
          if (contactId === undefined) {
            continue;
          }
          people.push({
            kind: 'reused',
            contactId,
            externalId: entry.person.externalId,
            name: [entry.person.firstName, entry.person.lastName]
              .filter((part) => part !== null)
              .join(' '),
            title: entry.person.title,
            relevance: entry.relevance,
            retrievedAt: entry.retrievedAt,
            search: entry.person.raw,
          });
        }
        // Refused records, by their place in the agent's answer (the order looked up); a refused
        // answer as a whole refuses each of them.
        const result = run.result;
        const rejected = result.ok
          ? result.rejected
          : records.map((_, index) => ({ index, issues: result.issues }));
        for (const refusal of rejected) {
          const entry = records[refusal.index];
          if (entry === undefined) {
            continue;
          }
          const [externalId, record] = entry;
          people.push({
            kind: 'rejected',
            externalId,
            name: record.person.firstName,
            title: record.person.title,
            retrievedAt: record.retrievedAt,
            issues: refusal.issues,
            received: {
              search: record.person.raw,
              enrichment: record.enrichment,
              providerClaim: record.providerClaim,
              emailDropped: record.emailDropped,
            },
          });
        }
        const holds = held === null ? [] : [held];
        held = null;
        const saved = await enrichment.saveCompany(importId, step.index, {
          kind: 'enriched',
          people,
          holds,
        });
        if (saved.state === 'stopped') {
          await ctx.complete();
          return 'cancelled';
        }
      }
    }
    const finished = await enrichment.finish(importId);
    await ctx.complete();
    return finished.status === 'CANCELLED' ? 'cancelled' : 'completed';
  } catch (error) {
    await releaseHeld();
    if (error instanceof ProviderError) {
      if (error.retryable && ctx.task.attemptCount < ctx.task.maxAttempts) {
        const wait = error.retryAfterSeconds ?? deps.retryDelaySeconds ?? 60;
        await enrichment.fail(importId, error.code, false);
        await ctx.fail({
          errorCode: error.code,
          retryAt: new Date(now().getTime() + wait * 1000),
        });
        return 'retrying';
      }
      return await failRun(error.code);
    }
    if (error instanceof UsageLimitExceededError) {
      return await failRun('usage_limit_reached');
    }
    if (error instanceof NoEntitledSubscriptionError) {
      return await failRun('no_entitled_plan');
    }
    if (
      error instanceof Error &&
      error.name === 'LiveProvidersUnavailableError'
    ) {
      return await failRun('provider_unavailable');
    }
    // Unexpected: the run fails closed, and the error goes to the caller's log.
    await failRun('internal_error').catch(() => undefined);
    throw error;
  }
}

async function runRecheck(
  ctx: WorkerContext,
  deps: EnrichmentTaskDeps,
  now: () => Date,
): Promise<EnrichmentTaskOutcome> {
  const parsed = recheckPayloadSchema.safeParse(ctx.task.payload);
  if (!parsed.success) {
    await ctx.fail({ errorCode: 'invalid_payload' });
    return 'failed';
  }
  const { contactId } = parsed.data;
  const { enrichment } = ctx.scope;
  const address = await enrichment.beginRecheck(contactId);
  if (address === null) {
    await ctx.complete();
    return 'skipped';
  }
  const verifier = deps.verifier();
  if (verifier === null) {
    // Fails closed: without a verification service nothing is checked (O-35).
    await ctx.fail({ errorCode: 'verification_unavailable' });
    return 'failed';
  }
  // Only the free fake verifier exists (O-35); a live one must reserve EMAIL_VERIFICATIONS first.
  const checks = await checkAddresses(verifier, [address]);
  const result = checks.get(address);
  if (result?.kind !== 'checked') {
    const failure = result?.kind === 'failed' ? result : null;
    if (
      failure !== null &&
      failure.retryable &&
      ctx.task.attemptCount < ctx.task.maxAttempts
    ) {
      await ctx.fail({
        errorCode: failure.code,
        retryAt: new Date(
          now().getTime() + (deps.retryDelaySeconds ?? 60) * 1000,
        ),
      });
      return 'retrying';
    }
    await ctx.fail({ errorCode: failure?.code ?? 'check_failed' });
    return 'failed';
  }
  await enrichment.saveRecheck(contactId, result.check, null);
  await ctx.complete();
  return 'completed';
}

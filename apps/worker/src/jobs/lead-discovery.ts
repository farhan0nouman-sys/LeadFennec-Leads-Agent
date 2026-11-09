// The organization search job (task 07C, docs/decisions.md D-07C-01 and D-07C-02). A queue
// message names a job task; claimJob loads it and gives a scope of the task's own workspace.
// The search runs page by page through LeadDiscoveryService. Each page is saved in one
// transaction (companies, results, counts, resume token), so an interrupted run resumes from
// the last saved page with nothing duplicated. A paid provider's page is paid for from the
// workspace's usage budget first. Provider errors are retried later or fail the run with a
// code; cancellation is seen before every page is saved.
import {
  claimJob,
  defineWorker,
  DISCOVERY_TASK_TYPE,
  NoEntitledSubscriptionError,
  UsageLimitExceededError,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  LeadDiscoveryService,
  ProviderError,
  type DiscoveryPage,
  type OrganizationSearchProvider,
} from '@lead-fennec-ai/integrations';
import { z } from 'zod';

export const LEAD_DISCOVERY_WORKER = defineWorker({
  name: 'lead_discovery',
  taskTypes: [DISCOVERY_TASK_TYPE],
});

export interface DiscoveryTaskDeps {
  /** A provider for this run: it must be the one the search was requested from. */
  readonly provider: () => OrganizationSearchProvider;
  readonly now?: () => Date;
  /** Seconds before a retry when the provider gives no time. Default 60. */
  readonly retryDelaySeconds?: number;
}

export type DiscoveryTaskOutcome =
  'completed' | 'cancelled' | 'skipped' | 'retrying' | 'failed';

const payloadSchema = z.object({ importId: z.uuid() }).strict();

/**
 * Runs one search task to the end, to a retry, or to a failure. Throws JobRejectedError for a
 * message that must be dropped (the caller logs the reason, never the message).
 */
export async function runDiscoveryTask(
  prisma: PrismaClient,
  message: unknown,
  deps: DiscoveryTaskDeps,
): Promise<DiscoveryTaskOutcome> {
  const now = deps.now ?? (() => new Date());
  const ctx = await claimJob(prisma, LEAD_DISCOVERY_WORKER, message, { now });
  const parsed = payloadSchema.safeParse(ctx.task.payload);
  if (!parsed.success) {
    await ctx.fail({ errorCode: 'invalid_payload' });
    return 'failed';
  }
  const { importId } = parsed.data;
  const { discovery, usage } = ctx.scope;

  const failRun = async (errorCode: string) => {
    await discovery.failSearch(importId, errorCode, true);
    await ctx.fail({ errorCode });
    return 'failed' as const;
  };

  try {
    const start = await discovery.beginSearch(importId);
    if (start.state === 'stopped') {
      await ctx.complete();
      return start.status === 'CANCELLED' ? 'cancelled' : 'skipped';
    }
    if (start.state === 'run') {
      const provider = deps.provider();
      if (provider.source !== start.provider) {
        return await failRun('provider_mismatch');
      }
      const paid = provider.source !== 'FAKE';
      const pages = new LeadDiscoveryService(provider).pages(
        start.plan,
        start.resume,
      );
      let pageNumber = start.pagesFetched;
      for (;;) {
        pageNumber += 1;
        // Paid work reserves its budget first (one credit a page).
        const hold = paid
          ? await usage.reserve({
              metric: 'ORGANIZATION_SEARCH_CREDITS',
              quantity: 1,
              idempotencyKey: `discovery:${importId}:page:${String(pageNumber)}`,
              purpose: 'lead_discovery.page',
            })
          : null;
        let step: IteratorResult<DiscoveryPage>;
        try {
          step = await pages.next();
        } catch (error) {
          if (hold !== null) {
            await usage.release(hold.id);
          }
          throw error;
        }
        if (step.done === true) {
          if (hold !== null) {
            await usage.release(hold.id);
          }
          break;
        }
        if (hold !== null) {
          await usage.commit(hold.id, Math.min(step.value.creditsUsed ?? 1, 1));
        }
        const saved = await discovery.saveSearchPage(importId, step.value);
        if (saved.state === 'stopped') {
          await ctx.complete();
          return 'cancelled';
        }
        if (saved.state === 'done') {
          break;
        }
      }
    }
    const finished = await discovery.finishSearch(importId);
    await ctx.complete();
    return finished.status === 'CANCELLED' ? 'cancelled' : 'completed';
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.retryable && ctx.task.attemptCount < ctx.task.maxAttempts) {
        const wait = error.retryAfterSeconds ?? deps.retryDelaySeconds ?? 60;
        await discovery.failSearch(importId, error.code, false);
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
    // Unexpected: the run fails closed, and the error goes to the caller's log.
    await failRun('internal_error').catch(() => undefined);
    throw error;
  }
}

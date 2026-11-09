// The website research job (task 09C, docs/decisions.md D-09C-01 to D-09C-03). A queue message
// names a job task; claimJob loads it and gives a scope of the task's own workspace.
//
// 1. Pages: the company's start page and up to three same-site pages it links to (chosen by
//    application code), each read through the safe fetcher (09A: addresses, robots.txt, access
//    lists, limits) or, without a refresh, taken from a copy stored in the last 7 days. Every
//    page read is stored as a source record; a page that can't be read is recorded with why.
// 2. Extracts: bounded pieces of those pages (pageExtracts).
// 3. Cache: when the model would see exactly what an earlier version saw, that version is
//    reused as a new version, without a model call.
// 4. Otherwise the WebsiteResearchAgent runs; a paid model reserves AI tokens first and commits
//    what it used.
// Each outcome is saved as a new version with its extracts as dated evidence.
import {
  claimJob,
  defineWorker,
  NoEntitledSubscriptionError,
  RESEARCH_TASK_TYPE,
  researchTaskPayloadSchema,
  UsageLimitExceededError,
  type PrismaClient,
  type RunExtract,
  type StoredPage,
  type TenantScope,
} from '@lead-fennec-ai/database';
import {
  buildResearchInput,
  pageExtracts,
  pickResearchLinks,
  RESEARCH_OUTPUT_TOKENS,
  researchInputSha256,
  WEBSITE_RESEARCH_INSTRUCTIONS,
  WebsiteResearchAgent,
  type WebsiteResearchResult,
} from '@lead-fennec-ai/ai-agents';
import {
  LiveProvidersUnavailableError,
  ProviderError,
  WebsiteFetchError,
  type ModelCostEvent,
  type ModelProvider,
  type WebsiteFetcher,
  type WebsitePage,
} from '@lead-fennec-ai/integrations';
import {
  RESEARCH_FRESHNESS,
  RESEARCH_MAX_PAGES,
  type ResearchPage,
} from '@lead-fennec-ai/shared';

export const WEBSITE_RESEARCH_WORKER = defineWorker({
  name: 'website_research',
  taskTypes: [RESEARCH_TASK_TYPE],
});

export interface ResearchTaskDeps {
  /** One fetcher for the process (its per-host limits and robots cache are shared). */
  readonly fetcher: () => WebsiteFetcher;
  /** The environment's model provider; may throw LiveProvidersUnavailableError. */
  readonly model: () => ModelProvider;
  readonly now?: () => Date;
  /** Seconds before a retry when the error gives no time. Default 60. */
  readonly retryDelaySeconds?: number;
}

export type ResearchTaskOutcome =
  'completed' | 'reused' | 'no_content' | 'skipped' | 'retrying' | 'failed';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_MAX_AGE_MS = RESEARCH_FRESHNESS.pageMaxAgeDays * DAY_MS;

/** Something the run can wait for: retry later. */
class RetryLater extends Error {
  constructor(
    readonly code: string,
    readonly afterSeconds: number | null,
  ) {
    super(code);
    this.name = 'RetryLater';
  }
}

const fetched = (page: WebsitePage) => ({
  requestedUrl: page.requestedUrl,
  finalUrl: page.finalUrl,
  status: page.status,
  contentType: page.contentType,
  retrievedAt: page.retrievedAt,
  contentSha256: page.contentSha256,
  textSha256: page.textSha256,
  title: page.title,
  text: page.text,
  textTruncated: page.textTruncated,
  links: page.links,
});

/** Reads one page: a fresh stored copy unless refreshing, else through the fetcher. */
async function readPage(
  scope: TenantScope,
  fetcher: WebsiteFetcher,
  organizationId: string,
  url: string,
  refresh: boolean,
  start: boolean,
): Promise<{
  readonly stored: StoredPage | null;
  readonly record: ResearchPage;
}> {
  if (!refresh) {
    const copy = await scope.research.freshPage(
      organizationId,
      url,
      PAGE_MAX_AGE_MS,
    );
    if (copy !== null) {
      return {
        stored: copy,
        record: {
          url,
          outcome: 'reused',
          errorCode: null,
          sourceRecordId: copy.sourceRecordId,
          retrievedAt: copy.retrievedAt.toISOString(),
          contentSha256: copy.contentSha256,
        },
      };
    }
  }
  try {
    const page = await fetcher.fetchPage({ url, cacheScope: scope.tenantId });
    const stored = await scope.research.savePage(organizationId, fetched(page));
    return {
      stored,
      record: {
        url,
        outcome: 'fetched',
        errorCode: null,
        sourceRecordId: stored.sourceRecordId,
        retrievedAt: stored.retrievedAt.toISOString(),
        contentSha256: stored.contentSha256,
      },
    };
  } catch (error) {
    if (!(error instanceof WebsiteFetchError)) {
      throw error;
    }
    // The start page decides the run: a temporary failure there is retried later.
    if (start && error.retryable) {
      throw new RetryLater(error.code, null);
    }
    return {
      stored: null,
      record: {
        url,
        outcome: 'failed',
        errorCode: error.code,
        sourceRecordId: null,
        retrievedAt: null,
        contentSha256: null,
      },
    };
  }
}

/** Tokens to commit for a hold: what the attempts used, or the whole hold when unknown. */
export const usedTokens = (
  events: readonly ModelCostEvent[],
  held: bigint,
): bigint => {
  // An attempt the provider may have billed without saying how much counts as the whole hold.
  if (
    events.some((event) => event.billing === 'unknown' && event.usage === null)
  ) {
    return held;
  }
  const used = events.reduce(
    (sum, event) =>
      sum +
      BigInt(
        (event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0),
      ),
    0n,
  );
  return used < held ? used : held;
};

function draftFindings(result: WebsiteResearchResult) {
  return {
    facts: result.verifiedFacts.map((fact) => ({
      field: fact.field,
      value: fact.value,
      confidence: fact.confidence,
      evidence: fact.evidence.map((item) => ({
        label: item.extractId,
        quote: item.quote,
      })),
    })),
    hypotheses: result.hypotheses.map((hypothesis) => ({
      statement: hypothesis.statement,
      labels: [...hypothesis.evidenceIds],
      confidence: hypothesis.confidence,
    })),
    unknownFields: [...result.unknownFields],
    reviewItems: result.reviewItems.map((item) => ({
      reason: item.reason,
      kind: item.kind,
      field: item.field,
      value: item.value === null ? null : item.value.slice(0, 400),
      labels: [...item.extractIds],
    })),
    warnings: result.warnings.map((warning) => ({
      code: warning.code,
      label: warning.extractId,
    })),
    ignoredInstructions: result.ignoredInstructions.map((item) => ({
      label: item.extractId,
      quote: item.quote,
    })),
    confidence: result.confidence,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costMicroUsd: result.usage.costMicroUsd,
      modelCalls: result.usage.events.length,
    },
    model: {
      prompt: result.versions.prompt,
      promptSha256: result.versions.promptSha256,
      schema: result.versions.schema,
      provider: result.versions.provider,
      model: result.versions.model,
    },
  };
}

/**
 * Runs one research task to the end, to a retry, or to a failure. Throws JobRejectedError for a
 * message that must be dropped (the caller logs the reason, never the message).
 */
export async function runResearchTask(
  prisma: PrismaClient,
  message: unknown,
  deps: ResearchTaskDeps,
): Promise<ResearchTaskOutcome> {
  const now = deps.now ?? (() => new Date());
  const ctx = await claimJob(prisma, WEBSITE_RESEARCH_WORKER, message, { now });
  const parsed = researchTaskPayloadSchema.safeParse(ctx.task.payload);
  if (!parsed.success) {
    await ctx.fail({ errorCode: 'invalid_payload' });
    return 'failed';
  }
  const { researchId, campaignId } = parsed.data;
  const { research, usage } = ctx.scope;

  const failRun = async (errorCode: string) => {
    await research.failRun(researchId, errorCode);
    await ctx.fail({ errorCode });
    return 'failed' as const;
  };

  try {
    const begun = await research.beginRun(researchId, campaignId);
    if (begun.state === 'stopped') {
      await ctx.complete();
      return 'skipped';
    }
    const { plan } = begun;
    const orgId = plan.organization.id;
    const run = { fields: [...plan.fields], context: plan.context };

    // 1. Pages.
    const fetcher = deps.fetcher();
    const home = await readPage(
      ctx.scope,
      fetcher,
      orgId,
      plan.startUrl,
      plan.refresh,
      true,
    );
    const records: ResearchPage[] = [home.record];
    const pages: StoredPage[] = home.stored === null ? [] : [home.stored];
    if (home.stored !== null) {
      for (const url of pickResearchLinks(
        home.stored.links,
        home.stored.finalUrl,
        RESEARCH_MAX_PAGES - 1,
      )) {
        const next = await readPage(
          ctx.scope,
          fetcher,
          orgId,
          url,
          plan.refresh,
          false,
        );
        records.push(next.record);
        if (next.stored !== null) {
          pages.push(next.stored);
        }
      }
    }

    // 2. Extracts, each tied to the stored page it came from.
    const extracts = pageExtracts(
      pages.map((page) => ({
        finalUrl: page.finalUrl,
        title: page.title,
        retrievedAt: page.retrievedAt,
        contentSha256: page.contentSha256,
        text: page.text,
      })),
    );
    if (extracts.length === 0) {
      await research.completeRun(researchId, {
        run,
        kind: 'no_content',
        pages: records,
      });
      await ctx.complete();
      return 'no_content';
    }
    const runExtracts: RunExtract[] = extracts.map((extract) => {
      const page = pages.find(
        (candidate) =>
          candidate.finalUrl === extract.url &&
          candidate.contentSha256 === extract.contentSha256,
      );
      if (page === undefined) {
        throw new Error('An extract without its page.');
      }
      return {
        label: extract.id,
        sourceRecordId: page.sourceRecordId,
        url: extract.url,
        retrievedAt: extract.retrievedAt,
        contentSha256: extract.contentSha256,
        text: extract.text,
      };
    });

    // 3. Cache: the same inputs as an earlier version reuse it, with no model call.
    let model: ModelProvider;
    try {
      model = deps.model();
    } catch (error) {
      if (error instanceof LiveProvidersUnavailableError) {
        return await failRun('model_unavailable');
      }
      throw error;
    }
    const company = {
      name: plan.organization.name,
      domain: plan.organization.domain,
    };
    const inputSha256 = researchInputSha256({
      provider: model.source,
      model: model.model,
      fields: plan.fields,
      company,
      campaign: plan.context.campaign,
      extracts,
    });
    const reusable = await research.reusable(orgId, inputSha256);
    if (reusable !== null) {
      await research.completeRun(researchId, {
        run,
        kind: 'reuse',
        reuseOf: reusable.id,
        inputSha256,
        pages: records,
        extracts: runExtracts,
      });
      await ctx.complete();
      return 'reused';
    }

    // 4. The model, paid for from the workspace's AI token budget first.
    const input = {
      company,
      campaign: plan.context.campaign,
      fields: [...plan.fields],
      extracts,
    };
    const paid = model.source !== 'FAKE';
    const estimate =
      Math.ceil(
        (WEBSITE_RESEARCH_INSTRUCTIONS.length +
          buildResearchInput(input).length) /
          3,
      ) + RESEARCH_OUTPUT_TOKENS.default;
    const hold = paid
      ? await usage.reserve({
          metric: 'AI_TOKENS',
          quantity: estimate,
          idempotencyKey: `research:${researchId}:attempt:${String(ctx.task.attemptCount)}`,
          purpose: 'website_research.run',
        })
      : null;
    const events: ModelCostEvent[] = [];
    let result: WebsiteResearchResult;
    try {
      result = await new WebsiteResearchAgent({ model, now }).run(input, {
        onCost: (event) => events.push(event),
      });
    } catch (error) {
      if (hold !== null) {
        const used = usedTokens(events, hold.quantity);
        await (used > 0n
          ? usage.commit(hold.id, used)
          : usage.release(hold.id));
      }
      throw error;
    }
    if (hold !== null) {
      await usage.commit(hold.id, usedTokens(events, hold.quantity));
    }
    if (result.status === 'no_content') {
      await research.completeRun(researchId, {
        run,
        kind: 'no_content',
        pages: records,
      });
      await ctx.complete();
      return 'no_content';
    }
    await research.completeRun(researchId, {
      run,
      kind: 'model',
      resultStatus:
        result.status === 'review_required' ? 'REVIEW_REQUIRED' : 'COMPLETED',
      inputSha256,
      pages: records,
      extracts: runExtracts,
      findings: draftFindings(result),
    });
    await ctx.complete();
    return 'completed';
  } catch (error) {
    const retry =
      error instanceof RetryLater
        ? error
        : error instanceof ProviderError && error.retryable
          ? new RetryLater(error.code, error.retryAfterSeconds)
          : null;
    if (retry !== null) {
      if (ctx.task.attemptCount < ctx.task.maxAttempts) {
        const wait = retry.afterSeconds ?? deps.retryDelaySeconds ?? 60;
        await research.retryRun(researchId, retry.code);
        await ctx.fail({
          errorCode: retry.code,
          retryAt: new Date(now().getTime() + wait * 1000),
        });
        return 'retrying';
      }
      return await failRun(retry.code);
    }
    if (error instanceof ProviderError) {
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

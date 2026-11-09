// The lead qualification job (task 10C, docs/decisions.md D-10C-*). A queue message names a job
// task; claimJob loads it and gives a scope of the task's own workspace.
//
// 1. Context: the campaign's offer, the person's title, and the verified facts of the company's
//    current research version (task 09C), numbered F1, F2 ...
// 2. The LeadQualificationAgent proposes supported need and timing from those facts; a paid model
//    reserves AI tokens first and commits what it used. Without a model, or without facts, the
//    two factors stay missing.
// 3. The scoring rules assess the other factors, the checked proposals are added, and the score is
//    calculated and saved by application code (scope.scoring.scoreLead).
// 4. The automatic decision is recorded: the rules decide the state from the score, eligibility
//    now and the agent's outcome (scope.qualification.recordAutomatic).
import {
  claimJob,
  defineWorker,
  NoEntitledSubscriptionError,
  QUALIFICATION_TASK_TYPE,
  qualificationTaskPayloadSchema,
  RecordNotFoundError,
  UsageLimitExceededError,
  type LeadScoreProposals,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  buildQualificationInput,
  LEAD_QUALIFICATION_INSTRUCTIONS,
  LeadQualificationAgent,
  QUALIFICATION_OUTPUT_TOKENS,
  type LeadQualificationResult,
} from '@lead-fennec-ai/ai-agents';
import {
  LiveProvidersUnavailableError,
  ProviderError,
  type ModelCostEvent,
  type ModelProvider,
} from '@lead-fennec-ai/integrations';
import {
  LEAD_SCORE_VALUE_CHARS,
  QUALIFICATION_LIMITS,
  QUALIFICATION_MODEL_FACTORS,
  type LeadFactorAssessment,
  type LeadScoreAgentStatus,
  type QualificationInput,
  type WebsiteResearchField,
} from '@lead-fennec-ai/shared';
import { usedTokens } from './website-research.js';

export const LEAD_QUALIFICATION_WORKER = defineWorker({
  name: 'lead_qualification',
  taskTypes: [QUALIFICATION_TASK_TYPE],
});

export interface QualificationTaskDeps {
  /** The environment's model provider; may throw LiveProvidersUnavailableError. */
  readonly model: () => ModelProvider;
  readonly now?: () => Date;
  /** Seconds before a retry when the error gives no time. Default 60. */
  readonly retryDelaySeconds?: number;
}

export type QualificationTaskOutcome = 'qualified' | 'retrying' | 'failed';

const Q = QUALIFICATION_LIMITS;
const clip = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) : text;

/** The agent's result as assessments of its two factors: accepted, unknown or dropped. */
function assessmentsOf(
  result: LeadQualificationResult,
  facts: ReadonlyMap<
    string,
    {
      readonly field: WebsiteResearchField;
      readonly value: string;
      readonly evidenceIds: readonly string[];
    }
  >,
  research: { readonly id: string; readonly version: number } | null,
): LeadFactorAssessment[] {
  return QUALIFICATION_MODEL_FACTORS.map((factor): LeadFactorAssessment => {
    const proposal = result.proposals.find((item) => item.factor === factor);
    if (proposal === undefined) {
      const reasons = result.reviewItems
        .filter((item) => item.factor === factor || item.factor === null)
        .map((item) => item.reason.replace(/_/g, ' '));
      return {
        factor,
        status: 'missing',
        reason: 'not_assessed',
        assessedBy: 'model',
        explanation:
          result.status === 'no_facts'
            ? 'No research facts to read, so the agent was not asked.'
            : clip(
                `The agent's rating didn't check out (${reasons.join(', ') || 'no answer'}). A person should look.`,
                300,
              ),
      };
    }
    if (proposal.level === null || research === null) {
      return {
        factor,
        status: 'missing',
        reason: 'no_data',
        assessedBy: 'model',
        explanation: 'No fact shows this.',
      };
    }
    return {
      factor,
      status: 'assessed',
      level: proposal.level,
      assessedBy: 'model',
      evidence: proposal.factIds.flatMap((id) => {
        const fact = facts.get(id);
        return fact === undefined
          ? []
          : [
              {
                kind: 'research_fact' as const,
                researchId: research.id,
                researchVersion: research.version,
                field: fact.field,
                value: clip(fact.value, LEAD_SCORE_VALUE_CHARS),
                evidenceIds: fact.evidenceIds.slice(0, 3),
              },
            ];
      }),
      explanation: clip(proposal.explanation, Q.maxExplanationChars),
    };
  });
}

/**
 * Runs one qualification task to the end, to a retry, or to a failure. Throws JobRejectedError
 * for a message that must be dropped (the caller logs the reason, never the message).
 */
export async function runQualificationTask(
  prisma: PrismaClient,
  message: unknown,
  deps: QualificationTaskDeps,
): Promise<QualificationTaskOutcome> {
  const now = deps.now ?? (() => new Date());
  const ctx = await claimJob(prisma, LEAD_QUALIFICATION_WORKER, message, {
    now,
  });
  const parsed = qualificationTaskPayloadSchema.safeParse(ctx.task.payload);
  if (!parsed.success) {
    await ctx.fail({ errorCode: 'invalid_payload' });
    return 'failed';
  }
  const { campaignId, contactId } = parsed.data;
  const { qualification, scoring, usage } = ctx.scope;
  try {
    const context = await qualification.context(campaignId, contactId);
    let model: ModelProvider | null;
    try {
      model = deps.model();
    } catch (error) {
      if (!(error instanceof LiveProvidersUnavailableError)) {
        throw error;
      }
      model = null;
    }
    let proposals: LeadScoreProposals | undefined;
    let agentStatus: LeadScoreAgentStatus | null;
    if (model === null) {
      // No model: score with the rules alone, and say so in the decision.
      agentStatus = 'unavailable';
    } else {
      const numbered = context.facts
        .slice(0, Q.maxFacts)
        .map((fact, index) => ({ ...fact, id: `F${String(index + 1)}` }));
      const input: QualificationInput = {
        asOf: now().toISOString(),
        campaign: context.campaign,
        company:
          context.company === null
            ? { name: null, domain: null }
            : {
                name: clip(context.company.name, 200),
                domain: context.company.domain,
              },
        person: {
          title:
            context.person.title === null
              ? null
              : clip(context.person.title, 500),
        },
        facts: numbered.map((fact) => ({
          id: fact.id,
          field: fact.field,
          value: clip(fact.value, Q.maxValueChars),
          quotes: fact.quotes
            .slice(0, Q.maxQuotesPerFact)
            .map((quote) => clip(quote, Q.maxQuoteChars)),
          retrievedAt: fact.retrievedAt?.toISOString() ?? null,
        })),
      };
      const paid = model.source !== 'FAKE' && numbered.length > 0;
      const estimate =
        Math.ceil(
          (LEAD_QUALIFICATION_INSTRUCTIONS.length +
            buildQualificationInput(input).length) /
            3,
        ) + QUALIFICATION_OUTPUT_TOKENS.default;
      const hold = paid
        ? await usage.reserve({
            metric: 'AI_TOKENS',
            quantity: estimate,
            idempotencyKey: `qualification:${ctx.task.id}:attempt:${String(ctx.task.attemptCount)}`,
            purpose: 'lead_qualification.run',
          })
        : null;
      const events: ModelCostEvent[] = [];
      let result: LeadQualificationResult;
      try {
        result = await new LeadQualificationAgent({ model, now }).run(input, {
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
      agentStatus = result.status;
      proposals = {
        assessments: assessmentsOf(
          result,
          new Map(numbered.map((fact) => [fact.id, fact])),
          context.research,
        ),
        agent: {
          status: result.status,
          prompt: result.versions.prompt,
          promptSha256: result.versions.promptSha256,
          schema: result.versions.schema,
          provider: result.versions.provider,
          model: clip(result.versions.model, 200),
          reviewItems: result.reviewItems.slice(0, 20).map((item) => ({
            reason: item.reason,
            factor: item.factor,
          })),
        },
      };
    }
    await scoring.scoreLead(campaignId, contactId, proposals);
    await qualification.recordAutomatic(campaignId, contactId, {
      agentStatus,
    });
    await ctx.complete();
    return 'qualified';
  } catch (error) {
    if (error instanceof ProviderError && error.retryable) {
      if (ctx.task.attemptCount < ctx.task.maxAttempts) {
        const wait = error.retryAfterSeconds ?? deps.retryDelaySeconds ?? 60;
        await ctx.fail({
          errorCode: error.code,
          retryAt: new Date(now().getTime() + wait * 1000),
        });
        return 'retrying';
      }
      await ctx.fail({ errorCode: error.code });
      return 'failed';
    }
    const code =
      error instanceof ProviderError
        ? error.code
        : error instanceof UsageLimitExceededError
          ? 'usage_limit_reached'
          : error instanceof NoEntitledSubscriptionError
            ? 'no_entitled_plan'
            : error instanceof RecordNotFoundError
              ? 'not_found'
              : null;
    if (code !== null) {
      await ctx.fail({ errorCode: code });
      return 'failed';
    }
    // Unexpected: the task fails closed, and the error goes to the caller's log.
    await ctx.fail({ errorCode: 'internal_error' }).catch(() => undefined);
    throw error;
  }
}

// A tenant's subscription and limits (docs/decisions.md D-03C-01, D-03C-03). Application code
// reads plan, status and limits only from here: never from the billing provider at request
// time, and never from a copy elsewhere.
import { z } from 'zod';
import {
  UsageMetric,
  type SubscriptionStatus,
  type PrismaClient,
  type Subscription,
  type TenantLimitOverride,
} from '../generated/prisma/client.js';
import { ActorNotAllowedError, type TenantActor } from './actors.js';
import { writeAuditRecord, type DbClient } from './audit.js';

/** Subscriptions that are not ended (at most one per tenant, subscriptions_one_current_key). */
export const ENDED_SUBSCRIPTION_STATUSES = [
  'CANCELED',
  'INCOMPLETE_EXPIRED',
] as const satisfies readonly SubscriptionStatus[];

/**
 * Statuses that may consume metered usage. PAST_DUE keeps working while the provider retries
 * the payment; INCOMPLETE, UNPAID and PAUSED do not (D-03C-03).
 */
export const ENTITLED_SUBSCRIPTION_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
] as const satisfies readonly SubscriptionStatus[];

export async function findCurrentSubscription(
  db: DbClient,
  tenantId: string,
): Promise<Subscription | null> {
  return db.subscription.findFirst({
    where: { tenantId, status: { notIn: [...ENDED_SUBSCRIPTION_STATUSES] } },
  });
}

/** The override if there is one, else the plan's limit; a metric the plan lacks allows 0. */
export async function findEffectiveLimit(
  db: DbClient,
  tenantId: string,
  planId: string,
  metric: UsageMetric,
): Promise<bigint> {
  const override = await db.tenantLimitOverride.findUnique({
    where: { tenantId_metric: { tenantId, metric } },
  });
  if (override !== null) {
    return override.quantityPerPeriod;
  }
  const planLimit = await db.planLimit.findUnique({
    where: { planId_metric: { planId, metric } },
  });
  return planLimit?.quantityPerPeriod ?? 0n;
}

const limitOverrideSchema = z
  .object({
    metric: z.enum(UsageMetric),
    quantityPerPeriod: z.bigint().nonnegative(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export interface BillingRepository {
  currentSubscription(): Promise<Subscription | null>;
  /** Effective limit per metric for the current subscription; empty without one. */
  effectiveLimits(): Promise<Partial<Record<UsageMetric, bigint>>>;
  /** Platform admins only; written together with an audit record. */
  setLimitOverride(
    input: z.input<typeof limitOverrideSchema>,
  ): Promise<TenantLimitOverride>;
}

export function createBillingRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
): BillingRepository {
  return {
    currentSubscription: () => findCurrentSubscription(prisma, tenantId),
    async effectiveLimits() {
      const subscription = await findCurrentSubscription(prisma, tenantId);
      if (subscription === null) {
        return {};
      }
      const limits: Partial<Record<UsageMetric, bigint>> = {};
      for (const metric of Object.values(UsageMetric)) {
        limits[metric] = await findEffectiveLimit(
          prisma,
          tenantId,
          subscription.planId,
          metric,
        );
      }
      return limits;
    },
    async setLimitOverride(input) {
      if (actor.kind !== 'platform_admin') {
        throw new ActorNotAllowedError('billing.setLimitOverride');
      }
      const { metric, quantityPerPeriod, reason } =
        limitOverrideSchema.parse(input);
      return prisma.$transaction(async (tx) => {
        const override = await tx.tenantLimitOverride.upsert({
          where: { tenantId_metric: { tenantId, metric } },
          create: { tenantId, metric, quantityPerPeriod, reason },
          update: { quantityPerPeriod, reason },
        });
        await writeAuditRecord(tx, tenantId, actor, {
          action: 'limit_override.set',
          targetType: 'tenant_limit_override',
          targetId: override.id,
          reason,
          metadata: { metric, quantityPerPeriod: quantityPerPeriod.toString() },
        });
        return override;
      });
    },
  };
}

// Usage budgets (docs/decisions.md D-03C-03). Application code, not a model or a provider,
// decides whether paid work may start: reserve before the work, then commit what was used or
// release the hold. Reservations of one tenant and metric are serialized with a transaction
// advisory lock, so concurrent reservations cannot overshoot the limit together.
import { z } from 'zod';
import {
  UsageMetric,
  type PrismaClient,
  type UsageReservation,
} from '../generated/prisma/client.js';
import {
  ActorNotAllowedError,
  dottedKeySchema,
  uuidSchema,
  type TenantActor,
} from './actors.js';
import type { DbClient } from './audit.js';
import { requireReadPermissionOrSystem } from './authorization.js';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  findCurrentSubscription,
  findEffectiveLimit,
} from './billing.js';

/** There is no current subscription that may consume metered usage. */
export class NoEntitledSubscriptionError extends Error {
  constructor() {
    super('No active subscription allows metered usage');
    this.name = 'NoEntitledSubscriptionError';
  }
}

export class UsageLimitExceededError extends Error {
  constructor(
    readonly metric: UsageMetric,
    readonly limit: bigint,
    readonly used: bigint,
    readonly requested: bigint,
  ) {
    super(`Usage limit for ${metric} exceeded`);
    this.name = 'UsageLimitExceededError';
  }
}

/** The reservation does not exist in this tenant, or is not in a state for this operation. */
export class ReservationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReservationStateError';
  }
}

const quantitySchema = z.union([
  z.bigint().positive(),
  z.number().int().positive().transform(BigInt),
]);

const reserveSchema = z
  .object({
    metric: z.enum(UsageMetric),
    quantity: quantitySchema,
    /** Same key, same reservation: retries never hold twice. */
    idempotencyKey: z.string().min(1).max(200),
    purpose: dottedKeySchema,
    /** How long the hold counts if it is never settled (default 15 minutes, at most 1 day). */
    holdSeconds: z.number().int().min(1).max(86_400).default(900),
  })
  .strict();

const usedSchema = z.union([
  z.bigint().nonnegative(),
  z.number().int().nonnegative().transform(BigInt),
]);

export interface UsageSummary {
  readonly metric: UsageMetric;
  readonly periodStart: Date;
  readonly limit: bigint;
  /** Sum of the ledger for the period. */
  readonly used: bigint;
  /** Quantity in unexpired HELD reservations. */
  readonly held: bigint;
  readonly available: bigint;
}

export interface UsageRepository {
  reserve(input: z.input<typeof reserveSchema>): Promise<UsageReservation>;
  /** Settles a HELD reservation with the quantity actually used (at most the quantity held). */
  commit(
    reservationId: string,
    used: bigint | number,
  ): Promise<UsageReservation>;
  release(reservationId: string): Promise<UsageReservation>;
  /** Marks HELD reservations whose hold ran out as EXPIRED (workers only). */
  expireHolds(): Promise<number>;
  /** Null without an entitled subscription. Needs `billing.read` (or the system actor). */
  summary(metric: UsageMetric): Promise<UsageSummary | null>;
}

async function measure(
  db: DbClient,
  tenantId: string,
  metric: UsageMetric,
  periodStart: Date,
  now: Date,
): Promise<{ used: bigint; held: bigint }> {
  const ledger = await db.usageLedgerEntry.aggregate({
    where: { tenantId, metric, periodStart },
    _sum: { quantity: true },
  });
  const holds = await db.usageReservation.aggregate({
    where: {
      tenantId,
      metric,
      periodStart,
      status: 'HELD',
      expiresAt: { gt: now },
    },
    _sum: { quantity: true },
  });
  return {
    used: ledger._sum.quantity ?? 0n,
    held: holds._sum.quantity ?? 0n,
  };
}

async function entitledSubscription(db: DbClient, tenantId: string) {
  const subscription = await findCurrentSubscription(db, tenantId);
  if (
    subscription === null ||
    !(ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(
      subscription.status,
    )
  ) {
    return null;
  }
  return subscription;
}

export function createUsageRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): UsageRepository {
  const writer = (operation: string) => {
    if (actor.kind === 'platform_admin') {
      throw new ActorNotAllowedError(operation);
    }
  };

  /** Settles a HELD reservation; repeated identical settlements return the settled row. */
  async function settle(
    reservationId: string,
    status: 'COMMITTED' | 'RELEASED',
    used: bigint | null,
  ): Promise<UsageReservation> {
    const id = uuidSchema.parse(reservationId);
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.usageReservation.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (reservation === null) {
        throw new ReservationStateError('Reservation not found');
      }
      if (reservation.status !== 'HELD') {
        if (
          reservation.status === status &&
          reservation.committedQuantity === used
        ) {
          return reservation;
        }
        throw new ReservationStateError(
          `Reservation is ${reservation.status.toLowerCase()}`,
        );
      }
      if (used !== null && used > reservation.quantity) {
        throw new ReservationStateError(
          'Used quantity exceeds the reservation',
        );
      }
      const settledAt = now();
      // The status condition makes a concurrent settlement update nothing.
      const { count } = await tx.usageReservation.updateMany({
        where: { tenantId, id, status: 'HELD' },
        data: { status, committedQuantity: used, settledAt },
      });
      if (count !== 1) {
        throw new ReservationStateError('Reservation was settled concurrently');
      }
      if (used !== null && used > 0n) {
        await tx.usageLedgerEntry.create({
          data: {
            tenantId,
            metric: reservation.metric,
            periodStart: reservation.periodStart,
            kind: 'USAGE',
            quantity: used,
            reservationId: id,
            idempotencyKey: `reservation:${id}`,
            occurredAt: settledAt,
          },
        });
      }
      return tx.usageReservation.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id } },
      });
    });
  }

  return {
    async reserve(input) {
      writer('usage.reserve');
      const { metric, quantity, idempotencyKey, purpose, holdSeconds } =
        reserveSchema.parse(input);
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`usage:${tenantId}:${metric}`}, 0))`;
        const existing = await tx.usageReservation.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        });
        if (existing !== null) {
          if (existing.metric !== metric || existing.quantity !== quantity) {
            throw new ReservationStateError(
              'Idempotency key was used for a different reservation',
            );
          }
          return existing;
        }
        const subscription = await entitledSubscription(tx, tenantId);
        if (subscription === null) {
          throw new NoEntitledSubscriptionError();
        }
        const createdAt = now();
        const periodStart = subscription.currentPeriodStart;
        const limit = await findEffectiveLimit(
          tx,
          tenantId,
          subscription.planId,
          metric,
        );
        const { used, held } = await measure(
          tx,
          tenantId,
          metric,
          periodStart,
          createdAt,
        );
        if (used + held + quantity > limit) {
          throw new UsageLimitExceededError(
            metric,
            limit,
            used + held,
            quantity,
          );
        }
        return tx.usageReservation.create({
          data: {
            tenantId,
            metric,
            quantity,
            periodStart,
            idempotencyKey,
            purpose,
            createdAt,
            expiresAt: new Date(createdAt.getTime() + holdSeconds * 1000),
          },
        });
      });
    },
    async commit(reservationId, used) {
      writer('usage.commit');
      return settle(reservationId, 'COMMITTED', usedSchema.parse(used));
    },
    async release(reservationId) {
      writer('usage.release');
      return settle(reservationId, 'RELEASED', null);
    },
    async expireHolds() {
      if (actor.kind !== 'system') {
        throw new ActorNotAllowedError('usage.expireHolds');
      }
      const at = now();
      const { count } = await prisma.usageReservation.updateMany({
        where: { tenantId, status: 'HELD', expiresAt: { lte: at } },
        data: { status: 'EXPIRED', settledAt: at },
      });
      return count;
    },
    async summary(metric) {
      requireReadPermissionOrSystem(actor, 'billing.read');
      const subscription = await entitledSubscription(prisma, tenantId);
      if (subscription === null) {
        return null;
      }
      const periodStart = subscription.currentPeriodStart;
      const limit = await findEffectiveLimit(
        prisma,
        tenantId,
        subscription.planId,
        metric,
      );
      const { used, held } = await measure(
        prisma,
        tenantId,
        metric,
        periodStart,
        now(),
      );
      const remaining = limit - used - held;
      return {
        metric,
        periodStart,
        limit,
        used,
        held,
        available: remaining > 0n ? remaining : 0n,
      };
    },
  };
}

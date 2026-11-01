import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { FIXTURE_PLANS, fixtureIds } from './fixtures/fixture-data.js';
import {
  loadFixtureTenants,
  summarizeFixtureTenants,
} from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Billing, usage, branding, audit and notification tables (task 03C, docs/decisions.md
// D-03C-*) on real PostgreSQL. Runs only when TEST_DATABASE_URL is set; otherwise it is
// reported as skipped, never as passed. Works in its own schema and drops it afterwards.
const db = new MigratedSchema('t03c');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const newId = () => randomUUID();

// SQLSTATE codes.
const FOREIGN_KEY = '23503';
const UNIQUE = '23505';
const CHECK = '23514';
const INTEGRITY = '23000'; // raised by the immutability triggers

describe.runIf(testDatabaseUrl !== undefined)(
  'billing, usage, audit and notification tables on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let client: Client;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      client = await db.connect();
    }, 60_000);

    afterAll(async () => {
      await client.end();
      await prisma.$disconnect();
      await db.drop();
    }, 60_000);

    /** INSERT one row; column names come from the object's keys. */
    function insert(table: string, row: Record<string, unknown>) {
      const columns = Object.keys(row);
      return client.query(
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')})
         VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
        Object.values(row),
      );
    }

    async function rejects(statement: Promise<unknown>, code: string) {
      await expect(statement).rejects.toMatchObject({ code });
    }

    /** Runs `work` and rolls it back, so integrity tests leave the fixtures untouched. */
    async function rolledBack(work: () => Promise<void>): Promise<void> {
      await client.query('BEGIN');
      try {
        await work();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    /** Expects one statement to fail with `code` inside a savepoint, then continues. */
    async function failsWith(
      statement: () => Promise<unknown>,
      code: string,
    ): Promise<void> {
      await client.query('SAVEPOINT expect_failure');
      try {
        await rejects(statement(), code);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT expect_failure');
      }
    }

    const period = new Date('2026-10-15T00:00:00Z');

    describe('fixture tenants (Prisma Client)', () => {
      it('loads the same billing history into both tenants', async () => {
        for (const tenant of await summarizeFixtureTenants(prisma)) {
          expect(tenant).toMatchObject({
            subscriptions: 2,
            paymentEvents: 2,
            limitOverrides: 1,
            usageReservations: 3,
            usageLedgerEntries: 3,
            branding: 1,
            auditRecords: 3,
            notifications: 2,
          });
        }
        expect(await prisma.billingPlan.count()).toBe(3);
        expect(await prisma.planLimit.count()).toBe(12);
      });

      it('is idempotent', async () => {
        const before = await summarizeFixtureTenants(prisma);
        await loadFixtureTenants(prisma);
        expect(await summarizeFixtureTenants(prisma)).toEqual(before);
        expect(await prisma.billingPlan.count()).toBe(3);
      });

      it('keeps one current subscription per tenant and its history', async () => {
        const subscriptions = await prisma.subscription.findMany({
          where: { tenantId: alpha.tenant },
          orderBy: { currentPeriodStart: 'asc' },
          select: { id: true, status: true, planId: true, endedAt: true },
        });
        expect(subscriptions).toEqual([
          {
            id: alpha.subscriptionPrevious,
            status: 'CANCELED',
            planId: FIXTURE_PLANS.starter.id,
            endedAt: period,
          },
          {
            id: alpha.subscription,
            status: 'ACTIVE',
            planId: FIXTURE_PLANS.growth.id,
            endedAt: null,
          },
        ]);
      });

      it('derives payment facts from deduplicated provider notifications', async () => {
        const payments = await prisma.paymentEvent.findMany({
          where: { tenantId: beta.tenant },
          orderBy: { occurredAt: 'asc' },
          include: {
            inboundEvent: { select: { provider: true, eventKey: true } },
          },
        });
        expect(
          payments.map((p) => ({
            kind: p.kind,
            amountMinor: p.amountMinor,
            currency: p.currency,
            failureCode: p.failureCode,
            source: p.inboundEvent,
          })),
        ).toEqual([
          {
            kind: 'PAYMENT_FAILED',
            amountMinor: 1_200_000n,
            currency: 'GBP',
            failureCode: 'card_declined',
            source: { provider: 'STRIPE', eventKey: 'fake_evt_0001' },
          },
          {
            kind: 'PAYMENT_SUCCEEDED',
            amountMinor: 1_200_000n,
            currency: 'GBP',
            failureCode: null,
            source: { provider: 'STRIPE', eventKey: 'fake_evt_0002' },
          },
        ]);
      });

      it('sums usage from the ledger per metric and period', async () => {
        const totals = await prisma.usageLedgerEntry.groupBy({
          by: ['metric', 'periodStart'],
          where: { tenantId: alpha.tenant },
          _sum: { quantity: true },
          orderBy: [{ periodStart: 'asc' }, { metric: 'asc' }],
        });
        expect(
          totals.map((t) => [
            t.metric,
            t.periodStart.toISOString(),
            t._sum.quantity,
          ]),
        ).toEqual([
          ['EMAILS_SENT', '2026-09-15T00:00:00.000Z', 1n],
          // 1,380 used by the research run, 380 credited back.
          ['AI_TOKENS', '2026-10-15T00:00:00.000Z', 1_000n],
        ]);
      });
    });

    describe('integrity rules (SQL)', () => {
      const subscription = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        plan_id: FIXTURE_PLANS.starter.id,
        provider: 'MANUAL',
        status: 'CANCELED',
        current_period_start: new Date('2026-08-15T00:00:00Z'),
        current_period_end: new Date('2026-09-15T00:00:00Z'),
        ended_at: new Date('2026-09-15T00:00:00Z'),
        updated_at: new Date(),
        ...overrides,
      });

      it('allows one current subscription per tenant and any number of ended ones', () =>
        rolledBack(async () => {
          await insert('subscriptions', subscription());
          const current = subscription({ status: 'PAST_DUE', ended_at: null });
          await failsWith(() => insert('subscriptions', current), UNIQUE);
          // Once the current subscription ends, a new one can start.
          await client.query(
            `UPDATE subscriptions SET status = 'CANCELED', ended_at = $3
              WHERE tenant_id = $1 AND id = $2`,
            [
              alpha.tenant,
              alpha.subscription,
              new Date('2026-10-20T00:00:00Z'),
            ],
          );
          await insert('subscriptions', current);
        }));

      it('ties a provider subscription to exactly one tenant', () =>
        rolledBack(async () => {
          await failsWith(
            () =>
              insert(
                'subscriptions',
                subscription({
                  tenant_id: beta.tenant,
                  provider: 'STRIPE',
                  external_customer_id: 'fake_cus_alpha',
                  external_subscription_id: 'fake_sub_alpha_2',
                }),
              ),
            UNIQUE,
          );
        }));

      it.each([
        ['a STRIPE subscription without provider ids', { provider: 'STRIPE' }],
        [
          'a MANUAL subscription with provider ids',
          {
            external_customer_id: 'fake_cus_x',
            external_subscription_id: 'fake_sub_x',
          },
        ],
        [
          'a provider id with spaces',
          {
            provider: 'STRIPE',
            external_customer_id: 'cus x',
            external_subscription_id: 'fake_sub_y',
          },
        ],
        [
          'an empty period',
          { current_period_end: new Date('2026-08-15T00:00:00Z') },
        ],
        ['a trial without an end', { status: 'TRIALING', ended_at: null }],
        ['an ended subscription without ended_at', { ended_at: null }],
        ['a current subscription with ended_at', { status: 'UNPAID' }],
      ])('rejects %s', (_name, overrides) =>
        rolledBack(() =>
          failsWith(
            () => insert('subscriptions', subscription(overrides)),
            CHECK,
          ),
        ),
      );

      const payment = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        provider: 'STRIPE',
        external_event_id: `fake_evt_${newId()}`,
        kind: 'REFUNDED',
        subscription_id: alpha.subscription,
        external_object_id: 'fake_ch_0001',
        amount_minor: 500,
        currency: 'USD',
        occurred_at: new Date('2026-10-20T10:00:00Z'),
        ...overrides,
      });

      it('records a provider event once per tenant', () =>
        rolledBack(async () => {
          await failsWith(
            () =>
              insert(
                'payment_events',
                payment({ external_event_id: 'fake_evt_0002' }),
              ),
            UNIQUE,
          );
          await failsWith(
            () =>
              insert(
                'payment_events',
                payment({
                  inbound_event_id: alpha.inboundEventPaymentSucceeded,
                }),
              ),
            UNIQUE,
          );
          await insert('payment_events', payment());
        }));

      it.each([
        ['a MANUAL fact with a provider event id', { provider: 'MANUAL' }],
        [
          'a STRIPE fact without a provider event id',
          { external_event_id: null },
        ],
        ['a failed payment without a failure code', { kind: 'PAYMENT_FAILED' }],
        ['a failure code on a refund', { failure_code: 'card_declined' }],
        ['a lower-case currency', { currency: 'usd' }],
        ['a negative amount', { amount_minor: -1 }],
      ])('rejects %s', (_name, overrides) =>
        rolledBack(() =>
          failsWith(() => insert('payment_events', payment(overrides)), CHECK),
        ),
      );

      const reservation = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        metric: 'LEAD_ENRICHMENTS',
        quantity: 5,
        period_start: period,
        idempotency_key: `test:${newId()}`,
        purpose: 'enrichment.run',
        created_at: new Date('2026-10-20T10:00:00Z'),
        expires_at: new Date('2026-10-20T10:15:00Z'),
        updated_at: new Date(),
        ...overrides,
      });

      it.each([
        ['a zero quantity', { quantity: 0 }],
        ['a purpose that is not a dotted key', { purpose: 'Enrichment' }],
        [
          'an expiry before creation',
          { expires_at: new Date('2026-10-20T09:00:00Z') },
        ],
        [
          'a HELD reservation that is settled',
          { settled_at: new Date('2026-10-20T10:01:00Z') },
        ],
        [
          'a COMMITTED reservation without a quantity',
          { status: 'COMMITTED', settled_at: new Date('2026-10-20T10:01:00Z') },
        ],
        [
          'a commit above the reservation',
          {
            status: 'COMMITTED',
            committed_quantity: 6,
            settled_at: new Date('2026-10-20T10:01:00Z'),
          },
        ],
        [
          'a RELEASED reservation with a quantity',
          {
            status: 'RELEASED',
            committed_quantity: 1,
            settled_at: new Date('2026-10-20T10:01:00Z'),
          },
        ],
      ])('rejects a reservation with %s', (_name, overrides) =>
        rolledBack(() =>
          failsWith(
            () => insert('usage_reservations', reservation(overrides)),
            CHECK,
          ),
        ),
      );

      const ledger = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        metric: 'AI_TOKENS',
        period_start: period,
        kind: 'USAGE',
        quantity: 10,
        idempotency_key: `test:${newId()}`,
        ...overrides,
      });

      it.each([
        ['negative usage', { quantity: -1 }],
        ['an adjustment without a note', { kind: 'ADJUSTMENT', quantity: -5 }],
        ['a zero adjustment', { kind: 'ADJUSTMENT', quantity: 0, note: 'x' }],
        [
          'an adjustment tied to a reservation',
          {
            kind: 'ADJUSTMENT',
            quantity: 5,
            note: 'x',
            reservation_id: alpha.reservationReleased,
            metric: 'LEAD_ENRICHMENTS',
          },
        ],
      ])('rejects a ledger entry with %s', (_name, overrides) =>
        rolledBack(() =>
          failsWith(
            () => insert('usage_ledger_entries', ledger(overrides)),
            CHECK,
          ),
        ),
      );

      it('settles a reservation in its own metric and period, once', () =>
        rolledBack(async () => {
          // The released enrichment hold, booked as AI tokens: no such (reservation, metric).
          await failsWith(
            () =>
              insert(
                'usage_ledger_entries',
                ledger({ reservation_id: alpha.reservationReleased }),
              ),
            FOREIGN_KEY,
          );
          await failsWith(
            () =>
              insert(
                'usage_ledger_entries',
                ledger({
                  reservation_id: alpha.reservationReleased,
                  metric: 'LEAD_ENRICHMENTS',
                  period_start: new Date('2026-09-15T00:00:00Z'),
                }),
              ),
            FOREIGN_KEY,
          );
          await failsWith(
            () =>
              insert(
                'usage_ledger_entries',
                ledger({ reservation_id: alpha.reservationCommitted }),
              ),
            UNIQUE,
          );
          await failsWith(
            () =>
              insert(
                'usage_ledger_entries',
                ledger({
                  idempotency_key: `reservation:${alpha.reservationCommitted}`,
                }),
              ),
            UNIQUE,
          );
          // A reservation with recorded usage cannot be deleted.
          await failsWith(
            () =>
              client.query(
                'DELETE FROM usage_reservations WHERE tenant_id = $1 AND id = $2',
                [alpha.tenant, alpha.reservationCommitted],
              ),
            FOREIGN_KEY,
          );
          await failsWith(
            () =>
              insert(
                'usage_reservations',
                reservation({ idempotency_key: `research:${alpha.research}` }),
              ),
            UNIQUE,
          );
        }));

      it.each([
        ['payment_events', 'amount_minor = 1', alpha.paymentSucceeded],
        ['usage_ledger_entries', 'quantity = 1', alpha.ledgerReserved],
        ['audit_records', "action = 'approval.changed'", alpha.auditApproval],
      ])('never changes %s rows', (table, assignment, id) =>
        rolledBack(() =>
          failsWith(
            () =>
              client.query(
                `UPDATE "${table}" SET ${assignment} WHERE tenant_id = $1 AND id = $2`,
                [alpha.tenant, id],
              ),
            INTEGRITY,
          ),
        ),
      );

      it.each([
        ['an http logo', { logo_url: 'http://fixture-alpha.test/logo.png' }],
        ['a javascript logo', { logo_url: 'javascript:alert(1)' }],
        [
          'a logo URL with a quote',
          { logo_url: 'https://x.test/a"onerror="b' },
        ],
        ['a lower-case colour', { primary_color: '#1f6feb' }],
        ['a colour name', { accent_color: 'red' }],
        [
          'a support address that is not normalized',
          { support_email: 'Support@X.test' },
        ],
        ['an empty display name', { display_name: '' }],
      ])('rejects branding with %s', (_name, overrides) =>
        rolledBack(async () => {
          const columns = Object.entries(overrides);
          await failsWith(
            () =>
              client.query(
                `UPDATE tenant_branding SET ${columns.map(([c], i) => `"${c}" = $${String(i + 2)}`).join(', ')}
                  WHERE tenant_id = $1`,
                [alpha.tenant, ...columns.map(([, v]) => v)],
              ),
            CHECK,
          );
        }),
      );

      const audit = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        actor_type: 'SYSTEM',
        actor_name: 'billing_sync',
        action: 'subscription.synced',
        ...overrides,
      });

      it.each([
        [
          'a member without a membership',
          { actor_type: 'MEMBER', actor_name: null, actor_user_id: newId() },
        ],
        [
          'a platform admin without a reason',
          {
            actor_type: 'PLATFORM_ADMIN',
            actor_name: null,
            actor_user_id: newId(),
          },
        ],
        [
          'a platform admin with a membership',
          {
            actor_type: 'PLATFORM_ADMIN',
            actor_name: null,
            actor_user_id: newId(),
            actor_membership_id: newId(),
            reason: 'Support',
          },
        ],
        ['a system actor with a user', { actor_user_id: newId() }],
        [
          'an action that is not a dotted key',
          { action: 'Subscription Synced' },
        ],
        ['a target id without a type', { target_id: newId() }],
        ['metadata that is not an object', { metadata: JSON.stringify(['x']) }],
        ['a malformed request id', { request_id: 'not a request id' }],
      ])('rejects an audit record with %s', (_name, overrides) =>
        rolledBack(() =>
          failsWith(() => insert('audit_records', audit(overrides)), CHECK),
        ),
      );

      it('keeps platform audit records free of tenant members and immutable', () =>
        rolledBack(async () => {
          const id = newId();
          await insert('platform_audit_records', {
            id,
            actor_type: 'SYSTEM',
            actor_name: 'access_control',
            action: 'platform_admin.access_denied',
            subject_tenant_id: alpha.tenant,
          });
          await failsWith(
            () =>
              insert('platform_audit_records', {
                id: newId(),
                actor_type: 'MEMBER',
                actor_user_id: newId(),
                action: 'tenant.viewed',
              }),
            CHECK,
          );
          await failsWith(
            () =>
              client.query(
                "UPDATE platform_audit_records SET action = 'tenant.viewed' WHERE id = $1",
                [id],
              ),
            INTEGRITY,
          );
          // No foreign key: the record stays when the tenant goes.
          await client.query('DELETE FROM tenants WHERE id = $1', [
            alpha.tenant,
          ]);
          const left = await client.query(
            'SELECT subject_tenant_id FROM platform_audit_records WHERE id = $1',
            [id],
          );
          expect(left.rows).toEqual([{ subject_tenant_id: alpha.tenant }]);
        }));

      const notification = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        recipient_membership_id: alpha.membershipShared,
        type: 'campaign.completed',
        title: 'Done',
        created_at: new Date('2026-10-20T10:00:00Z'),
        ...overrides,
      });

      it.each([
        ['an external link', { link_path: 'https://evil.test/' }],
        ['a protocol-relative link', { link_path: '//evil.test/path' }],
        ['a backslash link', { link_path: '/\\evil.test' }],
        ['a link with spaces', { link_path: '/campaigns/ x' }],
        ['an empty title', { title: '' }],
        [
          'a read time before creation',
          { read_at: new Date('2026-10-19T10:00:00Z') },
        ],
      ])('rejects a notification with %s', (_name, overrides) =>
        rolledBack(() =>
          failsWith(
            () => insert('notifications', notification(overrides)),
            CHECK,
          ),
        ),
      );

      it('notifies a member once per dedupe key and follows the membership', () =>
        rolledBack(async () => {
          await insert(
            'notifications',
            notification({ link_path: '/campaigns', dedupe_key: 'k1' }),
          );
          await failsWith(
            () => insert('notifications', notification({ dedupe_key: 'k1' })),
            UNIQUE,
          );
          // Another tenant's membership id is not a recipient here.
          await failsWith(
            () =>
              insert(
                'notifications',
                notification({
                  recipient_membership_id: beta.membershipShared,
                }),
              ),
            FOREIGN_KEY,
          );
          await client.query(
            'DELETE FROM memberships WHERE tenant_id = $1 AND id = $2',
            [alpha.tenant, alpha.membershipShared],
          );
          const left = await client.query(
            'SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND recipient_membership_id = $2',
            [alpha.tenant, alpha.membershipShared],
          );
          expect(left.rows).toEqual([{ n: 0 }]);
        }));

      it('protects the plan catalog', () =>
        rolledBack(async () => {
          await failsWith(
            () =>
              client.query('DELETE FROM billing_plans WHERE id = $1', [
                FIXTURE_PLANS.growth.id,
              ]),
            FOREIGN_KEY,
          );
          await failsWith(
            () =>
              insert('billing_plans', {
                id: newId(),
                key: 'Growth',
                name: 'x',
                currency: 'USD',
                amount_minor: 1,
                interval: 'MONTH',
                updated_at: new Date(),
              }),
            CHECK,
          );
          await failsWith(
            () =>
              client.query(
                "UPDATE plan_limits SET quantity_per_period = -1 WHERE plan_id = $1 AND metric = 'AI_TOKENS'",
                [FIXTURE_PLANS.growth.id],
              ),
            CHECK,
          );
          // An unused plan goes, with its limits.
          const id = newId();
          await insert('billing_plans', {
            id,
            key: 'unused_plan',
            name: 'Unused',
            currency: 'EUR',
            amount_minor: 0,
            interval: 'YEAR',
            updated_at: new Date(),
          });
          await insert('plan_limits', {
            plan_id: id,
            metric: 'AI_TOKENS',
            quantity_per_period: 1,
          });
          await client.query('DELETE FROM billing_plans WHERE id = $1', [id]);
          const left = await client.query(
            'SELECT count(*)::int AS n FROM plan_limits WHERE plan_id = $1',
            [id],
          );
          expect(left.rows).toEqual([{ n: 0 }]);
        }));
    });

    describe('planned queries use their indexes', () => {
      const t = `'${alpha.tenant}'`;

      beforeAll(async () => {
        // Realistic volume for Alpha, rolled back after the last query (see the 03B suite).
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO usage_reservations (tenant_id, id, metric, quantity, period_start, status,
                                           idempotency_key, purpose, created_at, expires_at,
                                           committed_quantity, settled_at, updated_at)
           SELECT $1, gen_random_uuid(),
                  (ARRAY['AI_TOKENS', 'LEAD_ENRICHMENTS', 'EMAIL_VERIFICATIONS', 'EMAILS_SENT'])[(g % 4 + 1)::int]::usage_metric,
                  10, $2::timestamptz - make_interval(months => g % 12), 'COMMITTED', 'volume:' || g,
                  'volume.run', now() - interval '1 hour', now(), 5, now(), now()
             FROM generate_series(1, 2000) AS g`,
          [alpha.tenant, period],
        );
        await client.query(
          `INSERT INTO usage_ledger_entries (tenant_id, id, metric, period_start, kind, quantity, idempotency_key)
           SELECT $1, gen_random_uuid(),
                  (ARRAY['AI_TOKENS', 'LEAD_ENRICHMENTS', 'EMAIL_VERIFICATIONS', 'EMAILS_SENT'])[(g % 4 + 1)::int]::usage_metric,
                  $2::timestamptz - make_interval(months => g % 12), 'USAGE', 5, 'volume:' || g
             FROM generate_series(1, 2000) AS g`,
          [alpha.tenant, period],
        );
        await client.query(
          `INSERT INTO payment_events (tenant_id, id, provider, external_event_id, kind, subscription_id,
                                       amount_minor, currency, occurred_at)
           SELECT $1, gen_random_uuid(), 'STRIPE', 'fake_evt_volume_' || g, 'PAYMENT_SUCCEEDED',
                  CASE WHEN g % 2 = 0 THEN $2::uuid ELSE $3::uuid END, 100, 'USD',
                  now() - make_interval(days => g)
             FROM generate_series(1, 1000) AS g`,
          [alpha.tenant, alpha.subscription, alpha.subscriptionPrevious],
        );
        await client.query(
          `INSERT INTO audit_records (tenant_id, id, actor_type, actor_name, action, target_type, target_id)
           SELECT $1, gen_random_uuid(), 'SYSTEM', 'volume', 'volume.recorded', 'contact', gen_random_uuid()
             FROM generate_series(1, 2000) AS g`,
          [alpha.tenant],
        );
        await client.query(
          `INSERT INTO notifications (tenant_id, id, recipient_membership_id, type, title, read_at, created_at)
           SELECT $1, gen_random_uuid(), CASE WHEN g % 2 = 0 THEN $2::uuid ELSE $3::uuid END,
                  'volume.notice', 'Volume', CASE WHEN g % 20 <> 0 THEN now() END, now() - interval '1 day'
             FROM generate_series(1, 2000) AS g`,
          [alpha.tenant, alpha.membershipAdmin, alpha.membershipShared],
        );
        await client.query(
          `INSERT INTO platform_audit_records (id, actor_type, actor_name, action, subject_tenant_id)
           SELECT gen_random_uuid(), 'SYSTEM', 'volume', 'volume.recorded', gen_random_uuid()
             FROM generate_series(1, 2000) AS g`,
        );
        await client.query('ANALYZE');
      }, 60_000);

      afterAll(async () => {
        await client.query('ROLLBACK');
      });

      // docs/decisions.md D-03C-08.
      it.each([
        [
          'usage of a metric in a period',
          `SELECT sum(quantity) FROM usage_ledger_entries WHERE tenant_id = ${t} AND metric = 'AI_TOKENS' AND period_start = '2026-10-15T00:00:00Z'`,
          'usage_ledger_entries_tenant_id_metric_period_start_idx',
        ],
        [
          'unexpired holds of a metric in a period',
          `SELECT sum(quantity) FROM usage_reservations WHERE tenant_id = ${t} AND metric = 'AI_TOKENS' AND period_start = '2026-10-15T00:00:00Z' AND status = 'HELD' AND expires_at > now()`,
          'usage_reservations_tenant_id_metric_period_start_status_idx',
        ],
        [
          'reservation by idempotency key',
          `SELECT id FROM usage_reservations WHERE tenant_id = ${t} AND idempotency_key = 'research:${alpha.research}'`,
          'usage_reservations_tenant_id_idempotency_key_key',
        ],
        [
          'payment fact by provider event id (deduplication)',
          `SELECT id FROM payment_events WHERE tenant_id = ${t} AND provider = 'STRIPE' AND external_event_id = 'fake_evt_0002'`,
          'payment_events_provider_event_key',
        ],
        [
          'payments of a subscription, latest first',
          `SELECT id FROM payment_events WHERE tenant_id = ${t} AND subscription_id = '${alpha.subscription}' ORDER BY occurred_at DESC LIMIT 20`,
          'payment_events_tenant_id_subscription_id_occurred_at_idx',
        ],
        [
          'subscription by provider id (webhook routing)',
          `SELECT tenant_id, id FROM subscriptions WHERE provider = 'STRIPE' AND external_subscription_id = 'fake_sub_alpha_2'`,
          'subscriptions_external_subscription_key',
        ],
        [
          'limit override of a metric',
          `SELECT quantity_per_period FROM tenant_limit_overrides WHERE tenant_id = ${t} AND metric = 'EMAILS_SENT'`,
          'tenant_limit_overrides_tenant_id_metric_key',
        ],
        [
          'audit records, a page newest first',
          `SELECT id FROM audit_records WHERE tenant_id = ${t} AND id < 'ffffffff-ffff-7fff-bfff-ffffffffffff' ORDER BY id DESC LIMIT 26`,
          'audit_records_pkey',
        ],
        [
          'audit records of one row',
          `SELECT id FROM audit_records WHERE tenant_id = ${t} AND target_type = 'subscription' AND target_id = '${alpha.subscription}' ORDER BY id DESC LIMIT 26`,
          'audit_records_tenant_id_target_type_target_id_id_idx',
        ],
        [
          "a member's notifications, a page newest first",
          `SELECT id FROM notifications WHERE tenant_id = ${t} AND recipient_membership_id = '${alpha.membershipAdmin}' ORDER BY id DESC LIMIT 26`,
          'notifications_tenant_id_recipient_membership_id_id_idx',
        ],
        [
          "a member's unread count",
          `SELECT count(*) FROM notifications WHERE tenant_id = ${t} AND recipient_membership_id = '${alpha.membershipAdmin}' AND read_at IS NULL`,
          'notifications_unread_idx',
        ],
        [
          'platform audit records about a tenant',
          `SELECT id FROM platform_audit_records WHERE subject_tenant_id = ${t} ORDER BY id DESC LIMIT 26`,
          'platform_audit_records_subject_tenant_id_id_idx',
        ],
      ])('%s', async (_name, sql, index) => {
        await client.query('SAVEPOINT planned_query');
        try {
          await client.query('SET LOCAL enable_seqscan = off');
          const plan = await client.query<{ 'QUERY PLAN': unknown }>(
            `EXPLAIN (FORMAT JSON) ${sql}`,
          );
          expect(JSON.stringify(plan.rows[0]?.['QUERY PLAN'])).toContain(
            `"Index Name":"${index}"`,
          );
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT planned_query');
        }
      });
    });
  },
);

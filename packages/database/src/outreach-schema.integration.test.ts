import { randomUUID } from 'node:crypto';
import { isSecretRef } from '@lead-fennec-ai/shared';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { fixtureIds } from './fixtures/fixture-data.js';
import {
  loadFixtureTenants,
  summarizeFixtureTenants,
} from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Outreach and background-job tables (task 03B, docs/decisions.md D-03B-*) on real
// PostgreSQL. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped,
// never as passed. Works in its own schema and drops it afterwards.
const db = new MigratedSchema('t03b');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const newId = () => randomUUID();

// SQLSTATE codes.
const FOREIGN_KEY = '23503';
const UNIQUE = '23505';
const CHECK = '23514';
const INTEGRITY = '23000'; // raised by the immutability triggers

// Token-shaped values, assembled at runtime from obviously fake parts.
const TOKEN_SHAPED = [
  `ya29.${'FakeAccessToken0'.repeat(8)}`,
  `1//0g${'FakeRefreshToken'.repeat(4)}`,
  ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJmaXh0dXJlIn0', 'ZmFrZQ'.repeat(8)].join(
    '.',
  ),
  `fake://${'FakeTokenPart'.repeat(6)}`,
  'Bearer fake',
];

describe.runIf(testDatabaseUrl !== undefined)(
  'outreach and job tables on PostgreSQL',
  () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    }, 60_000);

    describe('fixture tenants (Prisma Client)', () => {
      it('loads the same outreach history into both tenants', async () => {
        const summary = await summarizeFixtureTenants(prisma);
        expect(summary).toHaveLength(2);
        for (const tenant of summary) {
          expect(tenant).toMatchObject({
            emailAccounts: 1,
            templates: 2,
            campaigns: 1,
            sequences: 1,
            sequenceSteps: 2,
            campaignLeads: 2,
            drafts: 3,
            approvals: 2,
            outboundIntents: 1,
            outboundAttempts: 2,
            emailThreads: 1,
            inboundMessages: 1,
            suppressions: 2,
            jobSchedules: 2,
            jobRuns: 1,
            jobTasks: 2,
            workerLeases: 1,
            outboxEvents: 2,
            inboundEvents: 3,
            integrationSyncCursors: 1,
          });
        }
      });

      it('is idempotent', async () => {
        const before = await summarizeFixtureTenants(prisma);
        await loadFixtureTenants(prisma);
        expect(await summarizeFixtureTenants(prisma)).toEqual(before);
      });

      it('reuses provider ids in both tenants without mixing them', async () => {
        const threads = await prisma.emailThread.findMany({
          where: { providerThreadId: 'fake-thread-0001' },
          select: { tenantId: true, emailAccountId: true },
          orderBy: { tenantId: 'asc' },
        });
        expect(threads).toEqual([
          { tenantId: alpha.tenant, emailAccountId: alpha.emailAccount },
          { tenantId: beta.tenant, emailAccountId: beta.emailAccount },
        ]);
        const events = await prisma.inboundEvent.findMany({
          where: { eventKey: 'fake-notification-0001' },
          select: { tenantId: true, provider: true },
          orderBy: { tenantId: 'asc' },
        });
        expect(events).toEqual([
          { tenantId: alpha.tenant, provider: 'GMAIL' },
          { tenantId: beta.tenant, provider: 'MICROSOFT_GRAPH' },
        ]);
        // Unique lookups need the tenant: another tenant's id resolves to nothing.
        await expect(
          prisma.outboundIntent.findUnique({
            where: { tenantId_id: { tenantId: beta.tenant, id: alpha.intent } },
          }),
        ).resolves.toBeNull();
        const intent = await prisma.outboundIntent.findUnique({
          where: {
            tenantId_campaignLeadId_sequenceStepId: {
              tenantId: alpha.tenant,
              campaignLeadId: alpha.leadShared,
              sequenceStepId: alpha.stepIntro,
            },
          },
          select: { id: true, status: true, approvalDecision: true },
        });
        expect(intent).toEqual({
          id: alpha.intent,
          status: 'SENT',
          approvalDecision: 'APPROVED',
        });
      });

      it('stores UTC instants with the IANA zone they were planned in', async () => {
        const client = await db.connect();
        try {
          const { rows } = await client.query(
            `SELECT tenant_id,
                  to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS utc,
                  to_char(scheduled_at AT TIME ZONE scheduled_timezone, 'YYYY-MM-DD HH24:MI') AS local,
                  scheduled_timezone
             FROM outbound_intents ORDER BY tenant_id`,
          );
          // Both were planned for 09:30 local time, so their UTC instants differ.
          expect(rows).toEqual([
            {
              tenant_id: alpha.tenant,
              utc: '2026-10-06 13:30',
              local: '2026-10-06 09:30',
              scheduled_timezone: 'America/New_York',
            },
            {
              tenant_id: beta.tenant,
              utc: '2026-10-06 08:30',
              local: '2026-10-06 09:30',
              scheduled_timezone: 'Europe/London',
            },
          ]);
        } finally {
          await client.end();
        }
        const lead = await prisma.campaignLead.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: alpha.tenant, id: alpha.leadOwn } },
        });
        expect(lead.timezone).toBe('America/Chicago');
        expect(lead.nextActionAt?.toISOString()).toBe(
          '2026-10-08T14:30:00.000Z',
        );
      });

      it('keeps only a secret reference for mailbox credentials', async () => {
        const accounts = await prisma.emailAccount.findMany({
          orderBy: { tenantId: 'asc' },
        });
        expect(accounts.map((a) => a.secretRef)).toEqual([
          'fake://email-accounts/fixture-alpha/outreach',
          'fake://email-accounts/fixture-beta/outreach',
        ]);
        for (const account of accounts) {
          expect(isSecretRef(account.secretRef ?? '')).toBe(true);
        }
      });

      it('canary: Prisma ignores the WHERE clause of a partial unique key', async () => {
        // An intent whose only attempt FAILED is outside the partial unique index. If Prisma
        // applied the index's WHERE clause, this lookup would return null. It returns the
        // FAILED attempt, so these keys must never be used for lookups (D-03B-01). If this
        // test fails, Prisma changed: revisit D-03B-01 and the ESLint rule.
        const tenantId = alpha.tenant;
        const intentId = newId();
        await prisma.outboundIntent.create({
          data: {
            tenantId,
            id: intentId,
            campaignLeadId: alpha.leadOwn,
            sequenceStepId: alpha.stepIntro,
            draftId: alpha.draftOwnV1,
            emailAccountId: alpha.emailAccount,
            recipientEmail: 'jordan.lee@alpha-only.test',
            scheduledAt: new Date('2026-11-02T14:30:00Z'),
            scheduledTimezone: 'America/Chicago',
          },
        });
        try {
          await prisma.outboundAttempt.create({
            data: {
              tenantId,
              outboundIntentId: intentId,
              attemptNumber: 1,
              emailAccountId: alpha.emailAccount,
              status: 'FAILED',
              internetMessageId: '<canary.1@fixture-alpha.test>',
              errorCode: 'provider_unavailable',
              retryable: true,
              startedAt: new Date('2026-11-02T14:30:00Z'),
              finishedAt: new Date('2026-11-02T14:30:02Z'),
            },
          });
          const found = await prisma.outboundAttempt.findUnique({
            where: {
              // eslint-disable-next-line no-restricted-syntax -- demonstrates what the rule prevents
              openOrSentAttempt_partial: {
                tenantId,
                outboundIntentId: intentId,
              },
            },
            select: { status: true },
          });
          expect(found).toEqual({ status: 'FAILED' });
        } finally {
          await prisma.outboundIntent.delete({
            where: { tenantId_id: { tenantId, id: intentId } },
          });
        }
      });
    });

    describe('planned queries use their indexes', () => {
      let client: Client;
      const t = `'${alpha.tenant}'`;

      beforeAll(async () => {
        client = await db.connect();
        // With one or two rows per table several indexes cost the same, and the planner's
        // pick between them is arbitrary. Add realistic volume to Alpha, then gather
        // statistics; all of it is rolled back after the last query:
        // - 400 draft campaigns;
        // - 20 campaigns (one sequence and step each) with 400 leads in mixed statuses, each
        //   lead with a sent intent and a failed attempt 40 days ago;
        // - 400 threads.
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO campaigns (tenant_id, id, name, updated_at)
           SELECT $1, gen_random_uuid(), 'Draft campaign ' || g, now()
             FROM generate_series(1, 400) AS g`,
          [alpha.tenant],
        );
        // Volume campaign n: campaign, sequence and step ids differ only in their 4th group.
        const volumeId = (kind: '9001' | '9002' | '9003', n: string) =>
          `('00000000-0000-4000-${kind}-' || lpad((${n})::text, 12, '0'))::uuid`;
        await client.query(
          `INSERT INTO campaigns (tenant_id, id, name, updated_at)
           SELECT $1, ${volumeId('9001', 'g')}, 'Volume campaign ' || g, now()
             FROM generate_series(1, 20) AS g`,
          [alpha.tenant],
        );
        await client.query(
          `INSERT INTO sequences (tenant_id, id, campaign_id, name, updated_at)
           SELECT $1, ${volumeId('9002', 'g')}, ${volumeId('9001', 'g')}, 'Volume sequence', now()
             FROM generate_series(1, 20) AS g`,
          [alpha.tenant],
        );
        await client.query(
          `INSERT INTO sequence_steps (tenant_id, id, sequence_id, position, updated_at)
           SELECT $1, ${volumeId('9003', 'g')}, ${volumeId('9002', 'g')}, 1, now()
             FROM generate_series(1, 20) AS g`,
          [alpha.tenant],
        );
        await client.query(
          `WITH new_contacts AS (
             INSERT INTO contacts (tenant_id, id, updated_at)
             SELECT $1, gen_random_uuid(), now() FROM generate_series(1, 400)
             RETURNING id
           ), numbered AS (
             SELECT id AS contact_id, row_number() OVER () AS i FROM new_contacts
           ), new_leads AS (
             INSERT INTO campaign_leads (tenant_id, id, campaign_id, sequence_id, contact_id, status,
                                         stop_reason, stopped_at, completed_at, next_action_at,
                                         timezone, updated_at)
             SELECT $1, gen_random_uuid(), ${volumeId('9001', 'i % 20 + 1')},
                    ${volumeId('9002', 'i % 20 + 1')}, contact_id,
                    (ARRAY['PENDING', 'ACTIVE', 'COMPLETED', 'STOPPED'])[(i % 4 + 1)::int]::campaign_lead_status,
                    CASE WHEN i % 4 = 3 THEN 'MANUAL'::campaign_lead_stop_reason END,
                    CASE WHEN i % 4 = 3 THEN now() END,
                    CASE WHEN i % 4 = 2 THEN now() END,
                    CASE WHEN i % 4 = 1 THEN now() + interval '1 day' END,
                    'UTC', now()
               FROM numbered
             RETURNING id, sequence_id
           ), new_drafts AS (
             INSERT INTO drafts (tenant_id, id, campaign_lead_id, sequence_id, sequence_step_id, version,
                                 status, source, subject, body, created_by_membership_id, updated_at)
             SELECT $1, gen_random_uuid(), id, sequence_id,
                    replace(sequence_id::text, '-9002-', '-9003-')::uuid, 1, 'APPROVED', 'MANUAL',
                    'Volume', 'Volume', $2, now()
               FROM new_leads
             RETURNING id, campaign_lead_id, sequence_step_id
           ), new_intents AS (
             INSERT INTO outbound_intents (tenant_id, id, campaign_lead_id, sequence_step_id, draft_id,
                                           email_account_id, recipient_email, status, scheduled_at,
                                           scheduled_timezone, sent_at, updated_at)
             SELECT $1, gen_random_uuid(), campaign_lead_id, sequence_step_id, id, $3,
                    'volume@example.test', 'SENT', now() - interval '40 days', 'UTC',
                    now() - interval '40 days', now()
               FROM new_drafts
             RETURNING id
           )
           INSERT INTO outbound_attempts (tenant_id, id, outbound_intent_id, attempt_number, email_account_id,
                                          status, internet_message_id, error_code, retryable, started_at, finished_at)
           SELECT $1, gen_random_uuid(), id, 1, $3, 'FAILED', '<' || gen_random_uuid() || '@volume.test>',
                  'volume', false, now() - interval '40 days', now() - interval '40 days'
             FROM new_intents`,
          [alpha.tenant, alpha.membershipAdmin, alpha.emailAccount],
        );
        await client.query(
          `INSERT INTO email_threads (tenant_id, id, email_account_id, provider_thread_id, updated_at)
           SELECT $1, gen_random_uuid(), $2, 'volume-thread-' || g, now()
             FROM generate_series(1, 400) AS g`,
          [alpha.tenant, alpha.emailAccount],
        );
        await client.query('ANALYZE');
      }, 60_000);

      afterAll(async () => {
        await client.query('ROLLBACK');
        await client.end();
      });

      // docs/decisions.md D-03B-07. Sequential scans are disabled for the transaction only, so
      // the planner must use an index if a suitable one exists; the test checks which one.
      it.each([
        [
          'active campaigns',
          `SELECT id FROM campaigns WHERE tenant_id = ${t} AND status = 'ACTIVE'`,
          'campaigns_tenant_id_status_idx',
        ],
        [
          'leads due for their next step',
          `SELECT id FROM campaign_leads WHERE tenant_id = ${t} AND status = 'ACTIVE' AND next_action_at <= now() ORDER BY next_action_at LIMIT 100`,
          'campaign_leads_tenant_id_status_next_action_at_idx',
        ],
        [
          "a campaign's leads by status",
          `SELECT id FROM campaign_leads WHERE tenant_id = ${t} AND campaign_id = '00000000-0000-4000-9001-000000000001' AND status = 'STOPPED'`,
          'campaign_leads_tenant_id_campaign_id_status_idx',
        ],
        [
          'enrollment of a contact in a campaign',
          `SELECT id FROM campaign_leads WHERE tenant_id = ${t} AND campaign_id = '${alpha.campaign}' AND contact_id = '${alpha.contactOwn}'`,
          'campaign_leads_tenant_id_campaign_id_contact_id_key',
        ],
        [
          "a contact's enrollments",
          `SELECT id FROM campaign_leads WHERE tenant_id = ${t} AND contact_id = '${alpha.contactOwn}'`,
          'campaign_leads_tenant_id_contact_id_idx',
        ],
        [
          'steps of a sequence in order',
          `SELECT id FROM sequence_steps WHERE tenant_id = ${t} AND sequence_id = '${alpha.sequence}' ORDER BY position`,
          'sequence_steps_tenant_id_sequence_id_position_key',
        ],
        [
          'approval queue, oldest first',
          `SELECT id FROM drafts WHERE tenant_id = ${t} AND status = 'PENDING_APPROVAL' ORDER BY created_at LIMIT 50`,
          'drafts_tenant_id_status_created_at_idx',
        ],
        [
          'latest draft version for a lead and step',
          `SELECT id FROM drafts WHERE tenant_id = ${t} AND campaign_lead_id = '${alpha.leadShared}' AND sequence_step_id = '${alpha.stepIntro}' ORDER BY version DESC LIMIT 1`,
          'drafts_tenant_id_campaign_lead_id_sequence_step_id_version_key',
        ],
        [
          'due outbound intents',
          `SELECT id FROM outbound_intents WHERE tenant_id = ${t} AND status = 'SCHEDULED' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 100`,
          'outbound_intents_tenant_id_status_scheduled_at_idx',
        ],
        [
          'intent for a lead and step',
          `SELECT id FROM outbound_intents WHERE tenant_id = ${t} AND campaign_lead_id = '${alpha.leadShared}' AND sequence_step_id = '${alpha.stepIntro}'`,
          'outbound_intents_lead_step_key',
        ],
        [
          "a mailbox's attempts in the last day (daily limit)",
          `SELECT count(*) FROM outbound_attempts WHERE tenant_id = ${t} AND email_account_id = '${alpha.emailAccount}' AND started_at >= now() - interval '1 day'`,
          'outbound_attempts_tenant_id_email_account_id_started_at_idx',
        ],
        [
          'attempt by our Message-ID (reply matching)',
          `SELECT id FROM outbound_attempts WHERE tenant_id = ${t} AND internet_message_id = '<fixture-0001.2@fixture-alpha.test>'`,
          'outbound_attempts_tenant_id_internet_message_id_key',
        ],
        [
          'thread by provider thread id',
          `SELECT id FROM email_threads WHERE tenant_id = ${t} AND email_account_id = '${alpha.emailAccount}' AND provider_thread_id = 'fake-thread-0001'`,
          'email_threads_tenant_id_email_account_id_provider_thread_id_key',
        ],
        [
          'inbound message by provider id (deduplication)',
          `SELECT id FROM inbound_messages WHERE tenant_id = ${t} AND email_account_id = '${alpha.emailAccount}' AND provider_message_id = 'fake-msg-0002'`,
          'inbound_messages_provider_message_key',
        ],
        [
          'messages of a thread in order',
          `SELECT id FROM inbound_messages WHERE tenant_id = ${t} AND email_thread_id = '${alpha.thread}' ORDER BY received_at`,
          'inbound_messages_tenant_id_email_thread_id_received_at_idx',
        ],
        [
          'unclassified inbound messages',
          `SELECT id FROM inbound_messages WHERE tenant_id = ${t} AND classification = 'UNCLASSIFIED' ORDER BY received_at LIMIT 100`,
          'inbound_messages_tenant_id_classification_received_at_idx',
        ],
        [
          'is an address suppressed',
          `SELECT id FROM suppressions WHERE tenant_id = ${t} AND normalized_email = 'opted.out@shared-prospect.test'`,
          'suppressions_tenant_id_normalized_email_key',
        ],
        [
          'is a domain suppressed',
          `SELECT id FROM suppressions WHERE tenant_id = ${t} AND normalized_domain = 'competitor.test'`,
          'suppressions_tenant_id_normalized_domain_key',
        ],
        [
          'unpublished outbox events, oldest first',
          `SELECT id FROM outbox_events WHERE tenant_id = ${t} AND published_at IS NULL ORDER BY occurred_at LIMIT 100`,
          'outbox_events_unpublished_idx',
        ],
        [
          'inbound event by provider key (deduplication)',
          `SELECT id FROM inbound_events WHERE tenant_id = ${t} AND provider = 'GMAIL' AND event_key = 'fake-notification-0001'`,
          'inbound_events_tenant_id_provider_event_key_key',
        ],
        [
          'inbound events waiting to be processed',
          `SELECT id FROM inbound_events WHERE tenant_id = ${t} AND status = 'RECEIVED' ORDER BY received_at LIMIT 100`,
          'inbound_events_tenant_id_status_received_at_idx',
        ],
        [
          'due tasks',
          `SELECT id FROM job_tasks WHERE tenant_id = ${t} AND status = 'PENDING' AND available_at <= now() ORDER BY available_at LIMIT 100`,
          'job_tasks_tenant_id_status_available_at_idx',
        ],
        [
          'task by idempotency key',
          `SELECT id FROM job_tasks WHERE tenant_id = ${t} AND task_type = 'outbound.send' AND idempotency_key = 'outbound_intent:${alpha.intent}'`,
          'job_tasks_tenant_id_task_type_idempotency_key_key',
        ],
        [
          'runs of a schedule, latest first',
          `SELECT id FROM job_runs WHERE tenant_id = ${t} AND schedule_id = '${alpha.schedule}' ORDER BY scheduled_for DESC LIMIT 20`,
          'job_runs_tenant_id_schedule_id_scheduled_for_key',
        ],
        [
          'due schedules',
          `SELECT id FROM job_schedules WHERE tenant_id = ${t} AND enabled AND next_run_at <= now() ORDER BY next_run_at`,
          'job_schedules_tenant_id_enabled_next_run_at_idx',
        ],
        [
          'lease of a resource',
          `SELECT fencing_token FROM worker_leases WHERE tenant_id = ${t} AND resource_type = 'email_account.send' AND resource_id = '${alpha.emailAccount}'`,
          'worker_leases_tenant_id_resource_type_resource_id_key',
        ],
        [
          'sync cursor of a mailbox stream',
          `SELECT cursor FROM integration_sync_cursors WHERE tenant_id = ${t} AND provider = 'GMAIL' AND resource = 'gmail.history' AND scope_key = '${alpha.emailAccount}'`,
          'integration_sync_cursors_scope_key',
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

    describe('integrity rules (SQL)', () => {
      let client: Client;

      beforeAll(async () => {
        client = await db.connect();
      });

      afterAll(async () => {
        await client.end();
      });

      /** INSERT one row; column names come from the object's keys. */
      function insert(table: string, row: Record<string, unknown>) {
        const columns = Object.keys(row);
        const values = columns.map((_, i) => `$${String(i + 1)}`);
        return client.query(
          `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')})
           VALUES (${values.join(', ')})`,
          Object.values(row),
        );
      }

      async function rejects(
        statement: Promise<unknown>,
        code: string,
      ): Promise<void> {
        await expect(statement).rejects.toMatchObject({ code });
      }

      async function count(sql: string, params: unknown[]): Promise<number> {
        const result = await client.query<{ n: string }>(sql, params);
        return Number(result.rows[0]?.n);
      }

      const now = () => new Date();
      /** A valid intent for Alpha's second lead (step 1 has a draft but no intent yet). */
      const intent = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        campaign_lead_id: alpha.leadOwn,
        sequence_step_id: alpha.stepIntro,
        draft_id: alpha.draftOwnV1,
        email_account_id: alpha.emailAccount,
        recipient_email: 'jordan.lee@alpha-only.test',
        scheduled_at: new Date('2026-11-02T14:30:00Z'),
        scheduled_timezone: 'America/Chicago',
        updated_at: now(),
        ...overrides,
      });
      /** A valid draft for Alpha's second lead, step 2 (no drafts yet). */
      const draft = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        campaign_lead_id: alpha.leadOwn,
        sequence_id: alpha.sequence,
        sequence_step_id: alpha.stepFollowUp,
        version: 1,
        status: 'PENDING_APPROVAL',
        source: 'MANUAL',
        subject: 'Following up',
        body: 'Fixture text.',
        created_by_membership_id: alpha.membershipAdmin,
        updated_at: now(),
        ...overrides,
      });
      /** A valid attempt for Alpha's sent intent. Both times come from one clock. */
      const attempt = (overrides: Record<string, unknown> = {}) => ({
        tenant_id: alpha.tenant,
        id: newId(),
        outbound_intent_id: alpha.intent,
        attempt_number: 3,
        email_account_id: alpha.emailAccount,
        status: 'FAILED',
        internet_message_id: `<${newId()}@fixture-alpha.test>`,
        error_code: 'provider_unavailable',
        retryable: false,
        started_at: new Date('2026-10-06T14:00:00Z'),
        finished_at: new Date('2026-10-06T14:00:02Z'),
        ...overrides,
      });

      it("rejects references to another tenant's rows", async () => {
        await rejects(
          insert('campaign_leads', {
            tenant_id: alpha.tenant,
            id: newId(),
            campaign_id: alpha.campaign,
            sequence_id: alpha.sequence,
            contact_id: beta.contactNoEmail,
            timezone: 'UTC',
            updated_at: now(),
          }),
          FOREIGN_KEY,
        );
        await rejects(
          insert(
            'outbound_intents',
            intent({ email_account_id: beta.emailAccount }),
          ),
          FOREIGN_KEY,
        );
        await rejects(
          insert('drafts', draft({ sequence_step_id: beta.stepFollowUp })),
          FOREIGN_KEY,
        );
        await rejects(
          insert('email_threads', {
            tenant_id: alpha.tenant,
            id: newId(),
            email_account_id: beta.emailAccount,
            provider_thread_id: 'x',
            updated_at: now(),
          }),
          FOREIGN_KEY,
        );
        await rejects(
          insert('job_runs', {
            tenant_id: alpha.tenant,
            id: newId(),
            schedule_id: beta.schedule,
            job_type: 'campaign.dispatch',
            trigger: 'SCHEDULE',
            scheduled_for: now(),
            updated_at: now(),
          }),
          FOREIGN_KEY,
        );
        await rejects(
          insert('approvals', {
            tenant_id: alpha.tenant,
            id: newId(),
            draft_id: alpha.draftOwnV1,
            decision: 'APPROVED',
            decided_by_membership_id: beta.membershipAdmin,
          }),
          FOREIGN_KEY,
        );
      });

      it("keeps a lead's sequence, steps and drafts consistent", async () => {
        // A second sequence in Alpha's campaign, and a second campaign with its own sequence.
        const variant = newId();
        const variantStep = newId();
        const otherCampaign = newId();
        const otherSequence = newId();
        await insert('sequences', {
          tenant_id: alpha.tenant,
          id: variant,
          campaign_id: alpha.campaign,
          name: 'Variant B',
          updated_at: now(),
        });
        await insert('sequence_steps', {
          tenant_id: alpha.tenant,
          id: variantStep,
          sequence_id: variant,
          position: 1,
          updated_at: now(),
        });
        await insert('campaigns', {
          tenant_id: alpha.tenant,
          id: otherCampaign,
          name: 'Other campaign',
          updated_at: now(),
        });
        await insert('sequences', {
          tenant_id: alpha.tenant,
          id: otherSequence,
          campaign_id: otherCampaign,
          name: 'Other sequence',
          updated_at: now(),
        });
        try {
          // A draft for a step of another sequence than the lead's.
          await rejects(
            insert('drafts', draft({ sequence_step_id: variantStep })),
            FOREIGN_KEY,
          );
          await rejects(
            insert(
              'drafts',
              draft({ sequence_id: variant, sequence_step_id: variantStep }),
            ),
            FOREIGN_KEY,
          );
          // A lead following another campaign's sequence.
          await rejects(
            insert('campaign_leads', {
              tenant_id: alpha.tenant,
              id: newId(),
              campaign_id: alpha.campaign,
              sequence_id: otherSequence,
              contact_id: alpha.contactNoEmail,
              timezone: 'UTC',
              updated_at: now(),
            }),
            FOREIGN_KEY,
          );
          // An intent sending another lead's draft (version 1 is used by no intent, so only
          // the foreign key can object).
          await rejects(
            insert(
              'outbound_intents',
              intent({ draft_id: alpha.draftSharedV1 }),
            ),
            FOREIGN_KEY,
          );
        } finally {
          await client.query(
            'DELETE FROM campaigns WHERE tenant_id = $1 AND id = $2',
            [alpha.tenant, otherCampaign],
          );
          await client.query(
            'DELETE FROM sequences WHERE tenant_id = $1 AND id = $2',
            [alpha.tenant, variant],
          );
        }
      });

      it('sends only the exact version that was approved', async () => {
        // An APPROVED decision on a different version (the second lead's step 2).
        const otherDraft = newId();
        const otherApproval = newId();
        await insert('drafts', draft({ id: otherDraft }));
        await insert('approvals', {
          tenant_id: alpha.tenant,
          id: otherApproval,
          draft_id: otherDraft,
          decision: 'APPROVED',
          decided_by_membership_id: alpha.membershipAdmin,
        });
        try {
          await rejects(
            insert(
              'outbound_intents',
              intent({
                approval_id: otherApproval,
                approval_decision: 'APPROVED',
              }),
            ),
            FOREIGN_KEY,
          );
        } finally {
          await client.query(
            'DELETE FROM drafts WHERE tenant_id = $1 AND id = $2',
            [alpha.tenant, otherDraft],
          );
        }
        // A REJECTED decision cannot be cited as an approval.
        await rejects(
          client.query(
            `UPDATE outbound_intents
                SET draft_id = $3, approval_id = $4, approval_decision = 'APPROVED'
              WHERE tenant_id = $1 AND id = $2`,
            [
              alpha.tenant,
              alpha.intent,
              alpha.draftSharedV1,
              alpha.approvalRejected,
            ],
          ),
          FOREIGN_KEY,
        );
        await rejects(
          insert('outbound_intents', intent({ approval_decision: 'APPROVED' })),
          CHECK,
        );
        await rejects(
          insert(
            'outbound_intents',
            intent({
              approval_id: alpha.approvalRejected,
              approval_decision: 'REJECTED',
            }),
          ),
          CHECK,
        );
        // One decision per version, and decisions never change.
        await rejects(
          insert('approvals', {
            tenant_id: alpha.tenant,
            id: newId(),
            draft_id: alpha.draftSharedV2,
            decision: 'REJECTED',
            decided_by_membership_id: alpha.membershipAdmin,
          }),
          UNIQUE,
        );
        await rejects(
          client.query(
            "UPDATE approvals SET decision = 'APPROVED' WHERE tenant_id = $1 AND id = $2",
            [alpha.tenant, alpha.approvalRejected],
          ),
          INTEGRITY,
        );
        await rejects(
          client.query(
            "UPDATE approvals SET note = 'edited' WHERE tenant_id = $1 AND id = $2",
            [alpha.tenant, alpha.approvalApproved],
          ),
          INTEGRITY,
        );
        // A draft version's content never changes; its status may.
        await rejects(
          client.query(
            "UPDATE drafts SET body = 'edited' WHERE tenant_id = $1 AND id = $2",
            [alpha.tenant, alpha.draftSharedV2],
          ),
          INTEGRITY,
        );
        await client.query(
          "UPDATE drafts SET status = 'SUPERSEDED' WHERE tenant_id = $1 AND id = $2",
          [alpha.tenant, alpha.draftOwnV1],
        );
        await client.query(
          "UPDATE drafts SET status = 'PENDING_APPROVAL' WHERE tenant_id = $1 AND id = $2",
          [alpha.tenant, alpha.draftOwnV1],
        );
      });

      it('enforces unique enrollment, step intent and provider keys', async () => {
        // The same contact twice in one campaign.
        await rejects(
          insert('campaign_leads', {
            tenant_id: alpha.tenant,
            id: newId(),
            campaign_id: alpha.campaign,
            sequence_id: alpha.sequence,
            contact_id: alpha.contactShared,
            timezone: 'UTC',
            updated_at: now(),
          }),
          UNIQUE,
        );
        // A second intent for a lead and step that already has one.
        await rejects(
          insert(
            'outbound_intents',
            intent({
              campaign_lead_id: alpha.leadShared,
              draft_id: alpha.draftSharedV2,
            }),
          ),
          UNIQUE,
        );
        // A redelivered provider notification.
        const event = {
          tenant_id: alpha.tenant,
          provider: 'GMAIL',
          event_key: 'fake-notification-0001',
          payload: {},
          payload_sha256: '0'.repeat(64),
        };
        await rejects(
          insert('inbound_events', { ...event, id: newId() }),
          UNIQUE,
        );
        // The same message delivered twice to one mailbox.
        await rejects(
          insert('inbound_messages', {
            tenant_id: alpha.tenant,
            id: newId(),
            email_account_id: alpha.emailAccount,
            email_thread_id: alpha.thread,
            provider_message_id: 'fake-msg-0002',
            from_email: 'x@example.test',
            received_at: now(),
          }),
          UNIQUE,
        );
        // A provider message id reused within one mailbox.
        await rejects(
          insert(
            'outbound_attempts',
            attempt({ provider_message_id: 'fake-msg-0001' }),
          ),
          UNIQUE,
        );
        // Positive controls: the same key for another provider is a different event.
        const otherProvider = newId();
        await insert('inbound_events', {
          ...event,
          id: otherProvider,
          provider: 'APOLLO',
        });
        await client.query(
          'DELETE FROM inbound_events WHERE tenant_id = $1 AND id = $2',
          [alpha.tenant, otherProvider],
        );
      });

      it('scopes provider ids per mailbox and keeps messages in their mailbox', async () => {
        const mailbox = newId();
        const thread = newId();
        await insert('email_accounts', {
          tenant_id: alpha.tenant,
          id: mailbox,
          provider: 'GMAIL',
          email: 'second@fixture-alpha.test',
          normalized_email: 'second@fixture-alpha.test',
          updated_at: now(),
        });
        try {
          // The same provider thread and message ids in a second mailbox are fine.
          await insert('email_threads', {
            tenant_id: alpha.tenant,
            id: thread,
            email_account_id: mailbox,
            provider_thread_id: 'fake-thread-0001',
            updated_at: now(),
          });
          await insert('inbound_messages', {
            tenant_id: alpha.tenant,
            id: newId(),
            email_account_id: mailbox,
            email_thread_id: thread,
            provider_message_id: 'fake-msg-0002',
            from_email: 'x@example.test',
            received_at: now(),
          });
          // A message of this mailbox filed in the first mailbox's thread.
          await rejects(
            insert('inbound_messages', {
              tenant_id: alpha.tenant,
              id: newId(),
              email_account_id: mailbox,
              email_thread_id: alpha.thread,
              provider_message_id: 'fake-msg-0003',
              from_email: 'x@example.test',
              received_at: now(),
            }),
            FOREIGN_KEY,
          );
          // The same address cannot be connected twice.
          await rejects(
            insert('email_accounts', {
              tenant_id: alpha.tenant,
              id: newId(),
              provider: 'MICROSOFT_GRAPH',
              email: 'SECOND@fixture-alpha.test',
              normalized_email: 'second@fixture-alpha.test',
              updated_at: now(),
            }),
            UNIQUE,
          );
        } finally {
          await client.query(
            'DELETE FROM email_threads WHERE tenant_id = $1 AND id = $2',
            [alpha.tenant, thread],
          );
          await client.query(
            'DELETE FROM email_accounts WHERE tenant_id = $1 AND id = $2',
            [alpha.tenant, mailbox],
          );
        }
      });

      it('never starts an attempt while another is in flight or sent', async () => {
        // Attempt 2 was SENT, so a new SENDING attempt is refused.
        await rejects(
          insert(
            'outbound_attempts',
            attempt({
              status: 'SENDING',
              error_code: null,
              retryable: null,
              finished_at: null,
            }),
          ),
          UNIQUE,
        );
        // A FAILED attempt is outside the partial index.
        const failed = newId();
        await insert('outbound_attempts', attempt({ id: failed }));
        await client.query(
          'DELETE FROM outbound_attempts WHERE tenant_id = $1 AND id = $2',
          [alpha.tenant, failed],
        );
        // Two live versions of one draft.
        await rejects(
          insert(
            'drafts',
            draft({ sequence_step_id: alpha.stepIntro, version: 2 }),
          ),
          UNIQUE,
        );
        await rejects(
          insert(
            'drafts',
            draft({
              sequence_step_id: alpha.stepIntro,
              version: 1,
              status: 'SUPERSEDED',
            }),
          ),
          UNIQUE,
        );
      });

      it('accepts only IANA time zones', async () => {
        for (const zone of [
          'EST5EDT',
          'EST',
          '+05:00',
          'america/new_york',
          'Mars/Olympus',
          '',
        ]) {
          await rejects(
            client.query(
              'UPDATE campaigns SET timezone = $3 WHERE tenant_id = $1 AND id = $2',
              [alpha.tenant, alpha.campaign, zone],
            ),
            CHECK,
          );
        }
        await rejects(
          client.query(
            "UPDATE tenant_settings SET timezone = 'GMT' WHERE tenant_id = $1",
            [alpha.tenant],
          ),
          CHECK,
        );
        await rejects(
          client.query(
            "UPDATE campaign_leads SET timezone = 'PST' WHERE tenant_id = $1 AND id = $2",
            [alpha.tenant, alpha.leadOwn],
          ),
          CHECK,
        );
        await rejects(
          insert('outbound_intents', intent({ scheduled_timezone: 'UTC+2' })),
          CHECK,
        );
        await rejects(
          client.query(
            "UPDATE job_schedules SET timezone = 'Japan' WHERE tenant_id = $1 AND id = $2",
            [alpha.tenant, alpha.schedule],
          ),
          CHECK,
        );
        await client.query(
          "UPDATE campaigns SET timezone = 'Asia/Kolkata' WHERE tenant_id = $1 AND id = $2",
          [alpha.tenant, alpha.campaign],
        );
        await client.query(
          "UPDATE campaigns SET timezone = 'America/New_York' WHERE tenant_id = $1 AND id = $2",
          [alpha.tenant, alpha.campaign],
        );
      });

      it('stores secret references, never token-shaped values', async () => {
        for (const value of TOKEN_SHAPED) {
          await rejects(
            client.query(
              'UPDATE email_accounts SET secret_ref = $3 WHERE tenant_id = $1 AND id = $2',
              [alpha.tenant, alpha.emailAccount, value],
            ),
            CHECK,
          );
        }
        // Active mailboxes need credentials; disconnected ones must have none left.
        await rejects(
          client.query(
            'UPDATE email_accounts SET secret_ref = NULL WHERE tenant_id = $1 AND id = $2',
            [alpha.tenant, alpha.emailAccount],
          ),
          CHECK,
        );
        await rejects(
          client.query(
            "UPDATE email_accounts SET status = 'DISCONNECTED' WHERE tenant_id = $1 AND id = $2",
            [alpha.tenant, alpha.emailAccount],
          ),
          CHECK,
        );
      });

      it('enforces value rules', async () => {
        const campaign = (sql: string, params: unknown[] = []) =>
          client.query(
            `UPDATE campaigns SET ${sql} WHERE tenant_id = $1 AND id = $2`,
            [alpha.tenant, alpha.campaign, ...params],
          );
        for (const days of [[], [0], [8], [1, 1], null]) {
          await rejects(campaign('send_weekdays = $3', [days]), CHECK);
        }
        await rejects(
          campaign(
            'send_window_start_minute = 1020, send_window_end_minute = 540',
          ),
          CHECK,
        );
        await rejects(campaign("status = 'PAUSED'"), CHECK); // paused_at missing
        await campaign("status = 'PAUSED', paused_at = now()");
        await campaign("status = 'ACTIVE', paused_at = NULL");
        await rejects(
          client.query(
            "UPDATE campaign_leads SET status = 'ACTIVE' WHERE tenant_id = $1 AND id = $2",
            [alpha.tenant, alpha.leadShared], // still has a stop reason
          ),
          CHECK,
        );
        await rejects(
          insert('drafts', draft({ source: 'AI' })), // no model or prompt version
          CHECK,
        );
        await rejects(insert('drafts', draft({ subject: '' })), CHECK);
        await rejects(
          insert(
            'outbound_attempts',
            attempt({
              status: 'SENT',
              error_code: null,
              retryable: null,
            }), // no provider message id
          ),
          CHECK,
        );
        await rejects(
          insert(
            'outbound_attempts',
            attempt({ internet_message_id: 'not-a-message-id' }),
          ),
          CHECK,
        );
        const suppression = (email: string | null, domain: string | null) =>
          insert('suppressions', {
            tenant_id: alpha.tenant,
            id: newId(),
            normalized_email: email,
            normalized_domain: domain,
            reason: 'MANUAL',
            source: 'MANUAL',
          });
        await rejects(suppression('a@x.test', 'x.test'), CHECK);
        await rejects(suppression(null, null), CHECK);
        await rejects(suppression('Opted.Out@x.test', null), CHECK);
        await rejects(
          suppression('opted.out@shared-prospect.test', null),
          UNIQUE,
        );
        const schedule = (row: Record<string, unknown>) =>
          insert('job_schedules', {
            tenant_id: alpha.tenant,
            id: newId(),
            name: `schedule ${newId()}`,
            job_type: 'mailbox.sync',
            updated_at: now(),
            ...row,
          });
        await rejects(
          schedule({ cron_expression: '0 9 * * 1', interval_seconds: 300 }),
          CHECK,
        );
        await rejects(schedule({}), CHECK);
        await rejects(schedule({ cron_expression: 'every morning' }), CHECK);
        await rejects(
          schedule({ interval_seconds: 300, job_type: 'Mailbox Sync' }),
          CHECK,
        );
        await rejects(
          insert('job_runs', {
            tenant_id: alpha.tenant,
            id: newId(),
            job_type: 'campaign.dispatch',
            trigger: 'SCHEDULE', // a scheduled run needs its schedule
            scheduled_for: now(),
            updated_at: now(),
          }),
          CHECK,
        );
        await rejects(
          insert('job_runs', {
            tenant_id: alpha.tenant,
            id: newId(),
            schedule_id: alpha.schedule,
            job_type: 'campaign.dispatch',
            trigger: 'SCHEDULE',
            scheduled_for: new Date('2026-10-06T13:30:00Z'), // same occurrence
            updated_at: now(),
          }),
          UNIQUE,
        );
        await rejects(
          insert('job_tasks', {
            tenant_id: alpha.tenant,
            id: newId(),
            task_type: 'outbound.send',
            idempotency_key: `outbound_intent:${alpha.intent}`,
            payload: {},
            updated_at: now(),
          }),
          UNIQUE,
        );
        await rejects(
          insert('integration_sync_cursors', {
            tenant_id: alpha.tenant,
            id: newId(),
            provider: 'GMAIL',
            resource: 'gmail.history',
            scope_key: 'another-scope',
            email_account_id: alpha.emailAccount, // scope must be the account id
            updated_at: now(),
          }),
          CHECK,
        );
        await rejects(
          insert('worker_leases', {
            tenant_id: alpha.tenant,
            id: newId(),
            resource_type: 'email_account.send',
            resource_id: alpha.emailAccount,
            holder_id: 'worker-2',
            expires_at: new Date(Date.now() + 60_000),
          }),
          UNIQUE,
        );
      });

      it('hands a lease to one worker at a time, with a new fencing token', async () => {
        const acquire = (holder: string) =>
          client.query<{ holder_id: string; fencing_token: string }>(
            `INSERT INTO worker_leases (tenant_id, id, resource_type, resource_id, holder_id, acquired_at, expires_at)
             VALUES ($1, $2, 'email_account.send', $3, $4, now(), now() + interval '60 seconds')
             ON CONFLICT (tenant_id, resource_type, resource_id) DO UPDATE
               SET holder_id = EXCLUDED.holder_id,
                   fencing_token = worker_leases.fencing_token + 1,
                   acquired_at = EXCLUDED.acquired_at,
                   expires_at = EXCLUDED.expires_at
             WHERE worker_leases.expires_at <= now()
             RETURNING holder_id, fencing_token`,
            [alpha.tenant, newId(), alpha.emailAccount, holder],
          );
        // The fixture lease (token 2) expired long ago.
        const first = await acquire('worker-b');
        expect(first.rows).toEqual([
          { holder_id: 'worker-b', fencing_token: '3' },
        ]);
        const second = await acquire('worker-c');
        expect(second.rows).toEqual([]);
      });

      it('never lets a row move to another tenant', async () => {
        await rejects(
          client.query(
            'UPDATE campaigns SET tenant_id = $1 WHERE tenant_id = $2 AND id = $3',
            [beta.tenant, alpha.tenant, alpha.campaign],
          ),
          INTEGRITY,
        );
        await rejects(
          client.query(
            'UPDATE suppressions SET tenant_id = $1 WHERE tenant_id = $2',
            [beta.tenant, alpha.tenant],
          ),
          INTEGRITY,
        );
      });

      it('protects referenced rows (NO ACTION)', async () => {
        for (const [table, id] of [
          ['email_accounts', alpha.emailAccount],
          ['templates', alpha.templateIntro],
          ['memberships', alpha.membershipAdmin],
          ['sequence_steps', alpha.stepIntro],
        ] as const) {
          await rejects(
            client.query(
              `DELETE FROM "${table}" WHERE tenant_id = $1 AND id = $2`,
              [alpha.tenant, id],
            ),
            FOREIGN_KEY,
          );
        }
      });

      it("erases a contact's outreach history but keeps the suppression list", async () => {
        await client.query(
          'DELETE FROM contacts WHERE tenant_id = $1 AND id = $2',
          [alpha.tenant, alpha.contactShared],
        );
        const left = (table: string, column: string, id: string) =>
          count(
            `SELECT count(*) AS n FROM "${table}" WHERE tenant_id = $1 AND "${column}" = $2`,
            [alpha.tenant, id],
          );
        expect(await left('campaign_leads', 'id', alpha.leadShared)).toBe(0);
        expect(await left('drafts', 'campaign_lead_id', alpha.leadShared)).toBe(
          0,
        );
        expect(await left('approvals', 'draft_id', alpha.draftSharedV2)).toBe(
          0,
        );
        expect(await left('outbound_intents', 'id', alpha.intent)).toBe(0);
        expect(
          await left('outbound_attempts', 'outbound_intent_id', alpha.intent),
        ).toBe(0);
        expect(await left('email_threads', 'id', alpha.thread)).toBe(0);
        expect(
          await left('inbound_messages', 'email_thread_id', alpha.thread),
        ).toBe(0);
        expect(
          await count(
            'SELECT count(*) AS n FROM suppressions WHERE tenant_id = $1',
            [alpha.tenant],
          ),
        ).toBe(2);
        expect(
          await count(
            'SELECT count(*) AS n FROM outbound_intents WHERE tenant_id = $1',
            [beta.tenant],
          ),
        ).toBe(1);
      });

      it('deletes a campaign with its sequences, leads and schedules', async () => {
        await client.query(
          'DELETE FROM campaigns WHERE tenant_id = $1 AND id = $2',
          [alpha.tenant, alpha.campaign],
        );
        const remaining = async (table: string) =>
          count(`SELECT count(*) AS n FROM "${table}" WHERE tenant_id = $1`, [
            alpha.tenant,
          ]);
        for (const table of [
          'sequences',
          'sequence_steps',
          'campaign_leads',
          'drafts',
          'job_runs',
        ]) {
          expect(await remaining(table), table).toBe(0);
        }
        // The mailbox sync schedule, the task without a run, the templates and the mailbox are
        // not part of the campaign.
        expect(
          await count(
            'SELECT count(*) AS n FROM job_schedules WHERE tenant_id = $1 AND campaign_id IS NULL',
            [alpha.tenant],
          ),
        ).toBe(1);
        expect(await remaining('job_schedules')).toBe(1);
        expect(await remaining('job_tasks')).toBe(1);
        expect(await remaining('templates')).toBe(2);
        expect(await remaining('email_accounts')).toBe(1);
      });

      it('deletes a whole tenant and nothing else', async () => {
        const tables = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.columns
            WHERE table_schema = $1 AND column_name = 'tenant_id' ORDER BY table_name`,
          [db.name],
        );
        const tenantTables = tables.rows.map((r) => r.table_name);
        // One query at a time: a pg client must not run queries concurrently.
        const rowsByTable = async (tenantId: string) => {
          const counts: Record<string, number> = {};
          for (const table of tenantTables) {
            counts[table] = await count(
              `SELECT count(*) AS n FROM "${table}" WHERE tenant_id = $1`,
              [tenantId],
            );
          }
          return counts;
        };
        const alphaBefore = await rowsByTable(alpha.tenant);
        await client.query('DELETE FROM tenants WHERE id = $1', [beta.tenant]);
        expect(await rowsByTable(beta.tenant)).toEqual(
          Object.fromEntries(tenantTables.map((t) => [t, 0])),
        );
        expect(await rowsByTable(alpha.tenant)).toEqual(alphaBefore);
      });
    });
  },
);

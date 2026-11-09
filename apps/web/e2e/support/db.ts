// Direct database access for the browser scenarios. The application emails links (fake mail
// provider, in the API process); the scenarios stand in for the inbox by issuing a token they
// know, the way the API stores one (SHA-256 at rest), and by reading audit records.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertTestDatabaseUrl } from '@lead-fennec-ai/database';
import pg from 'pg';
import { e2eDatabaseUrl } from './env';

const sha256Hex = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export class E2eDatabase {
  private constructor(private readonly client: pg.Client) {}

  static async connect(): Promise<E2eDatabase> {
    const client = new pg.Client({
      connectionString: assertTestDatabaseUrl(
        e2eDatabaseUrl ?? '',
        'E2E_DATABASE_URL',
      ),
    });
    await client.connect();
    return new E2eDatabase(client);
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  private async poll<T>(
    what: string,
    read: () => Promise<T | undefined>,
  ): Promise<T> {
    for (let i = 0; i < 100; i += 1) {
      const value = await read();
      if (value !== undefined) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  /** The user's id, once the (asynchronous) registration has created it. */
  async userId(email: string): Promise<string> {
    return this.poll(`the user ${email}`, async () => {
      const { rows } = await this.client.query<{ id: string }>(
        'SELECT id FROM users WHERE normalized_email = $1',
        [email.toLowerCase()],
      );
      return rows[0]?.id;
    });
  }

  /**
   * Replaces the open token the application emailed (after it exists) with one the scenario
   * knows, and returns that token: the scenario's "inbox".
   */
  async issueToken(
    email: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ): Promise<string> {
    const userId = await this.userId(email);
    await this.poll(`the emailed ${purpose} token`, async () => {
      const { rowCount } = await this.client.query(
        `SELECT 1 FROM auth_tokens
          WHERE user_id = $1 AND purpose = $2::auth_token_purpose AND used_at IS NULL`,
        [userId, purpose],
      );
      return rowCount === 0 ? undefined : true;
    });
    const token = randomBytes(32).toString('base64url');
    await this.client.query(
      `DELETE FROM auth_tokens
        WHERE user_id = $1 AND purpose = $2::auth_token_purpose AND used_at IS NULL`,
      [userId, purpose],
    );
    await this.client.query(
      `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, email, created_at, expires_at)
       VALUES ($1, $2, $3::auth_token_purpose, $4, $5, now(), now() + interval '30 minutes')`,
      [randomUUID(), userId, purpose, sha256Hex(token), email.toLowerCase()],
    );
    return token;
  }

  async makePlatformAdmin(email: string): Promise<void> {
    await this.client.query(
      'UPDATE users SET is_platform_admin = true WHERE id = $1',
      [await this.userId(email)],
    );
  }

  /**
   * Stands in for the invitation email: replaces the open invitation for `email` (if any) with
   * one whose token the scenario knows. `expired` creates one that ran out yesterday.
   */
  async issueInvitation(input: {
    workspaceId: string;
    email: string;
    roleKey: 'client_admin' | 'client_member';
    expired?: boolean;
  }): Promise<string> {
    const normalized = input.email.toLowerCase();
    const { rows } = await this.client.query<{
      role_id: string;
      inviter_id: string;
    }>(
      `SELECT r.id AS role_id, m.id AS inviter_id
         FROM roles r
         JOIN memberships m ON m.tenant_id = r.tenant_id
         JOIN roles admin_role ON admin_role.tenant_id = m.tenant_id
                              AND admin_role.id = m.role_id
                              AND admin_role.key = 'client_admin'
        WHERE r.tenant_id = $1 AND r.key = $2 AND m.status = 'ACTIVE'
        LIMIT 1`,
      [input.workspaceId, input.roleKey],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error('No admin membership or role in that workspace');
    }
    await this.client.query(
      `UPDATE invitations SET revoked_at = now()
        WHERE tenant_id = $1 AND normalized_email = $2
          AND accepted_at IS NULL AND revoked_at IS NULL`,
      [input.workspaceId, normalized],
    );
    const token = randomBytes(32).toString('base64url');
    const created =
      input.expired === true ? "now() - interval '8 days'" : 'now()';
    const expires =
      input.expired === true
        ? "now() - interval '1 day'"
        : "now() + interval '7 days'";
    await this.client.query(
      `INSERT INTO invitations (tenant_id, id, email, normalized_email, role_id,
                                invited_by_membership_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ${expires}, ${created})`,
      [
        input.workspaceId,
        randomUUID(),
        input.email,
        normalized,
        row.role_id,
        row.inviter_id,
        sha256Hex(token),
      ],
    );
    return token;
  }

  /**
   * Rows for the dashboard (task 05C), as later features will create them: 2 companies, 3
   * active contacts (2 with email) and 1 archived, a running and a draft campaign with 2 leads,
   * and a Gmail mailbox that needs reconnecting. Addresses use example.com (fake data).
   */
  async seedDashboard(workspaceId: string, run: string): Promise<void> {
    const q = (sql: string, values: unknown[]) =>
      this.client.query(sql, [workspaceId, ...values]);
    for (const name of ['Example Corp', 'Sample Ltd']) {
      await q(
        `INSERT INTO organizations (tenant_id, id, name, updated_at)
         VALUES ($1, $2, $3, now())`,
        [randomUUID(), name],
      );
    }
    const contact = async (
      email: string | null,
      status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE',
    ) => {
      const id = randomUUID();
      await q(
        `INSERT INTO contacts (tenant_id, id, first_name, email, normalized_email, email_domain,
                               status, updated_at)
         VALUES ($1, $2, 'Fixture', $3, $3, $4, $5::contact_status, now())`,
        [id, email, email === null ? null : 'example.com', status],
      );
      return id;
    };
    const first = await contact(`lead1.${run}@example.com`);
    const second = await contact(`lead2.${run}@example.com`);
    await contact(null);
    await contact(`archived.${run}@example.com`, 'ARCHIVED');
    const campaignId = randomUUID();
    await q(
      `INSERT INTO campaigns (tenant_id, id, name, status, activated_at, updated_at)
       VALUES ($1, $2, 'Autumn outreach', 'ACTIVE', now(), now())`,
      [campaignId],
    );
    await q(
      `INSERT INTO campaigns (tenant_id, id, name, updated_at)
       VALUES ($1, $2, 'Winter draft', now())`,
      [randomUUID()],
    );
    const sequenceId = randomUUID();
    await q(
      `INSERT INTO sequences (tenant_id, id, campaign_id, name, updated_at)
       VALUES ($1, $2, $3, 'Main', now())`,
      [sequenceId, campaignId],
    );
    for (const contactId of [first, second]) {
      await q(
        `INSERT INTO campaign_leads (tenant_id, id, campaign_id, sequence_id, contact_id,
                                     status, timezone, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'UTC', now())`,
        [randomUUID(), campaignId, sequenceId, contactId],
      );
    }
    await q(
      `INSERT INTO email_accounts (tenant_id, id, provider, email, normalized_email, status,
                                   updated_at)
       VALUES ($1, $2, 'GMAIL', $3, $3, 'ERROR', now())`,
      [randomUUID(), `sender.${run}@example.com`],
    );
  }

  /**
   * What a campaign may reference (task 06B), as later features will create it: an ideal
   * customer profile, a lead list, a template and a mailbox still waiting for authorization.
   * Fake data on example.com. Returns the ids.
   */
  async seedCampaignChoices(
    workspaceId: string,
    run: string,
  ): Promise<{
    icp: string;
    leadList: string;
    template: string;
    mailbox: string;
  }> {
    const ids = {
      icp: randomUUID(),
      leadList: randomUUID(),
      template: randomUUID(),
      mailbox: randomUUID(),
    };
    await this.client.query(
      `INSERT INTO icps (tenant_id, id, name, criteria, updated_at)
       VALUES ($1, $2, 'Mid-market software', '{}', now())`,
      [workspaceId, ids.icp],
    );
    await this.client.query(
      `INSERT INTO lead_lists (tenant_id, id, name, updated_at)
       VALUES ($1, $2, 'Autumn prospects', now())`,
      [workspaceId, ids.leadList],
    );
    await this.client.query(
      `INSERT INTO templates (tenant_id, id, name, subject, body, updated_at)
       VALUES ($1, $2, 'First touch', 'Hello', 'Hello {{firstName}}', now())`,
      [workspaceId, ids.template],
    );
    await this.client.query(
      `INSERT INTO email_accounts (tenant_id, id, provider, email, normalized_email, status,
                                   updated_at)
       VALUES ($1, $2, 'GMAIL', $3, $3, 'PENDING', now())`,
      [workspaceId, ids.mailbox, `sender.${run}@example.com`],
    );
    return ids;
  }

  /** Starts a campaign the way later tasks will (task 06B tests read-only campaigns). */
  async markCampaignRunning(campaignId: string): Promise<void> {
    await this.client.query(
      `UPDATE campaigns SET status = 'ACTIVE', activated_at = now() WHERE id = $1`,
      [campaignId],
    );
  }

  /** Lets the user's open sessions reach their idle timeout now (the next request gets 401). */
  async expireSessions(email: string): Promise<void> {
    const userId = await this.userId(email);
    await this.client.query(
      `UPDATE user_sessions SET idle_expires_at = now() - interval '1 second'
        WHERE user_id = $1 AND ended_at IS NULL`,
      [userId],
    );
  }

  /** Actions of the platform audit records about one user (security events). */
  async securityActions(email: string): Promise<string[]> {
    const userId = await this.userId(email);
    const { rows } = await this.client.query<{ action: string }>(
      `SELECT action FROM platform_audit_records
        WHERE actor_user_id = $1 OR target_id = $1 ORDER BY id`,
      [userId],
    );
    return rows.map((row) => row.action);
  }

  async workspaceAuditActions(workspaceId: string): Promise<string[]> {
    const { rows } = await this.client.query<{ action: string }>(
      'SELECT action FROM audit_records WHERE tenant_id = $1 ORDER BY id',
      [workspaceId],
    );
    return rows.map((row) => row.action);
  }

  /** Every audit record (tenant and platform) as text, to search for leaked secrets. */
  async allAuditText(): Promise<string> {
    const tenant = await this.client.query('SELECT * FROM audit_records');
    const platform = await this.client.query(
      'SELECT * FROM platform_audit_records',
    );
    return JSON.stringify([tenant.rows, platform.rows]);
  }

  /** An active ideal customer profile with these criteria (task 07C). */
  async seedIcp(
    workspaceId: string,
    name: string,
    criteria: object,
  ): Promise<string> {
    const id = randomUUID();
    await this.client.query(
      `INSERT INTO icps (tenant_id, id, name, criteria, status, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
      [workspaceId, id, name, JSON.stringify(criteria)],
    );
    return id;
  }

  /** A domain the workspace must never contact (task 07C). */
  async seedSuppressedDomain(workspaceId: string, domain: string) {
    await this.client.query(
      `INSERT INTO suppressions (tenant_id, id, normalized_domain, reason, source)
       VALUES ($1, $2, $3, 'MANUAL', 'MANUAL')`,
      [workspaceId, randomUUID(), domain],
    );
  }

  /** The queued job task of a search (task 07C). */
  async searchTaskId(workspaceId: string, importId: string): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `SELECT id FROM job_tasks
       WHERE tenant_id = $1 AND task_type = 'lead_discovery.search' AND idempotency_key = $2`,
      [workspaceId, `import:${importId}`],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('No task for this search');
    }
    return id;
  }

  /** A company with a synthetic website (task 09C); the fake fetcher serves its pages. */
  async seedOrganization(
    workspaceId: string,
    name: string,
    websiteUrl: string,
  ): Promise<string> {
    const id = randomUUID();
    await this.client.query(
      `INSERT INTO organizations (tenant_id, id, name, website_url, updated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [workspaceId, id, name, websiteUrl],
    );
    return id;
  }

  /** The queued job task of a website research (task 09C). */
  async researchTaskId(
    workspaceId: string,
    researchId: string,
  ): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `SELECT id FROM job_tasks
       WHERE tenant_id = $1 AND task_type = 'website_research.run' AND idempotency_key = $2`,
      [workspaceId, `research:${researchId}`],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('No task for this research');
    }
    return id;
  }

  /** The newest research of a company (task 09C). */
  async latestResearchId(
    workspaceId: string,
    organizationId: string,
  ): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `SELECT id FROM research WHERE tenant_id = $1 AND organization_id = $2
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [workspaceId, organizationId],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('No research for this company');
    }
    return id;
  }

  /**
   * A campaign lead to qualify (task 10C): a US software company's VP Sales on a new lead
   * list, with a recent email check and a recorded source. Synthetic (.example) data.
   */
  async seedQualificationLead(
    workspaceId: string,
    run: string,
  ): Promise<{
    readonly listId: string;
    readonly organizationId: string;
    readonly contactId: string;
    readonly email: string;
  }> {
    const listId = randomUUID();
    const organizationId = randomUUID();
    const contactId = randomUUID();
    const domain = `${run}.example`;
    const email = `quinn@${domain}`;
    await this.client.query(
      `INSERT INTO lead_lists (tenant_id, id, name, updated_at) VALUES ($1, $2, $3, now())`,
      [workspaceId, listId, `Prospects ${run}`],
    );
    await this.client.query(
      `INSERT INTO organizations (tenant_id, id, name, website_url, normalized_domain, industry, employee_count, country_code, updated_at)
       VALUES ($1, $2, 'Quill Software (synthetic)', $3, $4, 'software', 120, 'US', now())`,
      [workspaceId, organizationId, `https://${domain}/`, domain],
    );
    await this.client.query(
      `INSERT INTO contacts (tenant_id, id, organization_id, first_name, last_name, title, email, normalized_email, email_domain, country_code, updated_at)
       VALUES ($1, $2, $3, 'Quinn', 'Park', 'VP Sales', $4, $4, $5, 'US', now())`,
      [workspaceId, contactId, organizationId, email, domain],
    );
    await this.client.query(
      `INSERT INTO lead_list_members (tenant_id, lead_list_id, contact_id) VALUES ($1, $2, $3)`,
      [workspaceId, listId, contactId],
    );
    await this.client.query(
      `INSERT INTO verifications (tenant_id, id, contact_id, normalized_email, provider, status, checked_at)
       VALUES ($1, $2, $3, $4, 'fake', 'VALID', now() - interval '1 hour')`,
      [workspaceId, randomUUID(), contactId, email],
    );
    await this.client.query(
      `INSERT INTO source_records (tenant_id, id, provider, contact_id, payload, payload_sha256)
       VALUES ($1, $2, 'APOLLO', $3, '{}', $4)`,
      [workspaceId, randomUUID(), contactId, 'a'.repeat(64)],
    );
    return { listId, organizationId, contactId, email };
  }

  /** The newest queued qualification of a workspace (task 10C). */
  async qualificationTaskId(workspaceId: string): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `SELECT id FROM job_tasks
       WHERE tenant_id = $1 AND task_type = 'lead_qualification.run' AND status = 'PENDING'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [workspaceId],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('No queued qualification');
    }
    return id;
  }

  /** A lead list of the workspace (task 08C). */
  async seedLeadList(workspaceId: string, name: string): Promise<string> {
    const id = randomUUID();
    await this.client.query(
      `INSERT INTO lead_lists (tenant_id, id, name, updated_at)
       VALUES ($1, $2, $3, now())`,
      [workspaceId, id, name],
    );
    return id;
  }

  /** The queued job task of a contact enrichment run (task 08C). */
  async enrichmentTaskId(
    workspaceId: string,
    importId: string,
  ): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `SELECT id FROM job_tasks
       WHERE tenant_id = $1 AND task_type = 'contact_enrichment.run' AND idempotency_key = $2`,
      [workspaceId, `import:${importId}`],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('No task for this enrichment run');
    }
    return id;
  }

  /** The queued job task of a people import (task 11C). */
  async contactImportTaskId(
    workspaceId: string,
    importId: string,
  ): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `SELECT id FROM job_tasks
       WHERE tenant_id = $1 AND task_type = 'contact_import.run' AND idempotency_key = $2`,
      [workspaceId, `import:${importId}`],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('No task for this people import');
    }
    return id;
  }

  /** What the do-not-contact list keeps for an address (task 11C). */
  async suppressionOf(workspaceId: string, email: string) {
    const { rows } = await this.client.query<{
      reason: string;
      note: string | null;
    }>(
      `SELECT reason::text AS reason, note FROM suppressions
       WHERE tenant_id = $1 AND normalized_email = $2`,
      [workspaceId, email],
    );
    return rows[0] ?? null;
  }

  /** The newest queued recheck of a contact's address (task 08C). */
  async recheckTaskId(workspaceId: string, contactId: string): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `SELECT id FROM job_tasks
       WHERE tenant_id = $1 AND task_type = 'contact_verification.recheck'
         AND idempotency_key LIKE $2 AND status = 'PENDING'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [workspaceId, `contact_recheck:${contactId}:%`],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('No queued recheck');
    }
    return id;
  }

  /** How many contacts the workspace has (task 08C). */
  async contactCount(workspaceId: string): Promise<number> {
    const { rows } = await this.client.query<{ count: string }>(
      'SELECT count(*) AS count FROM contacts WHERE tenant_id = $1',
      [workspaceId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** An address the workspace must never contact (task 10C). */
  async seedSuppressedEmail(workspaceId: string, email: string) {
    await this.client.query(
      `INSERT INTO suppressions (tenant_id, id, normalized_email, reason, source)
       VALUES ($1, $2, $3, 'OPT_OUT', 'MANUAL')`,
      [workspaceId, randomUUID(), email],
    );
  }

  async organizationCount(workspaceId: string): Promise<number> {
    const { rows } = await this.client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM organizations WHERE tenant_id = $1',
      [workspaceId],
    );
    return rows[0]?.n ?? 0;
  }

  /** Marks a run as failed the way the worker does (task 07C). */
  async failRun(workspaceId: string, importId: string, errorCode: string) {
    await this.client.query(
      `UPDATE imports SET status = 'FAILED', error_code = $3, started_at = now(), completed_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [workspaceId, importId, errorCode],
    );
  }
}

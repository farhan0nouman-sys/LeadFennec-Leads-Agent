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
}

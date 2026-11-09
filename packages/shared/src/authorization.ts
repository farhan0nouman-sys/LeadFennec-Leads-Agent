// Permission catalog and system roles (task 04B, docs/decisions.md D-04B-02): the single
// source of truth. The `permissions` table is synced from it when a workspace is created,
// every workspace gets the system roles with these grants, and the API checks keys from it.
// Pure data: safe for the web app (e.g. to hide controls the user cannot use).

export const PERMISSION_CATALOG = [
  {
    key: 'members.read',
    description: 'View the team, its roles and invitations',
  },
  {
    key: 'members.manage',
    description: 'Invite members, revoke invitations and change roles',
  },
  { key: 'settings.manage', description: 'Change workspace settings' },
  { key: 'icps.read', description: 'View ideal customer profiles' },
  { key: 'icps.write', description: 'Create and edit ideal customer profiles' },
  { key: 'contacts.read', description: 'View organizations and contacts' },
  {
    key: 'contacts.write',
    description: 'Create and edit organizations and contacts',
  },
  // Task 11C: a file of leads leaves the app, so it needs its own grant (Client Admins only).
  {
    key: 'contacts.export',
    description: 'Export leads to a file',
  },
  { key: 'lead_lists.read', description: 'View lead lists' },
  { key: 'lead_lists.write', description: 'Create and edit lead lists' },
  { key: 'imports.create', description: 'Import contacts' },
  { key: 'research.run', description: 'Run research' },
  { key: 'scores.read', description: 'View scores' },
  { key: 'verifications.run', description: 'Verify email addresses' },
  { key: 'campaigns.read', description: 'View campaigns and their leads' },
  {
    key: 'campaigns.write',
    description: 'Create and edit campaigns, sequences and drafts',
  },
  { key: 'drafts.approve', description: 'Approve or reject outbound drafts' },
  { key: 'email_accounts.manage', description: 'Connect and manage mailboxes' },
  { key: 'suppressions.manage', description: 'Manage the suppression list' },
  {
    key: 'billing.read',
    description: 'View the subscription, usage and payments',
  },
  { key: 'branding.manage', description: 'Change the workspace branding' },
  { key: 'audit.read', description: 'View the audit records' },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map(
  (permission) => permission.key,
);

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/**
 * Roles every workspace starts with. `client_admin` holds every permission; a workspace always
 * keeps at least one active Client Admin.
 */
export const SYSTEM_ROLES = {
  client_admin: {
    key: 'client_admin',
    name: 'Client Admin',
    permissions: PERMISSION_KEYS,
  },
  client_member: {
    key: 'client_member',
    name: 'Client Team Member',
    permissions: [
      'members.read',
      'icps.read',
      'contacts.read',
      'contacts.write',
      'lead_lists.read',
      'lead_lists.write',
      'imports.create',
      'research.run',
      'scores.read',
      'campaigns.read',
      'campaigns.write',
    ] as const satisfies readonly PermissionKey[],
  },
} as const;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export const ADMIN_ROLE_KEY: SystemRoleKey = 'client_admin';

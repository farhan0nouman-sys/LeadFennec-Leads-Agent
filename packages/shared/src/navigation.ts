// The app's pages, their navigation groups and the permission each needs (task 05A,
// docs/decisions.md D-05A-02). One list for the web app (navigation, breadcrumbs, the server-side
// page checks) and the API's route test (every API route of a section requires the section's
// permission). Pure data and functions: safe for web, API and worker.
import type { PermissionKey } from './authorization.js';

/**
 * `available`: built. `unavailable`: the page exists as a shell that says so; its actions are
 * disabled and there is no API behind it yet.
 */
export type SectionStatus = 'available' | 'unavailable';

export const SECTION_GROUPS = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'prospecting', label: 'Prospecting' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'insights', label: 'Insights' },
  { key: 'settings', label: 'Settings' },
] as const;

export type SectionGroupKey = (typeof SECTION_GROUPS)[number]['key'];

export interface WorkspaceSection {
  readonly key: string;
  readonly label: string;
  readonly group: SectionGroupKey;
  /** The page below `/workspaces/[workspaceId]`; empty for the overview. */
  readonly path: string;
  /** Needed to see the page and to read its data; null: every active member. */
  readonly permission: PermissionKey | null;
  readonly status: SectionStatus;
  /** What the page is for, in one sentence (also the shell's text). */
  readonly description: string;
  /** The main action, shown disabled while the page is unavailable. */
  readonly primaryAction?: string;
  /** Breadcrumb of the pages below this one (e.g. one campaign), if it has any. */
  readonly detailLabel?: string;
  /**
   * First path segments of this section's API routes below `/workspaces/:workspaceId/`. The
   * API's route test requires every GET route there to need `permission`.
   */
  readonly apiResources: readonly string[];
}

export const WORKSPACE_SECTIONS = [
  {
    key: 'overview',
    label: 'Overview',
    group: 'workspace',
    path: '',
    permission: null,
    status: 'available',
    description:
      'Counts of your leads and campaigns, recent activity and the health of your integrations.',
    // The dashboard reads the summaries of the sections below, each with that section's
    // permission (task 05C); it has no API resource of its own.
    apiResources: [],
  },
  {
    key: 'icps',
    label: 'Ideal customers',
    group: 'prospecting',
    path: 'icps',
    permission: 'icps.read',
    status: 'unavailable',
    description:
      'Describe the companies and people you want to reach, so leads can be found and scored against them.',
    primaryAction: 'New profile',
    apiResources: ['icps'],
  },
  {
    key: 'leads',
    label: 'Leads',
    group: 'prospecting',
    path: 'leads',
    permission: 'contacts.read',
    status: 'available',
    description:
      'Companies and contacts with their research, scores and email verification.',
    primaryAction: 'Find leads',
    // A company's profile with its website research (task 09C) sits below this section.
    detailLabel: 'Company profile',
    // Lead exports (task 11C): reading one also needs contacts.export (checked by the API).
    apiResources: ['leads', 'organizations', 'contacts', 'exports'],
  },
  {
    key: 'lead_lists',
    label: 'Lead lists',
    group: 'prospecting',
    path: 'lead-lists',
    permission: 'lead_lists.read',
    status: 'unavailable',
    description:
      'Group leads into lists to review them or add them to campaigns.',
    primaryAction: 'New list',
    apiResources: ['lead-lists'],
  },
  {
    key: 'imports',
    label: 'Imports',
    group: 'prospecting',
    path: 'imports',
    permission: 'imports.create',
    status: 'available',
    description:
      'Find companies for an ideal customer profile, or import them from a CSV file.',
    primaryAction: 'Find companies',
    detailLabel: 'Import results',
    apiResources: ['imports'],
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    group: 'outreach',
    path: 'campaigns',
    permission: 'campaigns.read',
    status: 'available',
    description:
      'Email sequences for your lead lists, with drafts that can require approval before anything is sent.',
    primaryAction: 'New campaign',
    detailLabel: 'Campaign setup',
    apiResources: ['campaigns', 'sequences'],
  },
  {
    key: 'approvals',
    label: 'Approvals',
    group: 'outreach',
    path: 'approvals',
    permission: 'drafts.approve',
    status: 'unavailable',
    description:
      'Review outbound drafts and approve or reject them before they are sent.',
    apiResources: ['approvals', 'drafts'],
  },
  {
    key: 'inbox',
    label: 'Inbox',
    group: 'outreach',
    path: 'inbox',
    permission: 'campaigns.read',
    status: 'unavailable',
    description:
      'Replies to your campaigns, sorted so you can follow up quickly.',
    apiResources: ['inbox', 'messages'],
  },
  {
    key: 'automations',
    label: 'Automations',
    group: 'outreach',
    path: 'automations',
    permission: 'campaigns.write',
    status: 'unavailable',
    description:
      'Rules that act on events, such as stopping a sequence when a lead replies.',
    primaryAction: 'New automation',
    apiResources: ['automations'],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    group: 'insights',
    path: 'analytics',
    permission: 'campaigns.read',
    status: 'unavailable',
    description:
      'Results of your campaigns: deliveries, replies and meetings over time.',
    apiResources: ['analytics'],
  },
  {
    key: 'team',
    label: 'Team',
    group: 'settings',
    path: 'team',
    permission: 'members.read',
    status: 'available',
    description: 'Members, roles and invitations.',
    apiResources: ['members', 'roles', 'invitations'],
  },
  {
    key: 'integrations',
    label: 'Integrations',
    group: 'settings',
    path: 'integrations',
    permission: 'settings.manage',
    status: 'unavailable',
    description: 'Connect your CRM and data providers.',
    primaryAction: 'Connect a provider',
    apiResources: ['integrations'],
  },
  {
    key: 'mailboxes',
    label: 'Mailboxes',
    group: 'settings',
    path: 'mailboxes',
    permission: 'email_accounts.manage',
    status: 'unavailable',
    description:
      'The Gmail and Microsoft 365 accounts your campaigns send from.',
    primaryAction: 'Connect a mailbox',
    apiResources: ['mailboxes', 'email-accounts'],
  },
  {
    key: 'suppressions',
    label: 'Do-not-contact list',
    group: 'settings',
    path: 'suppressions',
    permission: 'suppressions.manage',
    status: 'available',
    description: 'Addresses and domains that must never be contacted.',
    primaryAction: 'Add an address',
    apiResources: ['suppressions'],
  },
  {
    key: 'billing',
    label: 'Billing',
    group: 'settings',
    path: 'billing',
    permission: 'billing.read',
    status: 'unavailable',
    description: 'Your plan, usage against its limits, and payments.',
    apiResources: ['billing', 'usage', 'subscription'],
  },
  {
    key: 'audit',
    label: 'Audit log',
    group: 'settings',
    path: 'audit',
    permission: 'audit.read',
    status: 'unavailable',
    description: 'Who changed what in this workspace, and when.',
    apiResources: ['audit', 'activity'],
  },
  {
    key: 'settings',
    label: 'Workspace settings',
    group: 'settings',
    path: 'settings',
    permission: 'settings.manage',
    status: 'unavailable',
    description: 'The workspace name, branding and defaults.',
    apiResources: ['settings', 'branding'],
  },
] as const satisfies readonly WorkspaceSection[];

export type WorkspaceSectionKey = (typeof WORKSPACE_SECTIONS)[number]['key'];

/** Platform administration (`/admin`): platform admins only, never a workspace role. */
export interface AdminSection {
  readonly key: string;
  readonly label: string;
  /** The page below `/admin`; empty for the workspace console. */
  readonly path: string;
  readonly status: SectionStatus;
  readonly description: string;
}

export const ADMIN_SECTIONS = [
  {
    key: 'workspaces',
    label: 'Workspaces',
    path: '',
    status: 'available',
    description:
      'Every workspace, with suspension and reactivation. Each action states a reason.',
  },
  {
    key: 'users',
    label: 'Users',
    path: 'users',
    status: 'unavailable',
    description:
      'Accounts across the platform, their status and their workspaces.',
  },
  {
    key: 'plans',
    label: 'Plans',
    path: 'plans',
    status: 'unavailable',
    description: 'Plans, their limits and the workspaces on each.',
  },
  {
    key: 'platform_audit',
    label: 'Platform audit log',
    path: 'audit',
    status: 'unavailable',
    description: 'Sign-ins, account changes and every platform-admin action.',
  },
] as const satisfies readonly AdminSection[];

export const ADMIN_PATH = '/admin';

type PermissionSet = ReadonlySet<string> | readonly string[];

const has = (permissions: PermissionSet, key: string) =>
  Array.isArray(permissions)
    ? permissions.includes(key)
    : (permissions as ReadonlySet<string>).has(key);

/** Whether a member with `permissions` may open `section`. */
export function canOpenSection(
  section: WorkspaceSection,
  permissions: PermissionSet,
): boolean {
  return section.permission === null || has(permissions, section.permission);
}

export function findWorkspaceSection(
  key: string,
): WorkspaceSection | undefined {
  return WORKSPACE_SECTIONS.find((section) => section.key === key);
}

/** The section whose page is `path` (below `/workspaces/[workspaceId]`), if any. */
export function workspaceSectionByPath(
  path: string,
): WorkspaceSection | undefined {
  return WORKSPACE_SECTIONS.find((section) => section.path === path);
}

export function workspaceSectionHref(
  workspaceId: string,
  section: WorkspaceSection,
): string {
  return section.path === ''
    ? `/workspaces/${workspaceId}`
    : `/workspaces/${workspaceId}/${section.path}`;
}

export interface NavigationGroup<S> {
  readonly key: string;
  readonly label: string;
  readonly sections: readonly S[];
}

/**
 * The navigation for a member: the sections their permissions open, in order, grouped. Empty
 * groups are left out. Unavailable sections stay in, marked by their status.
 */
export function workspaceNavigation(
  permissions: PermissionSet,
): NavigationGroup<WorkspaceSection>[] {
  return SECTION_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    sections: WORKSPACE_SECTIONS.filter(
      (section) =>
        section.group === group.key && canOpenSection(section, permissions),
    ),
  })).filter((group) => group.sections.length > 0);
}

/**
 * The section a pathname shows: the longest section path that the pathname starts with, so
 * `/workspaces/w/team/x` is still Team. Null for paths outside the workspace.
 */
export function workspaceSectionForPathname(
  pathname: string,
  workspaceId: string,
): WorkspaceSection | null {
  const base = `/workspaces/${workspaceId}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) {
    return null;
  }
  const rest = pathname.slice(base.length + 1).replace(/\/+$/, '');
  if (rest === '') {
    return findWorkspaceSection('overview') ?? null;
  }
  const first = rest.split('/')[0] ?? '';
  return workspaceSectionByPath(first) ?? null;
}

export interface Breadcrumb {
  readonly label: string;
  /** Absent for the current page. */
  readonly href?: string;
}

/**
 * Workspaces › workspace name › section (the overview ends at the workspace name). On a page
 * below the section (`detail`), the section links back and the section's detail label follows.
 */
export function workspaceBreadcrumbs(
  workspace: { readonly id: string; readonly name: string },
  section: WorkspaceSection | null,
  detail = false,
): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ label: 'Workspaces', href: '/workspaces' }];
  if (section === null || section.key === 'overview') {
    crumbs.push({ label: workspace.name });
    return crumbs;
  }
  crumbs.push({
    label: workspace.name,
    href: `/workspaces/${workspace.id}`,
  });
  if (detail && section.detailLabel !== undefined) {
    crumbs.push({
      label: section.label,
      href: workspaceSectionHref(workspace.id, section),
    });
    crumbs.push({ label: section.detailLabel });
    return crumbs;
  }
  crumbs.push({ label: section.label });
  return crumbs;
}

export function adminSectionByPath(path: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((section) => section.path === path);
}

export function adminSectionHref(section: AdminSection): string {
  return section.path === '' ? ADMIN_PATH : `${ADMIN_PATH}/${section.path}`;
}

/** Admin › section (the console page ends at Admin). */
export function adminBreadcrumbs(section: AdminSection): Breadcrumb[] {
  return section.path === ''
    ? [{ label: 'Admin' }]
    : [{ label: 'Admin', href: ADMIN_PATH }, { label: section.label }];
}

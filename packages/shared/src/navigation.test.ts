import { describe, expect, it } from 'vitest';
import {
  isPermissionKey,
  PERMISSION_KEYS,
  SYSTEM_ROLES,
} from './authorization.js';
import {
  ADMIN_SECTIONS,
  adminBreadcrumbs,
  adminSectionHref,
  canOpenSection,
  findWorkspaceSection,
  SECTION_GROUPS,
  WORKSPACE_SECTIONS,
  workspaceBreadcrumbs,
  workspaceNavigation,
  workspaceSectionForPathname,
  workspaceSectionHref,
  type WorkspaceSection,
} from './navigation.js';

const W = '0b9e2c1a-6f4d-4e8a-9c3b-2d1f0e9a8b7c';
const section = (key: string): WorkspaceSection => {
  const found = findWorkspaceSection(key);
  if (found === undefined) {
    throw new Error(`no section ${key}`);
  }
  return found;
};
const keysOf = (groups: ReturnType<typeof workspaceNavigation>) =>
  groups.flatMap((group) => group.sections.map((s) => s.key));

describe('section registry', () => {
  it('has unique keys, paths and API resources, in known groups', () => {
    const unique = (values: readonly string[]) => {
      expect(new Set(values).size).toBe(values.length);
    };
    unique(WORKSPACE_SECTIONS.map((s) => s.key));
    unique(WORKSPACE_SECTIONS.map((s) => s.path));
    unique(WORKSPACE_SECTIONS.flatMap((s) => s.apiResources));
    unique(ADMIN_SECTIONS.map((s) => s.path));
    const groups = SECTION_GROUPS.map((g) => g.key) as string[];
    for (const s of WORKSPACE_SECTIONS) {
      expect(groups, s.key).toContain(s.group);
      expect(s.path, s.key).toMatch(/^([a-z]+(-[a-z]+)*)?$/);
    }
  });

  it('names only catalog permissions', () => {
    for (const s of WORKSPACE_SECTIONS) {
      if (s.permission !== null) {
        expect(isPermissionKey(s.permission), s.key).toBe(true);
      }
    }
  });

  it('lists every page the 05A prompt names, and the built ones as available', () => {
    const keys = WORKSPACE_SECTIONS.map((s) => s.key);
    for (const key of [
      'leads',
      'campaigns',
      'approvals',
      'inbox',
      'automations',
      'integrations',
      'analytics',
      'billing',
    ]) {
      expect(keys).toContain(key);
    }
    expect(
      WORKSPACE_SECTIONS.filter((s) => s.status === 'available').map(
        (s) => s.key,
      ),
    ).toEqual(['overview', 'imports', 'campaigns', 'team']);
    expect(ADMIN_SECTIONS.map((s) => s.key)).toContain('workspaces');
  });
});

describe('workspaceNavigation', () => {
  it('shows a Client Admin every section, grouped in order', () => {
    const groups = workspaceNavigation(PERMISSION_KEYS);
    expect(groups.map((g) => g.key)).toEqual(SECTION_GROUPS.map((g) => g.key));
    expect(keysOf(groups)).toEqual(WORKSPACE_SECTIONS.map((s) => s.key));
  });

  it('shows a Client Team Member only what the role opens', () => {
    const keys = keysOf(
      workspaceNavigation(SYSTEM_ROLES.client_member.permissions),
    );
    expect(keys).toEqual([
      'overview',
      'icps',
      'leads',
      'lead_lists',
      'imports',
      'campaigns',
      'inbox',
      'automations',
      'analytics',
      'team',
    ]);
    for (const hidden of [
      'approvals',
      'billing',
      'audit',
      'integrations',
      'mailboxes',
      'suppressions',
      'settings',
    ]) {
      expect(keys).not.toContain(hidden);
    }
  });

  it('leaves out empty groups and accepts a Set', () => {
    const groups = workspaceNavigation(new Set(['members.read']));
    expect(groups.map((g) => g.key)).toEqual(['workspace', 'settings']);
    expect(keysOf(groups)).toEqual(['overview', 'team']);
  });
});

describe('canOpenSection', () => {
  it('needs the permission, except for sections open to every member', () => {
    expect(canOpenSection(section('billing'), [])).toBe(false);
    expect(canOpenSection(section('billing'), ['billing.read'])).toBe(true);
    expect(canOpenSection(section('overview'), [])).toBe(true);
  });
});

describe('paths and breadcrumbs', () => {
  it('maps pathnames to sections, and builds hrefs', () => {
    expect(workspaceSectionForPathname(`/workspaces/${W}`, W)?.key).toBe(
      'overview',
    );
    expect(workspaceSectionForPathname(`/workspaces/${W}/`, W)?.key).toBe(
      'overview',
    );
    expect(
      workspaceSectionForPathname(`/workspaces/${W}/lead-lists`, W)?.key,
    ).toBe('lead_lists');
    expect(
      workspaceSectionForPathname(`/workspaces/${W}/team/more`, W)?.key,
    ).toBe('team');
    expect(workspaceSectionForPathname(`/workspaces/${W}/nope`, W)).toBeNull();
    expect(workspaceSectionForPathname(`/workspaces/${W}x`, W)).toBeNull();
    expect(workspaceSectionForPathname('/workspaces', W)).toBeNull();
    expect(workspaceSectionHref(W, section('overview'))).toBe(
      `/workspaces/${W}`,
    );
    expect(workspaceSectionHref(W, section('lead_lists'))).toBe(
      `/workspaces/${W}/lead-lists`,
    );
  });

  it('links every crumb but the current page', () => {
    const workspace = { id: W, name: 'Acme' };
    expect(workspaceBreadcrumbs(workspace, section('campaigns'))).toEqual([
      { label: 'Workspaces', href: '/workspaces' },
      { label: 'Acme', href: `/workspaces/${W}` },
      { label: 'Campaigns' },
    ]);
    // A page below the section (task 06B): the section links back.
    expect(workspaceBreadcrumbs(workspace, section('campaigns'), true)).toEqual(
      [
        { label: 'Workspaces', href: '/workspaces' },
        { label: 'Acme', href: `/workspaces/${W}` },
        { label: 'Campaigns', href: `/workspaces/${W}/campaigns` },
        { label: 'Campaign setup' },
      ],
    );
    // A section without detail pages ignores it.
    expect(workspaceBreadcrumbs(workspace, section('team'), true)).toEqual([
      { label: 'Workspaces', href: '/workspaces' },
      { label: 'Acme', href: `/workspaces/${W}` },
      { label: 'Team' },
    ]);
    expect(workspaceBreadcrumbs(workspace, section('overview'))).toEqual([
      { label: 'Workspaces', href: '/workspaces' },
      { label: 'Acme' },
    ]);
    const [console, users] = ADMIN_SECTIONS;
    expect(adminBreadcrumbs(console)).toEqual([{ label: 'Admin' }]);
    expect(adminBreadcrumbs(users)).toEqual([
      { label: 'Admin', href: '/admin' },
      { label: 'Users' },
    ]);
    expect(adminSectionHref(console)).toBe('/admin');
    expect(adminSectionHref(users)).toBe('/admin/users');
  });
});

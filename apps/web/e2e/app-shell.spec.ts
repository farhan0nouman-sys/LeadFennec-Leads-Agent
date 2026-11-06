// The app shell (task 05A) against the real API: navigation by permission, breadcrumbs, the
// workspace selector, route shells for pages not built yet, the admin area, the server-side page
// checks, keyboard and narrow-screen use, and automated accessibility checks (axe).
import { AxeBuilder } from '@axe-core/playwright';
import {
  ADMIN_SECTIONS,
  SYSTEM_ROLES,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from '@lead-fennec-ai/shared';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  apiMutation,
  person,
  registerVerified,
  signIn,
  type Person,
} from './support/accounts';
import { E2eDatabase } from './support/db';
import { SKIP_REASON, WEB_URL, e2eEnabled } from './support/env';

test.skip(!e2eEnabled, SKIP_REASON);
test.describe.configure({ mode: 'serial' });

const run = `shell${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple shell';
const ada = person('ada', 'Ada Admin', run);
const max = person('max', 'Max Member', run);
const pia = person('pia', 'Pia Platform', run);
const mainName = `Shell ${run}`;
const otherName = `Other ${run}`;

const memberPermissions: readonly string[] =
  SYSTEM_ROLES.client_member.permissions;
const memberHidden = WORKSPACE_SECTIONS.filter(
  (s) => s.permission !== null && !memberPermissions.includes(s.permission),
);
/** A navigation link whose name starts with the label (unbuilt ones add a marker). */
const linkName = (label: string) => new RegExp(`^${label}(\\b|$)`);

let db: E2eDatabase;
let workspaceId = '';
let otherWorkspaceId = '';
const pages = new Map<Person, Page>();
const contexts: BrowserContext[] = [];

async function browserOf(browser: Browser, who: Person): Promise<Page> {
  const existing = pages.get(who);
  if (existing !== undefined) {
    return existing;
  }
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  pages.set(who, page);
  return page;
}

const sectionUrl = (id: string, section: WorkspaceSection) =>
  section.path === ''
    ? `/workspaces/${id}`
    : `/workspaces/${id}/${section.path}`;

/** No WCAG 2.2 A/AA violations that axe can detect. */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

test.beforeAll(async ({ browser, playwright }) => {
  db = await E2eDatabase.connect();
  const request = await playwright.request.newContext({ baseURL: WEB_URL });
  for (const who of [ada, max, pia]) {
    await registerVerified(request, db, who, PASSWORD);
  }
  await request.dispose();
  await db.makePlatformAdmin(pia.email);

  const adaPage = await browserOf(browser, ada);
  await signIn(adaPage, ada, PASSWORD);
  for (const name of [mainName, otherName]) {
    const created = await apiMutation(adaPage, 'POST', '/workspaces', { name });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as { workspace: { id: string } };
    if (name === mainName) {
      workspaceId = body.workspace.id;
    } else {
      otherWorkspaceId = body.workspace.id;
    }
  }
  const token = await db.issueInvitation({
    workspaceId,
    email: max.email,
    roleKey: 'client_member',
  });
  const maxPage = await browserOf(browser, max);
  await signIn(maxPage, max, PASSWORD);
  const accepted = await apiMutation(maxPage, 'POST', '/invitations/accept', {
    token,
    workspaceId,
  });
  expect(accepted.status()).toBe(200);
});

test.afterAll(async () => {
  for (const context of contexts) {
    await context.close();
  }
  await db.close();
});

test('an admin sees every section, grouped, with pages not built yet marked', async ({
  browser,
}) => {
  const page = await browserOf(browser, ada);
  await page.goto(`/workspaces/${workspaceId}`);
  const nav = page.getByRole('navigation', { name: 'Workspace pages' });
  for (const group of [
    'Workspace',
    'Prospecting',
    'Outreach',
    'Insights',
    'Settings',
  ]) {
    await expect(nav.getByRole('heading', { name: group })).toBeVisible();
  }
  for (const section of WORKSPACE_SECTIONS) {
    const link = nav.getByRole('link', { name: linkName(section.label) });
    await expect(link, section.key).toBeVisible();
    if (section.status === 'unavailable') {
      await expect(link).toHaveAccessibleName(/not available yet$/);
    } else {
      await expect(link).toHaveAccessibleName(section.label);
    }
  }
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByRole('link', { name: 'Workspaces' })).toBeVisible();
  await expect(crumbs.getByText(mainName)).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expectAccessible(page);

  // A page that isn't built yet (Leads; Campaigns is built since 06B, Imports since 07C).
  await nav.getByRole('link', { name: linkName('Leads') }).click();
  await expect(page).toHaveURL(`${WEB_URL}/workspaces/${workspaceId}/leads`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Leads' }),
  ).toBeVisible();
  await expect(
    page.getByText('Not available yet', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find leads' })).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: 'This page is not available yet' }),
  ).toBeVisible();
  await expect(crumbs.getByRole('link', { name: mainName })).toHaveAttribute(
    'href',
    `/workspaces/${workspaceId}`,
  );
  await expect(crumbs.getByText('Leads')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    nav.getByRole('link', { name: linkName('Leads') }),
  ).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page);

  // Every route shell exists, says it isn't available, and offers nothing to change.
  const unbuilt: readonly WorkspaceSection[] = WORKSPACE_SECTIONS.filter(
    (s) => s.status === 'unavailable',
  );
  for (const section of unbuilt) {
    await page.goto(sectionUrl(workspaceId, section));
    await expect(
      page.getByRole('heading', { level: 1, name: section.label }),
      section.key,
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'This page is not available yet' }),
    ).toBeVisible();
    if (section.primaryAction !== undefined) {
      await expect(
        page.getByRole('button', { name: section.primaryAction }),
      ).toBeDisabled();
    }
  }

  await page.goto(`/workspaces/${workspaceId}/team`);
  await expectAccessible(page);
});

test('a member sees only what the role opens; the server refuses the rest', async ({
  browser,
}) => {
  const page = await browserOf(browser, max);
  await page.goto(`/workspaces/${workspaceId}`);
  const nav = page.getByRole('navigation', { name: 'Workspace pages' });
  for (const label of ['Leads', 'Campaigns', 'Inbox']) {
    await expect(
      nav.getByRole('link', { name: linkName(label) }),
    ).toBeVisible();
  }
  await expect(
    nav.getByRole('link', { name: 'Team', exact: true }),
  ).toBeVisible();
  expect(memberHidden.map((s) => s.key)).toEqual([
    'approvals',
    'integrations',
    'mailboxes',
    'suppressions',
    'billing',
    'audit',
    'settings',
  ]);
  for (const section of memberHidden) {
    await expect(
      nav.getByRole('link', { name: linkName(section.label) }),
      section.key,
    ).toHaveCount(0);
    // Typing the address doesn't help: the server checks the role.
    await page.goto(sectionUrl(workspaceId, section));
    await expect(
      page.getByRole('heading', { name: "You don't have access" }),
      section.key,
    ).toBeVisible();
    await expect(
      page.getByText(`doesn't include ${section.label}`),
    ).toBeVisible();
  }

  // The decision is in the server-rendered HTML, before any script runs.
  const billing = WORKSPACE_SECTIONS.find((s) => s.key === 'billing');
  if (billing === undefined) {
    throw new Error('no billing section');
  }
  const refused = await page.request.get(sectionUrl(workspaceId, billing));
  const refusedHtml = await refused.text();
  expect(refusedHtml).toContain('have access');
  expect(refusedHtml).not.toContain(billing.description);
  const adaPage = await browserOf(browser, ada);
  expect(
    await (await adaPage.request.get(sectionUrl(workspaceId, billing))).text(),
  ).toContain(billing.description);

  // The API refuses what the screens hide.
  const members = (await (
    await page.request.get(`/api/workspaces/${workspaceId}/members`)
  ).json()) as { items: { id: string; role: { id: string } }[] };
  const someone = members.items[0];
  if (someone === undefined) {
    throw new Error('no members');
  }
  const change = await apiMutation(
    page,
    'PATCH',
    `/workspaces/${workspaceId}/members/${someone.id}`,
    { roleId: someone.role.id },
  );
  expect(change.status()).toBe(403);

  // Unknown pages and other workspaces: a real 404.
  const unknown = await page.goto(`/workspaces/${workspaceId}/nope`);
  expect(unknown?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  const foreign = await page.goto(`/workspaces/${otherWorkspaceId}/campaigns`);
  expect(foreign?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
});

test('signed-out requests are sent to sign in by the server', async ({
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL: WEB_URL });
  try {
    for (const path of [
      `/workspaces/${workspaceId}/campaigns`,
      '/workspaces',
      '/admin',
    ]) {
      const response = await anonymous.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers()['location'], path).toBe(
        `/login?next=${encodeURIComponent(path)}`,
      );
    }
  } finally {
    await anonymous.dispose();
  }
});

test('keyboard: the skip link reaches the page, past the navigation', async ({
  browser,
}) => {
  const page = await browserOf(browser, ada);
  await page.goto(`/workspaces/${workspaceId}/team`);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('narrow screens: the navigation opens in a dialog', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: await (
      await browserOf(browser, ada)
    )
      .context()
      .storageState(),
  });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/workspaces/${workspaceId}`);
  // The sidebar is hidden; a button opens the same navigation.
  await expect(
    page.getByRole('navigation', { name: 'Workspace pages' }),
  ).toHaveCount(0);
  const open = page.getByRole('button', { name: 'Open navigation' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Workspace navigation' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('navigation', { name: 'Workspace pages' }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('combobox', { name: 'Workspace', exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await dialog.getByRole('link', { name: linkName('Leads') }).click();
  await expect(page).toHaveURL(`${WEB_URL}/workspaces/${workspaceId}/leads`);
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Leads' }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('the workspace selector keeps the page', async ({ browser }) => {
  const page = await browserOf(browser, ada);
  await page.goto(`/workspaces/${workspaceId}/campaigns`);
  await page
    .getByRole('combobox', { name: 'Workspace', exact: true })
    .selectOption({ label: otherName });
  await expect(page).toHaveURL(
    `${WEB_URL}/workspaces/${otherWorkspaceId}/campaigns`,
  );
  await expect(
    page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: otherName }),
  ).toBeVisible();
});

test('the admin area is for platform admins only', async ({ browser }) => {
  const page = await browserOf(browser, pia);
  await signIn(page, pia, PASSWORD);
  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page).toHaveURL(`${WEB_URL}/admin`);
  const nav = page.getByRole('navigation', { name: 'Admin pages' });
  for (const section of ADMIN_SECTIONS) {
    await expect(
      nav.getByRole('link', { name: linkName(section.label) }),
    ).toBeVisible();
  }
  await expect(
    nav.getByRole('link', { name: 'Workspaces', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Reason for this access')).toBeVisible();
  await expectAccessible(page);
  await page.goto('/admin/users');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Users' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'This page is not available yet' }),
  ).toBeVisible();
  // The 04C address still works.
  await page.goto('/platform');
  await expect(page).toHaveURL(`${WEB_URL}/admin`);

  const maxPage = await browserOf(browser, max);
  await maxPage.goto('/workspaces');
  await expect(
    maxPage.getByRole('link', { name: 'Admin', exact: true }),
  ).toHaveCount(0);
  await maxPage.goto('/admin');
  await expect(
    maxPage.getByRole('heading', { name: 'Platform admins only' }),
  ).toBeVisible();
  const html = await (await maxPage.request.get('/admin')).text();
  expect(html).toContain('Platform admins only');
  expect(html).not.toContain('Reason for this access');
});

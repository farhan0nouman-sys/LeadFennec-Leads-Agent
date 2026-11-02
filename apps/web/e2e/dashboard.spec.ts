// The workspace dashboard (task 05C) against the real API and database: counts from the
// database, explicit "not available yet" metrics, panels by role, bounded polling of recent
// activity (only while the page is visible), recovery from failed loads, narrow screens and
// accessibility. Timers are driven by Playwright's clock, so a minute passes instantly.
import { AxeBuilder } from '@axe-core/playwright';
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
} from './support/accounts';
import { E2eDatabase } from './support/db';
import { SKIP_REASON, WEB_URL, e2eEnabled } from './support/env';

test.skip(!e2eEnabled, SKIP_REASON);
test.describe.configure({ mode: 'serial' });

const run = `dash${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple dash';
const ada = person('ada', 'Ada Admin', run);
const ben = person('ben', 'Ben Member', run);
const workspaceName = `Dashboard ${run}`;

let db: E2eDatabase;
let workspaceId = '';
const contexts: BrowserContext[] = [];
const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext['storageState']>>
>();

/**
 * A new browser context with `who`'s session. Each account signs in once (beforeAll): the API
 * limits sign-ins per address, and the other specs sign in from the same one.
 */
async function contextAs(
  browser: Browser,
  who: typeof ada,
  viewport = { width: 1280, height: 900 },
): Promise<BrowserContext> {
  const storageState = sessions.get(who.email);
  if (storageState === undefined) {
    throw new Error(`${who.email} has not signed in`);
  }
  const context = await browser.newContext({ viewport, storageState });
  contexts.push(context);
  return context;
}

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

const panel = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });

/** The value shown for a metric (its first <dd>). */
const metric = (page: Page, key: string) =>
  page.locator(`[data-metric="${key}"] dd`).first();

/** Requests the page makes to an API path ending in `suffix`. */
function requestsTo(page: Page, suffix: string): { count: number } {
  const seen = { count: 0 };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith(suffix)) {
      seen.count += 1;
    }
  });
  return seen;
}

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => value,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test.beforeAll(async ({ browser, playwright }) => {
  db = await E2eDatabase.connect();
  const request = await playwright.request.newContext({ baseURL: WEB_URL });
  await registerVerified(request, db, ada, PASSWORD);
  await registerVerified(request, db, ben, PASSWORD);
  await request.dispose();
  for (const who of [ada, ben]) {
    const context = await browser.newContext();
    contexts.push(context);
    await signIn(await context.newPage(), who, PASSWORD);
    sessions.set(who.email, await context.storageState());
  }
  const admin = await (await contextAs(browser, ada)).newPage();
  const created = await apiMutation(admin, 'POST', '/workspaces', {
    name: workspaceName,
  });
  expect(created.status()).toBe(201);
  workspaceId = ((await created.json()) as { workspace: { id: string } })
    .workspace.id;
  const token = await db.issueInvitation({
    workspaceId,
    email: ben.email,
    roleKey: 'client_member',
  });
  const member = await (await contextAs(browser, ben)).newPage();
  const accepted = await apiMutation(member, 'POST', '/invitations/accept', {
    token,
    workspaceId,
  });
  expect(accepted.status()).toBe(200);
  await db.seedDashboard(workspaceId, run);
});

test.afterAll(async () => {
  for (const context of contexts) {
    await context.close();
  }
  await db.close();
});

test('an admin sees counts from the database and what is not available yet', async ({
  browser,
}) => {
  const page = await (await contextAs(browser, ada)).newPage();
  await page.goto(`/workspaces/${workspaceId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    workspaceName,
  );

  const leads = panel(page, 'Leads');
  await expect(metric(page, 'contacts')).toHaveText('3');
  await expect(metric(page, 'companies')).toHaveText('2');
  await expect(metric(page, 'contactsWithEmail')).toHaveText('2');
  await expect(metric(page, 'contactsAddedLast30Days')).toHaveText('3');
  await expect(metric(page, 'activeCampaigns')).toHaveText('1');
  await expect(metric(page, 'campaigns')).toHaveText('2');
  await expect(metric(page, 'leadsInProgress')).toHaveText('2');
  await expect(panel(page, 'Campaigns')).toContainText('Campaigns by status');

  // Later metrics say so instead of showing a number.
  for (const key of [
    'verifiedEmails',
    'scoredLeads',
    'emailsSent',
    'replyRate',
    'meetingsBooked',
  ]) {
    await expect(metric(page, key)).toHaveText('Not available yet');
  }
  await expect(leads.getByText('Not available yet')).toHaveCount(2);

  // Recent activity from the audit records: the workspace was created, Ben joined.
  const activity = panel(page, 'Recent activity');
  const items = activity.getByRole('list', { name: 'Latest changes' });
  await expect(items.getByRole('listitem').first()).toContainText(
    'Ben Member joined the workspace',
  );
  await expect(items).toContainText('Ada Admin created the workspace');

  // Integration health: the broken Gmail mailbox needs attention; the rest isn't connected.
  const health = panel(page, 'Integration health');
  await expect(health.locator('[data-provider="GMAIL"]')).toContainText(
    'Needs attention',
  );
  await expect(health.locator('[data-provider="GMAIL"]')).toContainText(
    '1 needs reconnecting',
  );
  await expect(health.locator('[data-state="not_connected"]')).toHaveCount(3);

  await expectAccessible(page);
});

test('a team member sees only the panels their role opens', async ({
  browser,
}) => {
  const page = await (await contextAs(browser, ben)).newPage();
  await page.goto(`/workspaces/${workspaceId}`);
  await expect(metric(page, 'contacts')).toHaveText('3');
  await expect(panel(page, 'Campaigns')).toBeVisible();
  await expect(panel(page, 'Recent activity')).toHaveCount(0);
  await expect(panel(page, 'Integration health')).toHaveCount(0);
  // The API refuses what the dashboard hides.
  const refused = await page.request.get(
    `/api/workspaces/${workspaceId}/activity`,
  );
  expect(refused.status()).toBe(403);
});

test('recent activity updates every minute while the page is visible', async ({
  browser,
}) => {
  const context = await contextAs(browser, ada);
  const page = await context.newPage();
  await page.clock.install();
  const invited = await apiMutation(
    page,
    'POST',
    `/workspaces/${workspaceId}/invitations`,
    {
      email: `cleo.${run}@example.test`,
      roleId: (
        (await (
          await page.request.get(`/api/workspaces/${workspaceId}/roles`)
        ).json()) as { items: { id: string; key: string }[] }
      ).items.find((role) => role.key === 'client_member')?.id,
    },
  );
  expect(invited.status()).toBe(201);
  const invitationId = ((await invited.json()) as { id: string }).id;

  await page.goto(`/workspaces/${workspaceId}`);
  const activity = panel(page, 'Recent activity');
  const first = activity
    .getByRole('list', { name: 'Latest changes' })
    .getByRole('listitem')
    .first();
  await expect(first).toContainText('Ada Admin invited someone to join');
  await expect(activity).toContainText('Updates every minute');

  // A change made elsewhere (another tab, another member) shows up after a minute, no reload.
  const revoked = await apiMutation(
    page,
    'DELETE',
    `/workspaces/${workspaceId}/invitations/${invitationId}`,
  );
  expect(revoked.status()).toBe(204);
  await page.clock.fastForward('01:00');
  await expect(first).toContainText('Ada Admin revoked an invitation');

  // Hidden: no requests at all, however long.
  const calls = requestsTo(page, '/activity');
  await setVisibility(page, 'hidden');
  await page.clock.fastForward('10:00');
  await page.clock.fastForward('10:00');
  expect(calls.count).toBe(0);
  // Visible again: it refreshes at once.
  await setVisibility(page, 'visible');
  await page.clock.runFor(10);
  await expect.poll(() => calls.count).toBe(1);
});

test('failed loads can be retried, and polling pauses after repeated errors', async ({
  browser,
}) => {
  const context = await contextAs(browser, ada);
  const page = await context.newPage();
  await page.clock.install();
  const failing = /\/api\/workspaces\/[^/]+\/(leads\/summary|activity)$/;
  await page.route(failing, (route) =>
    route.fulfill({ status: 500, body: 'Internal Server Error' }),
  );
  await page.goto(`/workspaces/${workspaceId}`);

  // One panel failing leaves the others working; the message is generic.
  const leads = panel(page, 'Leads');
  await expect(
    leads.getByText("We couldn't load the lead counts"),
  ).toBeVisible();
  await expect(leads).toContainText('Something went wrong. Try again.');
  // No loading placeholder for counts that failed.
  await expect(metric(page, 'contacts')).toHaveText('–Not loaded');
  await expect(metric(page, 'activeCampaigns')).toHaveText('1');
  await expect(
    panel(page, 'Integration health').locator('[data-provider="GMAIL"]'),
  ).toBeVisible();

  // Three failed automatic refreshes (1, 2 and 4 minutes apart) pause polling. Time moves a
  // minute at a time, so each refresh is scheduled after the previous one has failed.
  const activity = panel(page, 'Recent activity');
  const status = activity.getByRole('status');
  await expect(status).toHaveText('');
  await expect(async () => {
    await page.clock.fastForward('01:00');
    await expect(status).toHaveText(
      'Automatic updates paused after repeated errors.',
      { timeout: 500 },
    );
  }).toPass({ timeout: 30_000 });
  const calls = requestsTo(page, '/activity');
  await page.clock.fastForward('30:00');
  expect(calls.count).toBe(0);

  // The API is back: retrying recovers both panels.
  await page.unroute(failing);
  await leads.getByRole('button', { name: 'Try again' }).click();
  await expect(metric(page, 'contacts')).toHaveText('3');
  // While the panel shows the error, its retry is the one button (no second Refresh).
  await expect(
    activity.getByRole('button', { name: /Refresh|Resume/ }),
  ).toHaveCount(0);
  await activity.getByRole('button', { name: 'Try again' }).click();
  await expect(
    activity.getByRole('list', { name: 'Latest changes' }),
  ).toBeVisible();
  await expect(status).toHaveText('');
  await expect(activity).toContainText('Updates every minute');
});

test('narrow screens: panels stack without sideways scrolling', async ({
  browser,
}) => {
  const context = await contextAs(browser, ada, {
    width: 390,
    height: 844,
  });
  const page = await context.newPage();
  await page.goto(`/workspaces/${workspaceId}`);
  await expect(metric(page, 'contacts')).toHaveText('3');
  await expect(
    panel(page, 'Integration health').locator('[data-provider="APOLLO"]'),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const [activity, health] = await Promise.all([
    panel(page, 'Recent activity').boundingBox(),
    panel(page, 'Integration health').boundingBox(),
  ]);
  // One column: the second panel starts below the first.
  expect(health?.y ?? 0).toBeGreaterThan(
    (activity?.y ?? 0) + (activity?.height ?? 0) - 1,
  );
  await expectAccessible(page);
});

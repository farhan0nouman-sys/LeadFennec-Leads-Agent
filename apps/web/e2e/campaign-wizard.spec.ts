// The campaign setup wizard (task 06B) against the real API and database: the eight stages,
// saving an incomplete draft and reopening it without losing anything, messages next to their
// fields that match the API's word for word, back navigation, honest notices for what isn't
// built (mailbox connection, writing emails, starting), conflicts, read-only campaigns, narrow
// screens and accessibility. Each account signs in once (the API limits sign-ins per address).
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
// Long scenarios: each walks through several stages.
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const run = `wiz${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple wizard';
const ada = person('ada', 'Ada Admin', run);

let db: E2eDatabase;
let workspaceId = '';
let choices: Awaited<ReturnType<E2eDatabase['seedCampaignChoices']>>;
let session: Awaited<ReturnType<BrowserContext['storageState']>>;
let campaignId = '';
const contexts: BrowserContext[] = [];

async function newPage(
  browser: Browser,
  viewport = { width: 1280, height: 900 },
): Promise<Page> {
  const context = await browser.newContext({ viewport, storageState: session });
  contexts.push(context);
  return context.newPage();
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

const wizardUrl = (stage?: string) =>
  `/workspaces/${workspaceId}/campaigns/${campaignId}${stage === undefined ? '' : `?stage=${stage}`}`;
const steps = (page: Page) =>
  page.getByRole('navigation', { name: 'Campaign setup steps' });
const stepLink = (page: Page, label: string) =>
  // Chrome puts a space before the hidden state text: "Offer , not done yet".
  steps(page).getByRole('link', { name: new RegExp(`^${label} ?,`) });

/** The API's message for `path` when this change is saved directly (no page involved). */
async function apiMessage(
  page: Page,
  change: Record<string, unknown>,
  path: string,
): Promise<string | undefined> {
  const current = (await (
    await page.request.get(
      `/api/workspaces/${workspaceId}/campaigns/${campaignId}`,
    )
  ).json()) as { version: number };
  const response = await apiMutation(
    page,
    'PATCH',
    `/workspaces/${workspaceId}/campaigns/${campaignId}`,
    { version: current.version, ...change },
  );
  expect(response.status()).toBe(400);
  const body = (await response.json()) as {
    error: { issues?: { path: string; message: string }[] };
  };
  return body.error.issues?.find((issue) => issue.path === path)?.message;
}

test.beforeAll(async ({ browser, playwright }) => {
  db = await E2eDatabase.connect();
  const request = await playwright.request.newContext({ baseURL: WEB_URL });
  await registerVerified(request, db, ada, PASSWORD);
  await request.dispose();
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, ada, PASSWORD);
  session = await context.storageState();
  const created = await apiMutation(page, 'POST', '/workspaces', {
    name: `Wizard ${run}`,
  });
  expect(created.status()).toBe(201);
  workspaceId = ((await created.json()) as { workspace: { id: string } })
    .workspace.id;
  choices = await db.seedCampaignChoices(workspaceId, run);
});

test.afterAll(async () => {
  for (const context of contexts) {
    await context.close();
  }
  await db.close();
});

test('a new campaign saved half-done reopens with everything that was valid', async ({
  browser,
}) => {
  const page = await newPage(browser);
  await page.goto(`/workspaces/${workspaceId}/campaigns`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Campaigns');
  await expect(page.getByText('No campaigns yet')).toBeVisible();
  await expectAccessible(page);

  // Creating: the name is required, in the API's words.
  await page.getByRole('button', { name: 'New campaign' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New campaign' });
  await dialog.getByRole('button', { name: 'Create and set up' }).click();
  await expect(dialog.getByLabel('Campaign name')).toHaveAccessibleDescription(
    /Enter a name for the campaign\./,
  );
  await dialog.getByLabel('Campaign name').fill('Spring outreach');
  await dialog.getByRole('button', { name: 'Create and set up' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/workspaces/${workspaceId}/campaigns/[0-9a-f-]{36}$`),
  );
  campaignId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Spring outreach',
  );
  await expect(page.getByText('Step 1 of 8: Business profile')).toBeVisible();
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByRole('link', { name: 'Campaigns' })).toBeVisible();
  await expect(crumbs.getByText('Campaign setup')).toHaveAttribute(
    'aria-current',
    'page',
  );

  // An invalid value stays on the stage, next to its field, and nothing is saved.
  await page.getByLabel('Company name').fill('Example Co');
  await page.getByLabel('Website').fill('example.com');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  const website = page.getByLabel('Website');
  await expect(website).toHaveAccessibleDescription(
    /Enter a web address starting with http:\/\/ or https:\/\/\./,
  );
  await expect(website).toBeFocused();
  await expect(page.getByText('Step 1 of 8: Business profile')).toBeVisible();
  await website.fill('https://example.com');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(wizardUrl('audience'));
  await expect(page.getByText(/^Draft saved at /)).toBeVisible();

  // Target audience: the workspace's own lead list.
  await page
    .getByLabel('Lead list')
    .selectOption({ label: 'Autumn prospects' });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(wizardUrl('offer'));

  // Offer, half done; Back saves it before going back.
  await page.getByLabel('Offer', { exact: true }).fill('Free pipeline audit');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(wizardUrl('audience'));
  await expect(page.getByLabel('Lead list')).toHaveValue(choices.leadList);
  await stepLink(page, 'Business profile').click();
  await expect(page.getByLabel('Company name')).toHaveValue('Example Co');
  await expect(page.getByLabel('Website')).toHaveValue('https://example.com');

  // Leave, and come back from the list.
  await page.getByRole('link', { name: 'All campaigns' }).click();
  const row = page.getByTestId('campaign-Spring outreach');
  await expect(row).toContainText('Draft');
  await expect(row).toContainText('1 of 6 parts filled in');
  await row.getByRole('link', { name: 'Spring outreach' }).click();
  await expect(page.getByLabel('Company name')).toHaveValue('Example Co');
  await stepLink(page, 'Offer').click();
  await expect(page.getByLabel('Offer', { exact: true })).toHaveValue(
    'Free pipeline audit',
  );
  // A full reload keeps the place and the values.
  await page.reload();
  await expect(page.getByLabel('Offer', { exact: true })).toHaveValue(
    'Free pipeline audit',
  );
  await expect(stepLink(page, 'Target audience')).toHaveAttribute(
    'data-state',
    'done',
  );
  await expect(stepLink(page, 'Offer')).toHaveAttribute('data-state', 'todo');
});

test('the page and the API refuse the same values with the same words', async ({
  browser,
}) => {
  const page = await newPage(browser);
  const patches: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') {
      patches.push(request.url());
    }
  });
  const cases: {
    stage: string;
    fill: () => Promise<void>;
    field: () => ReturnType<Page['getByLabel']>;
    change: Record<string, unknown>;
    path: string;
    prefix?: string;
  }[] = [
    {
      stage: 'business-profile',
      fill: () => page.getByLabel('Website').fill('ftp://example.com'),
      field: () => page.getByLabel('Website'),
      change: { businessProfile: { website: 'ftp://example.com' } },
      path: 'businessProfile.website',
    },
    {
      stage: 'filters',
      fill: () => page.getByLabel('New leads per day').fill('501'),
      field: () => page.getByLabel('New leads per day'),
      change: { leadLimits: { dailyNewLeads: 501 } },
      path: 'leadLimits.dailyNewLeads',
    },
    {
      stage: 'filters',
      fill: async () => {
        await page.getByLabel('Smallest company (employees)').fill('50');
        await page.getByLabel('Largest company (employees)').fill('10');
      },
      field: () => page.getByLabel('Largest company (employees)'),
      change: {
        audience: { filters: { employeeCountMin: 50, employeeCountMax: 10 } },
      },
      path: 'audience.filters.employeeCountMax',
    },
    {
      stage: 'filters',
      fill: () => page.getByLabel('Countries').fill('DE, USA'),
      field: () => page.getByLabel('Countries'),
      change: { audience: { filters: { countries: ['DE', 'USA'] } } },
      path: 'audience.filters.countries.1',
      prefix: 'Entry 2: ',
    },
    {
      stage: 'schedule',
      fill: async () => {
        await page.getByLabel('Start sending at').selectOption('600');
        await page.getByLabel('Stop sending at').selectOption('540');
      },
      field: () => page.getByLabel('Stop sending at'),
      change: {
        schedule: {
          weekdays: [1, 2, 3, 4, 5],
          windowStartMinute: 600,
          windowEndMinute: 540,
        },
      },
      path: 'schedule.windowEndMinute',
    },
  ];
  for (const item of cases) {
    await page.goto(wizardUrl(item.stage));
    await item.fill();
    await page.getByRole('button', { name: 'Save draft' }).click();
    const api = await apiMessage(page, item.change, item.path);
    expect(api, item.path).toBeDefined();
    await expect(item.field(), item.path).toHaveAccessibleDescription(
      new RegExp(
        ((item.prefix ?? '') + (api ?? '')).replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        ),
      ),
    );
  }
  // The page refused them before sending anything.
  expect(patches).toEqual([]);
});

test('mailbox and sequence say what is not built, and never claim a connection', async ({
  browser,
}) => {
  const page = await newPage(browser);
  await page.goto(wizardUrl('mailbox'));
  const notice = page.locator('[data-slot="not-available"]');
  await expect(notice).toContainText('Connecting a mailbox');
  await expect(notice).toContainText('Not available yet');
  await expect(
    page.getByRole('button', { name: 'Connect Gmail' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Connect Microsoft 365' }),
  ).toBeDisabled();
  // The workspace's mailbox is listed with its real status, not as connected.
  const sendFrom = page.getByRole('group', { name: 'Send from' });
  await expect(sendFrom).toContainText(`sender.${run}@example.com`);
  await expect(sendFrom).toContainText('Waiting for authorization');
  await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
  await expectAccessible(page);
  await sendFrom
    .getByLabel(new RegExp(`sender\\.${run}@example\\.com`))
    .check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(wizardUrl('sequence'));

  await expect(page.locator('[data-slot="not-available"]')).toContainText(
    'Writing the emails',
  );
  await expect(page.getByText('No steps yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  const first = page.getByRole('group', { name: 'Step 1' });
  const second = page.getByRole('group', { name: 'Step 2' });
  await first.getByLabel('Template').selectOption({ label: 'First touch' });
  // Over a year is refused, next to that step's delay.
  await second.getByLabel('Days').fill('366');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByRole('group', { name: 'Wait after step 1 is sent' }),
  ).toHaveAccessibleDescription(/Use a delay of at most one year\./);
  await second.getByLabel('Days').fill('3');
  await second.getByLabel('Hours').fill('12');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/^Draft saved at /)).toBeVisible();
  await expectAccessible(page);
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Step 1' }).getByLabel('Template'),
  ).toHaveValue(choices.template);
  await expect(
    page.getByRole('group', { name: 'Step 2' }).getByLabel('Days'),
  ).toHaveValue('3');
  await expect(
    page.getByRole('group', { name: 'Step 2' }).getByLabel('Hours'),
  ).toHaveValue('12');
});

test('schedule and review: days and hours, a summary, and no fake start', async ({
  browser,
}) => {
  const page = await newPage(browser);
  await page.goto(wizardUrl('schedule'));
  const days = page.getByRole('group', { name: 'Days to send on' });
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
    await days.getByLabel(day).uncheck();
  }
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(days).toHaveAccessibleDescription(/Choose at least one day\./);
  await days.getByLabel('Monday').check();
  await days.getByLabel('Wednesday').check();
  await page.getByLabel('Time zone').selectOption('Europe/Berlin');
  await page.getByLabel('Start sending at').selectOption('480');
  await page.getByLabel('Stop sending at').selectOption('990');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(wizardUrl('review'));

  const summary = page.locator('[data-stage="schedule"]');
  await expect(summary).toContainText('Mon, Wed, 08:00–16:30, Europe/Berlin');
  await expect(page.locator('[data-stage="mailbox"]')).toContainText(
    `sender.${run}@example.com`,
  );
  // Task 06C: every activation check is on the screen, with the API's own reasons.
  const report = (await (
    await page.request.get(
      `/api/workspaces/${workspaceId}/campaigns/${campaignId}/readiness`,
    )
  ).json()) as {
    version: number;
    ready: boolean;
    checks: { key: string; passed: boolean; reasons: string[] }[];
  };
  expect(report.ready).toBe(false);
  expect(report.checks).toHaveLength(13);
  const checks = page.getByRole('list', { name: 'Checks' });
  for (const check of report.checks) {
    const item = checks.locator(`[data-check="${check.key}"]`);
    await expect(item, check.key).toHaveAttribute(
      'data-passed',
      String(check.passed),
    );
    for (const reason of check.reasons) {
      await expect(item, check.key).toContainText(reason);
    }
  }
  // Unbuilt services block, and say so.
  for (const key of [
    'eligibility_service',
    'drafting_service',
    'sending_service',
  ]) {
    await expect(checks.locator(`[data-check="${key}"]`)).toContainText(
      'Not available yet',
    );
  }
  await expect(
    page.getByText(
      /checks don't pass yet\. Nothing is sent until they all do\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start campaign' }),
  ).toBeDisabled();
  await expect(
    page.getByText('You can start the campaign when every check passes.'),
  ).toBeVisible();
  // The API refuses it too: every reason, and a stale version conflicts first.
  const activate = (version: number) =>
    apiMutation(
      page,
      'POST',
      `/workspaces/${workspaceId}/campaigns/${campaignId}/activate`,
      { version },
    );
  const refused = await activate(report.version);
  expect(refused.status()).toBe(409);
  const body = (await refused.json()) as {
    error: { code: string; issues: { path: string; message: string }[] };
  };
  expect(body.error.code).toBe('campaign_not_ready');
  expect(body.error.issues.map((issue) => issue.message)).toEqual(
    report.checks.flatMap((check) => check.reasons),
  );
  const stale = await activate(report.version - 1);
  expect(stale.status()).toBe(409);
  expect(((await stale.json()) as { error: { code: string } }).error.code).toBe(
    'version_conflict',
  );
  // A blocked setting links to the stage that fixes it.
  await checks
    .locator('[data-check="sender"]')
    .getByRole('link', { name: /^Fix in Mailbox/ })
    .click();
  await expect(page).toHaveURL(wizardUrl('mailbox'));
  await stepLink(page, 'Review').click();
  await expect(page).toHaveURL(wizardUrl('review'));
  await page.getByLabel('Campaign name').fill('Spring outreach 2027');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Spring outreach 2027',
  );
  await expectAccessible(page);
  // Edit links lead back to their stage.
  await page.getByRole('link', { name: 'Edit Offer' }).click();
  await expect(page).toHaveURL(wizardUrl('offer'));
});

test('a save from an outdated page is a conflict; running campaigns are read-only', async ({
  browser,
}) => {
  const stale = await newPage(browser);
  await stale.goto(wizardUrl('business-profile'));
  await expect(stale.getByLabel('Company name')).toHaveValue('Example Co');
  const fresh = await newPage(browser);
  await fresh.goto(wizardUrl('business-profile'));
  await fresh.getByLabel('Company name').fill('Example Company');
  await fresh.getByRole('button', { name: 'Save draft' }).click();
  await expect(fresh.getByText(/^Draft saved at /)).toBeVisible();

  await stale.getByLabel('What your company does').fill('We build examples.');
  await stale.getByRole('button', { name: 'Save draft' }).click();
  const conflict = stale.getByRole('alert').filter({
    hasText: 'This campaign was changed somewhere else',
  });
  await expect(conflict).toBeVisible();
  await conflict
    .getByRole('button', { name: 'Load the latest version' })
    .click();
  await expect(stale.getByLabel('Company name')).toHaveValue('Example Company');

  await db.markCampaignRunning(campaignId);
  await stale.reload();
  await expect(
    stale.getByText('Only draft campaigns can be changed.', { exact: false }),
  ).toBeVisible();
  await expect(stale.getByLabel('Company name')).toBeDisabled();
  await expect(stale.getByRole('button', { name: 'Save draft' })).toHaveCount(
    0,
  );
  await stale.getByRole('button', { name: 'Make a copy' }).click();
  await expect(stale.getByRole('heading', { level: 1 })).toHaveText(
    'Spring outreach 2027 (copy)',
  );
  await expect(stale.getByLabel('Company name')).toBeEnabled();
  await expect(stale.getByLabel('Company name')).toHaveValue('Example Company');
});

test('every stage works on a narrow screen without sideways scrolling', async ({
  browser,
}) => {
  const page = await newPage(browser, { width: 390, height: 844 });
  for (const stage of [
    'business-profile',
    'audience',
    'offer',
    'filters',
    'mailbox',
    'sequence',
    'schedule',
    'review',
  ]) {
    await page.goto(wizardUrl(stage));
    await expect(page.getByText(/^Step \d of 8:/), stage).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, stage).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  }
});

test('unknown and foreign campaigns are a real 404', async ({ browser }) => {
  const page = await newPage(browser);
  const unknown = await page.goto(
    `/workspaces/${workspaceId}/campaigns/00000000-0000-4000-8000-000000000000`,
  );
  expect(unknown?.status()).toBe(404);
  const malformed = await page.goto(
    `/workspaces/${workspaceId}/campaigns/not-a-campaign`,
  );
  expect(malformed?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
});

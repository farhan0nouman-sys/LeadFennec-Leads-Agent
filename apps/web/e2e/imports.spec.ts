// The Imports screens (task 07C) against the real API, database and worker job: a company
// search from an ICP, run by the worker code (run-task, no Redis) and followed live; a repeat
// that matches instead of duplicating, with a suppressed domain excluded; a CSV import with a
// column mapping, a failed-row report that keeps formulas as text, and a repeat import; a
// cancelled and a failed search; a profile that can't be searched; accessibility and narrow
// screens. One account signs in once (the API limits sign-ins per address).
import { readFile } from 'node:fs/promises';
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
import { runSearchTask } from './support/worker';

test.skip(!e2eEnabled, SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const run = `imp${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple imports';
const ivy = person('ivy', 'Ivy Importer', run);

let db: E2eDatabase;
let workspaceId = '';
let session: Awaited<ReturnType<BrowserContext['storageState']>>;
const contexts: BrowserContext[] = [];

async function newPage(
  browser: Browser,
  viewport = { width: 1280, height: 900 },
): Promise<Page> {
  const context = await browser.newContext({ viewport, storageState: session });
  contexts.push(context);
  return context.newPage();
}

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

const importsUrl = () => `/workspaces/${workspaceId}/imports`;
const count = (page: Page, label: string) => page.getByTestId(`count-${label}`);
const runIdOf = (page: Page) =>
  new URL(page.url()).pathname.split('/').at(-1) ?? '';

/** Starts a search from the form and returns the run id from the page it opens. */
async function startSearch(page: Page, icp: string, most: string) {
  await page.goto(importsUrl());
  const form = page.getByRole('form', { name: 'Find companies' });
  await form.getByLabel('Ideal customer profile').selectOption({ label: icp });
  await form.getByLabel('Most companies to find').fill(most);
  await form.getByRole('button', { name: 'Find companies' }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
  return runIdOf(page);
}

test.beforeAll(async ({ browser, playwright }) => {
  db = await E2eDatabase.connect();
  const request = await playwright.request.newContext({ baseURL: WEB_URL });
  await registerVerified(request, db, ivy, PASSWORD);
  await request.dispose();
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, ivy, PASSWORD);
  session = await context.storageState();
  const created = await apiMutation(page, 'POST', '/workspaces', {
    name: `Imports ${run}`,
  });
  expect(created.status()).toBe(201);
  workspaceId = ((await created.json()) as { workspace: { id: string } })
    .workspace.id;
  await db.seedIcp(workspaceId, 'Software companies', {
    industries: ['software'],
    titles: ['VP Sales'],
  });
  await db.seedIcp(workspaceId, 'Technology buyers', {
    industries: ['software'],
    technologies: ['CRM'],
  });
});

test.afterAll(async () => {
  for (const context of contexts) {
    await context.close();
  }
  await db.close();
});

test('a search finds companies, runs in the worker and reports what was saved', async ({
  browser,
}) => {
  const page = await newPage(browser);
  await page.goto(importsUrl());
  await expect(
    page.getByRole('heading', { name: 'Imports', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Development provider: synthetic companies, not real businesses.',
    ),
  ).toBeVisible();
  await expectAccessible(page);

  const runId = await startSearch(page, 'Software companies', '30');
  await expect(
    page.getByText('Queued: the search starts shortly.'),
  ).toBeVisible();
  expect(await runSearchTask(await db.searchTaskId(workspaceId, runId))).toBe(
    'completed',
  );
  // The page follows the run by itself.
  await expect(page.getByText('Finished.')).toBeVisible({ timeout: 20_000 });
  await expect(count(page, 'Companies found')).toHaveText('30');
  await expect(count(page, 'Saved')).toHaveText('30');
  await expect(count(page, 'of them new')).toHaveText('30');
  await expect(count(page, 'Excluded')).toHaveText('0');
  await expect(count(page, 'Failed')).toHaveText('0');
  const results = page.getByRole('table', { name: 'Results' });
  await expect(results.getByRole('row')).toHaveCount(31);
  await expect(results.getByText('Saved (new)').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel search' })).toHaveCount(
    0,
  );
  expect(await db.organizationCount(workspaceId)).toBe(30);
  // Each saved company opens its profile, with its website research (task 09C).
  await expect(results.getByRole('link').first()).toHaveAttribute(
    'href',
    new RegExp(`/workspaces/${workspaceId}/leads/organizations/[0-9a-f-]{36}$`),
  );
  await expectAccessible(page);
});

test('repeating the search matches instead of duplicating, and excludes a suppressed domain', async ({
  browser,
}) => {
  const page = await newPage(browser);
  await page.goto(importsUrl());
  // Suppress the first company of the first search.
  await page
    .getByRole('table', { name: 'Imports' })
    .getByRole('link', { name: 'Company search' })
    .first()
    .click();
  const domainCell = page
    .getByRole('table', { name: 'Results' })
    .getByRole('row')
    .nth(1)
    .getByRole('cell')
    .nth(1);
  const domain = (await domainCell.textContent())?.trim() ?? '';
  expect(domain).toMatch(/\.example$/);
  await db.seedSuppressedDomain(workspaceId, domain);

  const runId = await startSearch(page, 'Software companies', '30');
  expect(await runSearchTask(await db.searchTaskId(workspaceId, runId))).toBe(
    'completed',
  );
  await page.reload();
  await expect(page.getByText('Finished.')).toBeVisible();
  await expect(count(page, 'Saved')).toHaveText('29');
  await expect(count(page, 'of them new')).toHaveText('0');
  await expect(count(page, 'Excluded')).toHaveText('1');
  expect(await db.organizationCount(workspaceId)).toBe(30);

  await page.getByLabel('Outcome').selectOption({ label: 'Excluded' });
  const excluded = page.getByRole('table', { name: 'Results' });
  await expect(excluded.getByRole('row')).toHaveCount(2);
  await expect(
    excluded.getByText(
      `The domain ${domain} is on this workspace's suppression list.`,
    ),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get('outcome')).toBe('EXCLUDED');
});

test('a CSV import maps columns, reports failed rows and downloads a safe report', async ({
  browser,
}) => {
  const page = await newPage(browser);
  await page.goto(importsUrl());
  const form = page.getByRole('form', { name: 'Import a CSV file' });
  const file = [
    'Company Name,Website,Headcount,Country,Notes',
    'Contoso Ledger,https://contoso-ledger.example,45,US,keep private',
    '"Fabrikam, Inc.",fabrikam.example,"1,200",de,',
    '=1+2,not a site,,,',
    'Northwind Rail,northwind-rail.example,lots,Germany,',
    '',
  ].join('\n');
  await form.getByLabel('CSV file').setInputFiles({
    name: 'prospects.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(file),
  });
  await expect(
    form.getByText('Columns of prospects.csv (4 rows)'),
  ).toBeVisible();
  // The guessed mapping, which the person can change.
  await expect(form.getByLabel('Company name', { exact: true })).toHaveValue(
    'Company Name',
  );
  await expect(form.getByLabel('Website (optional)')).toHaveValue('Website');
  await expect(form.getByLabel('Employees (optional)')).toHaveValue(
    'Headcount',
  );
  await expect(
    form.getByLabel('Country (two-letter code) (optional)'),
  ).toHaveValue('Country');
  await expect(form.getByLabel('Domain (optional)')).toHaveValue('');
  await expectAccessible(page);
  await form.getByRole('button', { name: 'Import companies' }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('heading', { name: 'CSV import: prospects.csv' }),
  ).toBeVisible();
  await expect(page.getByText('Finished.')).toBeVisible();
  await expect(count(page, 'Rows read')).toHaveText('4');
  await expect(count(page, 'Saved')).toHaveText('2');
  await expect(count(page, 'of them new')).toHaveText('2');
  await expect(count(page, 'Failed')).toHaveText('2');

  await page.getByLabel('Outcome').selectOption({ label: 'Failed' });
  const failed = page.getByRole('table', { name: 'Results' });
  await expect(failed.getByRole('row')).toHaveCount(3);
  await expect(
    failed.getByText('Use a web address, such as https://example.com.'),
  ).toBeVisible();
  await expect(
    failed.getByText('Use a whole number of employees, such as 120.'),
  ).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download error report' }).click();
  const report = await readFile(await (await download).path(), 'utf8');
  expect(report.split('\r\n')[0]).toBe(
    'Row,Outcome,Company,Domain,Field,Reason',
  );
  // The formula is written as text, never as something a spreadsheet would run.
  expect(report).toContain("4,Failed,'=1+2,,Website,");
  expect(report).not.toMatch(/(^|,)=1\+2/m);
  expect(report).toContain('5,Failed,Northwind Rail,,Employees,');
  expect(report).not.toContain('keep private');

  // The same file again: nothing new.
  await page.goto(importsUrl());
  await form.getByLabel('CSV file').setInputFiles({
    name: 'prospects.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(file),
  });
  const before = await db.organizationCount(workspaceId);
  await form.getByRole('button', { name: 'Import companies' }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
  await expect(count(page, 'Saved')).toHaveText('2');
  await expect(count(page, 'of them new')).toHaveText('0');
  expect(await db.organizationCount(workspaceId)).toBe(before);
});

test('a queued search can be cancelled; a failed one says why; an unsearchable profile is explained', async ({
  browser,
}) => {
  const page = await newPage(browser);
  const runId = await startSearch(page, 'Software companies', '10');
  await page.getByRole('button', { name: 'Cancel search' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Cancel this search?' });
  await expect(
    dialog.getByRole('button', { name: 'Keep searching' }),
  ).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel search' }).click();
  await expect(
    page.getByText('Cancelled. Companies saved before that were kept.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel search' })).toHaveCount(
    0,
  );
  // The worker then skips it.
  expect(await runSearchTask(await db.searchTaskId(workspaceId, runId))).toBe(
    'cancelled',
  );

  const failedId = await startSearch(page, 'Software companies', '10');
  await db.failRun(workspaceId, failedId, 'timeout');
  await page.reload();
  await expect(
    page.getByText('Stopped. Companies saved before that were kept.'),
  ).toBeVisible();
  await expect(
    page.getByText('The search provider did not answer in time.'),
  ).toBeVisible();

  await page.goto(importsUrl());
  const form = page.getByRole('form', { name: 'Find companies' });
  await form
    .getByLabel('Ideal customer profile')
    .selectOption({ label: 'Technology buyers' });
  await form.getByRole('button', { name: 'Find companies' }).click();
  await expect(
    form.getByText('This profile can’t be searched as it is:'),
  ).toBeVisible();
  await expect(
    form.getByText(
      "Company search can't filter by technologies yet. Remove it from the profile to search.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${importsUrl()}$`));
});

test('the import screens fit a narrow screen', async ({ browser }) => {
  const page = await newPage(browser, { width: 390, height: 844 });
  await page.goto(importsUrl());
  await expect(
    page.getByRole('form', { name: 'Import a CSV file' }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(page);
});

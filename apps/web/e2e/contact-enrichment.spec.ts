// Finding people for discovered companies (task 08C) against the real API, database and worker
// jobs (run-task, no Redis). The fake people providers and the fake verifier answer with
// synthetic people, so nothing leaves the machine. A finished company search offers to find
// people; the run shows its progress and what each person became; asking again matches people
// instead of duplicating them; a lead's page shows its contact data quality; and an address can
// be checked again, once a day. Accessibility is checked with axe. One account signs in once
// (the API limits sign-ins).
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  apiMutation,
  person,
  registerVerified,
  signIn,
} from './support/accounts';
import { E2eDatabase } from './support/db';
import { SKIP_REASON, WEB_URL, e2eEnabled } from './support/env';
import { runSearchTask as runTask } from './support/worker';

test.skip(!e2eEnabled, SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const run = `enr${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple people';
const owner = person('pia', 'Pia People', run);

let db: E2eDatabase;
let workspaceId = '';
let searchRunId = '';
let firstRunUrl = '';
let context: BrowserContext;
let page: Page;

async function expectAccessible() {
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
  await registerVerified(request, db, owner, PASSWORD);
  await request.dispose();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  page = await context.newPage();
  await signIn(page, owner, PASSWORD);
  const created = await apiMutation(page, 'POST', '/workspaces', {
    name: `People ${run}`,
  });
  expect(created.status()).toBe(201);
  workspaceId = ((await created.json()) as { workspace: { id: string } })
    .workspace.id;
  const icpId = await db.seedIcp(workspaceId, 'Software revenue leaders', {
    industries: ['software'],
    titles: ['VP Sales', 'Head of Revenue', 'Chief Executive Officer'],
    seniorities: ['VP'],
  });
  const listId = await db.seedLeadList(workspaceId, 'Software prospects');
  const campaign = await apiMutation(
    page,
    'POST',
    `/workspaces/${workspaceId}/campaigns`,
    { name: 'People outreach' },
  );
  expect(campaign.status()).toBe(201);
  const body = (await campaign.json()) as { id: string; version: number };
  const saved = await apiMutation(
    page,
    'PATCH',
    `/workspaces/${workspaceId}/campaigns/${body.id}`,
    { version: body.version, audience: { icpId, leadListId: listId } },
  );
  expect(saved.status()).toBe(200);
  // A finished company search (task 07C): the starting point.
  const search = await apiMutation(
    page,
    'POST',
    `/workspaces/${workspaceId}/imports/discovery`,
    { icpId, maxResults: 4 },
  );
  expect(search.status()).toBe(202);
  searchRunId = ((await search.json()) as { runId: string }).runId;
  expect(await runTask(await db.searchTaskId(workspaceId, searchRunId))).toBe(
    'completed',
  );
});

test.afterAll(async () => {
  await context.close();
  await db.close();
});

test("a finished search offers to find people, and the run shows its progress and each person's outcome", async () => {
  await page.goto(`/workspaces/${workspaceId}/imports/${searchRunId}`);
  const form = page.getByRole('form', { name: 'Find people' });
  await expect(form).toBeVisible();
  await expectAccessible();
  await form
    .getByLabel('Campaign (optional)')
    .selectOption({ label: 'People outreach' });
  await form.getByLabel('People a company').selectOption('2');
  await form.getByRole('button', { name: 'Find people' }).click();
  await expect(
    page.getByRole('heading', { name: 'People search', level: 1 }),
  ).toBeVisible();
  firstRunUrl = page.url();
  const runId = firstRunUrl.split('/').at(-1) ?? '';
  expect(await runTask(await db.enrichmentTaskId(workspaceId, runId))).toBe(
    'completed',
  );
  await page.reload();
  await expect(page.getByText('Finished.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('count-Companies done')).toHaveText('4');
  const people = page.getByRole('table', { name: 'People' });
  await expect(people.getByText('Saved (new)').first()).toBeVisible();
  await expect(page.getByText('Titles: VP Sales')).toBeVisible();
  await expectAccessible();
});

test('asking again matches the same people instead of duplicating them', async () => {
  const contacts = await db.contactCount(workspaceId);
  expect(contacts).toBeGreaterThan(0);
  await page.goto(`/workspaces/${workspaceId}/imports/${searchRunId}`);
  const form = page.getByRole('form', { name: 'Find people' });
  await form
    .getByLabel('Campaign (optional)')
    .selectOption({ label: 'People outreach' });
  await form.getByLabel('People a company').selectOption('2');
  await form.getByRole('button', { name: 'Find people' }).click();
  await expect(
    page.getByRole('heading', { name: 'People search', level: 1 }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(firstRunUrl);
  const runId = page.url().split('/').at(-1) ?? '';
  expect(await runTask(await db.enrichmentTaskId(workspaceId, runId))).toBe(
    'completed',
  );
  await page.reload();
  const people = page.getByRole('table', { name: 'People' });
  await expect(people.getByText('Already saved').first()).toBeVisible();
  await expect(people).not.toContainText('Saved (new)');
  await expect(
    people.getByText('Reused (not looked up again)').first(),
  ).toBeVisible();
  expect(await db.contactCount(workspaceId)).toBe(contacts);
});

test("a lead's page shows its contact data, and its address can be checked again once a day", async () => {
  await page.goto(firstRunUrl);
  const people = page.getByRole('table', { name: 'People' });
  const verified = people.getByRole('row').filter({ hasText: 'Verified' });
  const link = verified.first().getByRole('link');
  const name = (await link.textContent()) ?? '';
  await link.click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  const quality = page.getByRole('region', {
    name: 'Contact data',
    exact: true,
  });
  await expect(quality).toContainText('Good');
  await expect(quality).toContainText('Development data (synthetic)');
  await expect(quality).toContainText('of 100');
  await expectAccessible();

  await quality
    .getByRole('button', { name: 'Check the address again' })
    .click();
  await expect(
    page.getByText('The address will be checked again shortly.'),
  ).toBeVisible();
  const contactId = page.url().split('/').at(-1) ?? '';
  expect(await runTask(await db.recheckTaskId(workspaceId, contactId))).toBe(
    'completed',
  );
  await page.reload();
  await expect(
    quality.getByRole('button', { name: 'Check the address again' }),
  ).toBeDisabled();
  await expect(quality).toContainText('It can be checked again after');

  await page.getByRole('link', { name: 'All leads' }).click();
  const leads = page.getByRole('table', { name: 'Leads' });
  await expect(
    leads.getByRole('columnheader', { name: 'Contact data' }),
  ).toBeVisible();
  // The person's quality follows the newest check: good, or a person must look at it.
  await expect(leads).toContainText(/Good|Needs review/);
  await expectAccessible();
});

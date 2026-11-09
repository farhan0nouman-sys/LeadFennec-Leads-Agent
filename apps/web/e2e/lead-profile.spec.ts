// The lead list and a lead's profile (task 11B) against the real API and database. The list
// finds a lead; its profile shows why it exists (its source, its data's quality, its campaigns);
// a person approves it in a campaign, and a correction of its data sends that approval back to
// Review with the reason, and keeps the reason as a note; a stale page's edit fails safely; tags,
// a note and an assignment to another campaign are saved. Accessibility is checked with axe.
// One account signs in once (the API limits sign-ins).
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

test.skip(!e2eEnabled, SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const run = `lpr${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple profile';
const owner = person('lena', 'Lena Lister', run);

let db: E2eDatabase;
let workspaceId = '';
let lead: Awaited<ReturnType<E2eDatabase['seedQualificationLead']>>;
let context: BrowserContext;
let page: Page;

async function expectAccessible(target: Page = page) {
  const results = await new AxeBuilder({ page: target })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

const section = (name: string, target: Page = page) =>
  target.getByRole('region', { name, exact: true });

async function campaignWithList(name: string, listId: string) {
  const created = await apiMutation(
    page,
    'POST',
    `/workspaces/${workspaceId}/campaigns`,
    { name },
  );
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { id: string; version: number };
  const saved = await apiMutation(
    page,
    'PATCH',
    `/workspaces/${workspaceId}/campaigns/${body.id}`,
    { version: body.version, audience: { leadListId: listId } },
  );
  expect(saved.status()).toBe(200);
  return body.id;
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
    name: `Profiles ${run}`,
  });
  expect(created.status()).toBe(201);
  workspaceId = ((await created.json()) as { workspace: { id: string } })
    .workspace.id;
  lead = await db.seedQualificationLead(workspaceId, run);
  await campaignWithList('Quill outreach', lead.listId);
  await campaignWithList(
    'Second outreach',
    await db.seedLeadList(workspaceId, `Second list ${run}`),
  );
});

test.afterAll(async () => {
  await context.close();
  await db.close();
});

test('the list finds a lead, and its profile shows why the lead exists', async () => {
  await page.goto(`/workspaces/${workspaceId}/leads`);
  await expect(
    page.getByRole('heading', { name: 'Leads', level: 1 }),
  ).toBeVisible();
  const table = page.getByRole('table', { name: 'Leads' });
  await expect(
    table.getByRole('rowheader', { name: 'Quinn Park' }),
  ).toBeVisible();
  await page.getByLabel('Address check').selectOption({ label: 'Invalid' });
  await expect(page.getByText('No leads match these filters.')).toBeVisible();
  await page.getByLabel('Address check').selectOption({ label: 'Verified' });
  await expect(
    table.getByRole('rowheader', { name: 'Quinn Park' }),
  ).toBeVisible();
  await expectAccessible();

  await table.getByRole('link', { name: 'Quinn Park' }).click();
  await expect(
    page.getByRole('heading', { name: 'Quinn Park', level: 1 }),
  ).toBeVisible();
  await expect(section('Why this lead exists')).toContainText('Apollo');
  await expect(section('Contact data')).toContainText('Verified');
  await expect(section('Campaigns')).toContainText('Quill outreach');
  await expect(section('Company research')).toContainText(
    'Quill Software (synthetic)',
  );
  await expectAccessible();
});

test('a correction sends an approval back to Review, with the reason kept', async () => {
  const campaigns = section('Campaigns');
  const decide = campaigns.getByRole('form', {
    name: 'Decide in Quill outreach',
  });
  await decide.getByLabel('Decision').selectOption('QUALIFIED');
  await decide
    .getByLabel('Why?')
    .fill('Strong fit after the call (synthetic).');
  await decide.getByRole('button', { name: 'Save decision' }).click();
  await expect(section('Activity')).toContainText('Qualified');

  const correct = page.getByRole('form', { name: "Correct the lead's data" });
  await correct.getByLabel('Title').fill('Chief Revenue Officer');
  await correct
    .getByLabel('Why is it being corrected?')
    .fill('Promoted last month (synthetic).');
  await correct.getByRole('button', { name: 'Save the correction' }).click();
  await expect(
    page.getByText(/^Saved\. Drafts written for the old data/),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Quinn Park', level: 1 }),
  ).toBeVisible();
  // The approval was on the old data: the rules sent it back to Review, and said why.
  await expect(section('Activity')).toContainText(
    "The lead's data was corrected after this decision. Decide again.",
  );
  await expect(section('Notes')).toContainText(
    'Corrected title: Promoted last month (synthetic).',
  );
  await expectAccessible();
});

test('a stale page fails safely; tags, notes and an assignment are saved', async () => {
  const stale = await context.newPage();
  await stale.goto(`/workspaces/${workspaceId}/leads/${lead.contactId}`);
  await expect(
    stale.getByRole('heading', { name: 'Quinn Park', level: 1 }),
  ).toBeVisible();

  const tags = page.getByRole('form', { name: 'Tags' });
  await tags.getByLabel('Tags').fill('vip, warm');
  await tags.getByRole('button', { name: 'Save tags' }).click();
  await expect(page.getByRole('list', { name: 'Tags' })).toContainText('vip');

  // The other page still has the old version: its change is refused, nothing is overwritten.
  const staleTags = stale.getByRole('form', { name: 'Tags' });
  await staleTags.getByLabel('Tags').fill('cold');
  await staleTags.getByRole('button', { name: 'Save tags' }).click();
  await expect(
    staleTags.getByText(
      'The lead changed since you opened it. Reload it, then make your change again.',
    ),
  ).toBeVisible();
  await stale.close();
  await page.reload();
  await expect(page.getByRole('list', { name: 'Tags' })).toContainText('warm');
  await expect(page.getByRole('list', { name: 'Tags' })).not.toContainText(
    'cold',
  );

  const note = page.getByRole('form', { name: 'Add a note' });
  await note.getByLabel('Note').fill('Prefers email (synthetic).');
  await note.getByRole('button', { name: 'Add note' }).click();
  await expect(section('Notes')).toContainText('Prefers email (synthetic).');

  const assign = page.getByRole('form', { name: 'Add to a campaign' });
  await assign
    .getByLabel('Campaign')
    .selectOption({ label: 'Second outreach' });
  await assign.getByRole('button', { name: 'Add to campaign' }).click();
  await expect(section('Campaigns')).toContainText('Second outreach');
  await expectAccessible();
});

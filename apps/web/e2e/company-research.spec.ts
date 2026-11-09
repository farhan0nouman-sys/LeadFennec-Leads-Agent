// A company's profile with its website research (task 09C) against the real API, database and
// worker job (run-task, no Redis). The fake website fetcher serves synthetic pages and the fake
// model reads them, so nothing leaves the machine. Research is requested, run and shown with its
// dated evidence; reading the pages again reuses the unchanged findings (no AI call) as a new
// version; a correction is a new, audited version; earlier versions stay as they were.
// Accessibility is checked with axe. One account signs in once (the API limits sign-ins).
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

const run = `rsc${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple research';
const rae = person('rae', 'Rae Researcher', run);

let db: E2eDatabase;
let workspaceId = '';
let organizationId = '';
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

const profileUrl = () =>
  `/workspaces/${workspaceId}/leads/organizations/${organizationId}`;

/** Runs the newest research of the company with the worker's code. */
async function runLatestResearch(): Promise<string> {
  const researchId = await db.latestResearchId(workspaceId, organizationId);
  return runTask(await db.researchTaskId(workspaceId, researchId));
}

test.beforeAll(async ({ browser, playwright }) => {
  db = await E2eDatabase.connect();
  const request = await playwright.request.newContext({ baseURL: WEB_URL });
  await registerVerified(request, db, rae, PASSWORD);
  await request.dispose();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  page = await context.newPage();
  await signIn(page, rae, PASSWORD);
  const created = await apiMutation(page, 'POST', '/workspaces', {
    name: `Research ${run}`,
  });
  expect(created.status()).toBe(201);
  workspaceId = ((await created.json()) as { workspace: { id: string } })
    .workspace.id;
  organizationId = await db.seedOrganization(
    workspaceId,
    'Acme Synth (synthetic)',
    'https://acme-synth.example/',
  );
});

test.afterAll(async () => {
  await context.close();
  await db.close();
});

test('research is requested, run by the worker and shown with dated evidence', async () => {
  await page.goto(profileUrl());
  await expect(
    page.getByRole('heading', { name: 'Acme Synth (synthetic)' }),
  ).toBeVisible();
  await expect(page.getByText('No research yet')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Breadcrumb' }),
  ).toContainText('Company profile');
  await expectAccessible();

  await page.getByRole('button', { name: 'Research the website' }).click();
  await expect(
    page.getByText('Research is queued.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Research is queued').first()).toBeVisible();
  expect(await runLatestResearch()).toBe('completed');

  // The page follows the run and shows version 1 when it finishes.
  await expect(page.getByText(/Current research · Version 1/)).toBeVisible({
    timeout: 30_000,
  });
  const facts = page.getByRole('table', { name: 'Facts' });
  await expect(
    facts.getByRole('rowheader', { name: 'What they do' }),
  ).toBeVisible();
  await expect(facts).toContainText('This synthetic page stands for');
  await expect(facts.getByText('Quoted from the pages')).toBeVisible();
  // Its evidence: the extract, the page it came from and when it was read.
  await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
  await expect(
    page.getByText('https://acme-synth.example/', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/^Read .* · page version [0-9a-f]{12}$/).first(),
  ).toBeVisible();
  await page.getByText('Show the extract').first().click();
  await expect(page.locator('mark').first()).toContainText(
    'This synthetic page stands for',
  );
  // Fields no page stated are unknown, never guessed.
  await expect(page.getByRole('heading', { name: 'Unknown' })).toBeVisible();
  await expect(page.getByText('Headquarters', { exact: true })).toBeVisible();
  // The home page and the pages it links to were read.
  await expect(
    page
      .getByRole('region', { name: 'Pages' })
      .getByText('https://acme-synth.example/about'),
  ).toBeVisible();
  await expectAccessible();
});

test('reading the pages again reuses unchanged findings as a new version, without the AI', async () => {
  await page.goto(profileUrl());
  // Fresh research is kept: the plain request isn't offered, a refresh is.
  await expect(
    page.getByRole('button', { name: 'Research the website' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Read the pages again' }).click();
  await expect(
    page.getByText('Research is queued.', { exact: true }),
  ).toBeVisible();
  expect(await runLatestResearch()).toBe('reused');
  await expect(page.getByText(/Current research · Version 2/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page
      .getByText('Pages unchanged: earlier findings reused, no AI call')
      .first(),
  ).toBeVisible();
  const history = page.getByRole('table', { name: 'Research history' });
  await expect(history.getByRole('row')).toHaveCount(3);
});

test('a correction is a new version; earlier versions stay as they were', async () => {
  await page.goto(profileUrl());
  await page.getByRole('button', { name: 'Correct Headquarters' }).click();
  const form = page.getByRole('form', { name: 'Correct Headquarters' });
  await form.getByLabel('Right value').fill('Lyon (synthetic)');
  await form
    .getByLabel('Why (kept with the correction)')
    .fill('Confirmed by phone (synthetic note).');
  await form.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText(/Current research · Version 3/)).toBeVisible();
  const facts = page.getByRole('table', { name: 'Facts' });
  await expect(facts).toContainText('Lyon (synthetic)');
  await expect(facts.getByText('Corrected by a person')).toBeVisible();
  await expect(page.getByText('Note by a person')).toBeVisible();
  expect(await db.workspaceAuditActions(workspaceId)).toEqual(
    expect.arrayContaining([
      'research.requested',
      'research.completed',
      'research.corrected',
    ]),
  );

  // Version 1 is still there, unchanged: no correction, Headquarters unknown.
  await page
    .getByRole('table', { name: 'Research history' })
    .getByRole('button', { name: /^View Version 1/ })
    .click();
  await expect(page.getByText(/An earlier version · Version 1/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Facts' })).not.toContainText(
    'Lyon (synthetic)',
  );
  await expect(
    page.getByText('Earlier versions are kept as they were.'),
  ).toBeVisible();
  await expectAccessible();
  await page
    .getByRole('button', { name: 'Back to the current research' })
    .click();
  await expect(page.getByText(/Current research · Version 3/)).toBeVisible();
});

test('another workspace never sees the company', async () => {
  const response = await page.goto(
    `/workspaces/${workspaceId}/leads/organizations/00000000-0000-4000-8000-000000000000`,
  );
  expect(response?.status()).toBe(404);
});

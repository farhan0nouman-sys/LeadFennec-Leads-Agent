// Import, search, correction, export and privacy end to end (task 11C) against the real API,
// database and worker job (run-task, no Redis), in two workspaces: a people file is checked,
// imported in batches you can follow, and reported (formulas as text); the people are found and
// corrected; the leads are exported to a file only their maker downloads (formulas as text);
// a lead is erased on request and stays on the do-not-contact list, so importing the same file
// again excludes them; the list is managed on its own page; the other workspace sees none of it.
// Accessibility is checked with axe. One account signs in once (the API limits sign-ins).
import { readFile } from 'node:fs/promises';
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
import { runSearchTask } from './support/worker';

test.skip(!e2eEnabled, SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const run = `lwf${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple workflow';
const owner = person('wren', 'Wren Workflow', run);
const NORA = `nora.${run}@field.example`;
const OPTED = `opted.${run}@people.example`;

let db: E2eDatabase;
let workspaceId = '';
let otherWorkspaceId = '';
let context: BrowserContext;
let page: Page;
let runId = '';

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

const peopleFile = [
  'First Name,Last Name,Email,Job Title,Company,Website,Notes',
  `Nora,Field,${NORA},=SUM(A1),Field Co,field.example,keep private`,
  `Opted,Out,${OPTED},CEO,People Co,people.example,`,
  'Bad,Address,not-an-address,CTO,Bad Co,bad.example,',
  '',
].join('\n');

/** Imports the people file from the Imports page and returns the run's id. */
async function importPeople(fileName: string) {
  await page.goto(`/workspaces/${workspaceId}/imports`);
  const form = page.getByRole('form', {
    name: 'Import people from a CSV file',
  });
  await form.getByLabel('CSV file of people').setInputFiles({
    name: fileName,
    mimeType: 'text/csv',
    buffer: Buffer.from(peopleFile),
  });
  await expect(form.getByText(`Columns of ${fileName} (3 rows)`)).toBeVisible();
  // The guessed mapping, which the person can change.
  await expect(form.getByLabel('First name', { exact: true })).toHaveValue(
    'First Name',
  );
  await expect(form.getByLabel('Company name', { exact: true })).toHaveValue(
    'Company',
  );
  await expect(form.getByLabel('Email address (optional)')).toHaveValue(
    'Email',
  );
  await expect(form.getByLabel('Company domain (optional)')).toHaveValue(
    'Website',
  );
  await form.getByRole('button', { name: 'Import people' }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
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
  for (const name of [`People ${run}`, `Other ${run}`]) {
    const created = await apiMutation(page, 'POST', '/workspaces', { name });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { workspace: { id: string } })
      .workspace.id;
    if (workspaceId === '') {
      workspaceId = id;
    } else {
      otherWorkspaceId = id;
    }
  }
  await db.seedSuppressedEmail(workspaceId, OPTED);
});

test.afterAll(async () => {
  await context.close();
  await db.close();
});

test('a people file is checked, imported in batches and reported', async () => {
  runId = await importPeople('people.csv');
  await expect(
    page.getByRole('heading', { name: 'People import: people.csv' }),
  ).toBeVisible();
  // The failed row is reported before the worker runs.
  await expect(
    page.getByText('Queued: the import starts shortly.'),
  ).toBeVisible();
  await expect(page.getByTestId('rows-done')).toHaveText('1 of 3 rows done');
  await expectAccessible();
  expect(
    await runSearchTask(await db.contactImportTaskId(workspaceId, runId)),
  ).toBe('completed');
  // The page follows the run by itself.
  await expect(page.getByText('Finished.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('rows-done')).toHaveText('3 of 3 rows done');
  await expect(page.getByTestId('count-Saved')).toHaveText('1');
  await expect(page.getByTestId('count-Excluded')).toHaveText('1');
  await expect(page.getByTestId('count-Failed')).toHaveText('1');
  const results = page.getByRole('table', { name: 'Results' });
  await expect(results.getByRole('link', { name: 'Nora Field' })).toBeVisible();
  await expect(
    results.getByText('This address is on the do-not-contact list.'),
  ).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download error report' }).click();
  const report = await readFile(await (await download).path(), 'utf8');
  expect(report.split('\r\n')[0]).toBe(
    'Row,Outcome,Person,Email,Company,Field,Reason',
  );
  expect(report).toContain(`3,Excluded,Opted Out,${OPTED},People Co,`);
  expect(report).toContain('4,Failed,Bad Address,not-an-address,Bad Co,');
  expect(report).not.toContain('keep private');
  await expectAccessible();
});

test('the lead is found, corrected and exported to a file only its maker downloads', async () => {
  await page.goto(`/workspaces/${workspaceId}/leads`);
  await page.getByLabel('Search').fill('Nora');
  const table = page.getByRole('table', { name: 'Leads' });
  await expect(
    table.getByRole('rowheader', { name: 'Nora Field' }),
  ).toBeVisible();
  await table.getByRole('link', { name: 'Nora Field' }).click();
  await expect(
    page.getByRole('heading', { name: 'Nora Field', level: 1 }),
  ).toBeVisible();
  // Why the lead exists: the CSV import, linked.
  await expect(
    page.getByRole('region', { name: 'Why this lead exists' }),
  ).toContainText('CSV import');
  const correct = page.getByRole('form', { name: "Correct the lead's data" });
  await correct.getByLabel('Title').fill('Head of Data');
  await correct
    .getByLabel('Why is it being corrected?')
    .fill('The file had a formula (synthetic).');
  await correct.getByRole('button', { name: 'Save the correction' }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  await page.goto(`/workspaces/${workspaceId}/leads`);
  const exports = page.getByRole('region', { name: 'Export to a file' });
  await exports.getByRole('button', { name: 'Export these leads' }).click();
  await expect(exports.getByRole('status')).toContainText(/is ready: 1 lead\./);
  const files = exports.getByRole('table', { name: 'Your files' });
  await expect(files.getByText('Ready')).toBeVisible();
  await expectAccessible();
  const download = page.waitForEvent('download');
  await files.getByRole('link', { name: /^Download leads-/ }).click();
  const file = await readFile(await (await download).path());
  // A byte-order mark for spreadsheets, then the leads; nothing runs as a formula.
  expect([...file.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = file.toString('utf8');
  expect(text).toContain('Nora Field,Head of Data');
  expect(text).toContain(NORA);
  expect(text).not.toContain(OPTED);
});

test('an erased lead stays on the do-not-contact list and is never imported again', async () => {
  await page.goto(`/workspaces/${workspaceId}/leads`);
  await page.getByRole('link', { name: 'Nora Field' }).click();
  const privacy = page.getByRole('region', { name: 'Privacy' });
  await expect(privacy).toBeVisible();
  await expectAccessible();
  await privacy.getByRole('button', { name: 'Erase this lead’s data' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Erase this lead?' });
  await dialog.getByRole('button', { name: 'Erase the lead' }).click();
  await expect(
    page.getByText(
      'The lead was erased. Only their address stays, on the do-not-contact list.',
    ),
  ).toBeVisible();
  // Only the address is kept, without a note.
  expect(await db.suppressionOf(workspaceId, NORA)).toEqual({
    reason: 'DELETION_REQUEST',
    note: null,
  });

  // The same file again: Nora is excluded now, like the opted-out person.
  const again = await importPeople('people-again.csv');
  expect(
    await runSearchTask(await db.contactImportTaskId(workspaceId, again)),
  ).toBe('completed');
  await expect(page.getByText('Finished.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('count-Saved')).toHaveText('0');
  await expect(page.getByTestId('count-Excluded')).toHaveText('2');
  const results = page.getByRole('table', { name: 'Results' });
  await expect(
    results.getByText('This address is on the do-not-contact list.'),
  ).toHaveCount(2);
  await expect(results.getByRole('link', { name: 'Nora Field' })).toHaveCount(
    0,
  );
});

test('the do-not-contact list is managed on its own page; the other workspace sees none of it', async () => {
  await page.goto(`/workspaces/${workspaceId}/suppressions`);
  await expect(
    page.getByRole('heading', { name: 'Do-not-contact list', level: 1 }),
  ).toBeVisible();
  const list = page.getByRole('table', { name: 'Do-not-contact list' });
  await expect(list.getByRole('rowheader', { name: NORA })).toBeVisible();
  await expect(list.getByText('Data deleted on request')).toBeVisible();
  await expectAccessible();

  const add = page.getByRole('form', { name: 'Add to the list' });
  await add.getByLabel('What').selectOption('domain');
  await add.getByLabel('Domain').fill('https://www.rival-example.com/');
  await add.getByRole('button', { name: 'Add to the list' }).click();
  await expect(add.getByRole('status')).toHaveText(
    'Added. No lead in the workspace has it.',
  );
  await expect(
    list.getByRole('rowheader', { name: 'rival-example.com' }),
  ).toBeVisible();
  const row = list.getByRole('row', { name: /rival-example\.com/ });
  await row.getByRole('button', { name: 'Remove' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(
    list.getByRole('rowheader', { name: 'rival-example.com' }),
  ).toHaveCount(0);
  // A person's request can't be removed.
  await expect(
    list.getByRole('row', { name: new RegExp(NORA.replace('.', '\\.')) }),
  ).toContainText('Stays');

  // The other workspace: no leads, an empty list.
  await page.goto(`/workspaces/${otherWorkspaceId}/leads`);
  await expect(page.getByText('No leads yet', { exact: true })).toBeVisible();
  await page.goto(`/workspaces/${otherWorkspaceId}/suppressions`);
  await expect(page.getByText('The list is empty')).toBeVisible();
  await page.goto(`/workspaces/${otherWorkspaceId}/imports/${runId}`);
  await expect(
    page.getByRole('heading', { name: 'Page not found', level: 1 }),
  ).toBeVisible();
  await expectAccessible();
});

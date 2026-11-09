// The shared UI components (task 05B) on the fixture demo page (/dev/ui): paginated table,
// search and filters in the address, status labels, empty and retry states, confirmation
// dialogs, a validated form in a dialog, and an error boundary, with axe checks. Fixture data
// only: no API or database is needed, so these always run.
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { WEB_URL } from './support/env';

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

const table = (page: Page) => page.getByRole('table', { name: 'Demo leads' });
const rows = (page: Page) => table(page).locator('tbody tr');

test.beforeEach(async ({ page }) => {
  const response = await page.goto('/dev/ui');
  expect(response?.status()).toBe(200);
  await expect(page.getByText('42 leads match.')).toBeVisible();
});

test('the demo says its data is invented and is not indexed', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Component demo' }),
  ).toBeVisible();
  await expect(page.getByText('Nothing here is real')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
  await expect(
    page.getByRole('list', { name: 'Lead statuses' }).getByRole('listitem'),
  ).toHaveCount(6);
  await expectAccessible(page);
});

test('pages through the table by cursor and changes the page size', async ({
  page,
}) => {
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).first()).toContainText('Avery Stone');
  const pager = page.getByRole('navigation', { name: 'Demo leads pages' });
  await expect(pager.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await pager.getByRole('button', { name: 'Next' }).click();
  await expect(pager.getByText('Page 2')).toBeVisible();
  await expect(rows(page).first()).toContainText('Casey Rivers');
  await pager.getByRole('button', { name: 'Previous' }).click();
  await expect(pager.getByText('Page 1')).toBeVisible();
  await expect(rows(page).first()).toContainText('Avery Stone');

  await pager.getByLabel('Rows per page').selectOption('5');
  await expect(page).toHaveURL(`${WEB_URL}/dev/ui?limit=5`);
  await expect(rows(page)).toHaveCount(5);
  // The last of 42 rows at 5 per page is on page 9, where Next is off.
  for (let page_ = 2; page_ <= 9; page_ += 1) {
    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(pager.getByText(`Page ${String(page_)}`)).toBeVisible();
  }
  await expect(rows(page)).toHaveCount(2);
  await expect(pager.getByRole('button', { name: 'Next' })).toBeDisabled();
});

test('searches and filters through the address, with an empty state', async ({
  page,
}) => {
  const filters = page.getByRole('search', { name: 'Filter demo leads' });
  await filters.getByLabel('Search leads').fill('northwind');
  await expect(page).toHaveURL(`${WEB_URL}/dev/ui?q=northwind`);
  await expect(page.getByText('9 leads match.')).toBeVisible();
  await filters.getByLabel('Status').selectOption({ label: 'Do not contact' });
  await expect(page).toHaveURL(
    `${WEB_URL}/dev/ui?q=northwind&status=do_not_contact`,
  );
  await expect(page.getByText('2 leads match.')).toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  // A shared address opens the same view.
  await page.goto('/dev/ui?q=northwind&status=do_not_contact');
  await expect(page.getByText('2 leads match.')).toBeVisible();
  await expect(filters.getByLabel('Search leads')).toHaveValue('northwind');

  await filters.getByLabel('Search leads').fill('no such lead');
  await filters.getByLabel('Search leads').press('Enter');
  await expect(page.getByText('No leads match')).toBeVisible();
  await expect(table(page)).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Clear filters' }).last().click();
  await expect(page).toHaveURL(`${WEB_URL}/dev/ui`);
  await expect(page.getByText('42 leads match.')).toBeVisible();
  // The search box follows a change made outside it.
  await expect(filters.getByLabel('Search leads')).toHaveValue('');
});

test('treats the address as untrusted: invalid values fall back to defaults', async ({
  page,
}) => {
  await page.goto(
    `/dev/ui?limit=100000&status=${encodeURIComponent('<script>')}&q=${'x'.repeat(200)}`,
  );
  await expect(page.getByText('42 leads match.')).toBeVisible();
  await expect(rows(page)).toHaveCount(10);
});

test('shows a retry state when loading fails, and recovers', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Fail the next load' }).click();
  const failure = page.getByRole('alert').filter({
    hasText: "We couldn't load demo leads",
  });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('told to fail this load');
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(rows(page)).toHaveCount(10);
  await expect(failure).toHaveCount(0);
});

test('asks before removing, keeps focus safe, and can be cancelled', async ({
  page,
}) => {
  const remove = page.getByRole('button', { name: 'Remove Avery Stone' });
  await remove.click();
  const dialog = page.getByRole('alertdialog', { name: 'Remove Avery Stone?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(/nothing is saved/);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(rows(page).first()).toContainText('Avery Stone');

  await remove.click();
  await dialog.getByRole('button', { name: 'Remove lead' }).click();
  await expect(page.getByText('Avery Stone was removed.')).toBeVisible();
  await expect(page.getByText('41 leads match.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove Avery Stone' }),
  ).toHaveCount(0);

  // Typed confirmation for an action that is hard to undo.
  await page.getByRole('button', { name: 'Reset list' }).click();
  const reset = page.getByRole('alertdialog', { name: 'Reset the demo list?' });
  const confirm = reset.getByRole('button', { name: 'Reset list' });
  await expect(confirm).toBeDisabled();
  await reset.getByLabel('Type reset to confirm').fill('reset');
  await confirm.click();
  await expect(page.getByText('42 leads match.')).toBeVisible();
});

test('validates a form in a dialog, with field and server-side errors', async ({
  page,
}) => {
  const open = page.getByRole('button', { name: 'Add a demo lead' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Add a demo lead' });
  await dialog.getByRole('button', { name: 'Add lead' }).click();
  await expect(dialog.getByLabel('Name')).toHaveAccessibleDescription(
    'Enter a name.',
  );
  await expect(dialog.getByText('Enter an email address.')).toBeVisible();
  await expect(dialog.getByLabel('Email')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expectAccessible(page);

  await dialog.getByLabel('Name').fill('Robin Example');
  await dialog.getByLabel('Email').fill('avery.stone.1@example.com');
  await dialog.getByRole('button', { name: 'Add lead' }).click();
  await expect(
    dialog.getByText('This address is already on the list.'),
  ).toBeVisible();

  await dialog.getByLabel('Email').fill('robin@example.com');
  await dialog.getByLabel('Status').selectOption({ label: 'Qualified' });
  await dialog.getByRole('button', { name: 'Add lead' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(page.getByText('Robin Example was added.')).toBeVisible();
  await expect(page.getByText('43 leads match.')).toBeVisible();
});

test('contains a failing panel in an error boundary', async ({ page }) => {
  await page.getByRole('button', { name: 'Break this panel' }).click();
  const fallback = page.getByRole('alert').filter({
    hasText: 'The demo panel failed',
  });
  await expect(fallback).toBeVisible();
  // Only a generic text: the thrown message is not shown.
  await expect(fallback).not.toContainText('on purpose');
  // The rest of the page still works.
  await expect(rows(page)).toHaveCount(10);
  await fallback.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('button', { name: 'Break this panel' }),
  ).toBeVisible();
});

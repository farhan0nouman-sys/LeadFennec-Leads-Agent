// The typed API client and its workspace-scoped cache (task 05B) against the real API: a
// change reloads the affected list without a page reload, in its own workspace only; another
// workspace's screens never request or show its data; destructive actions ask first; and a
// session that ends while a page is open sends the user to sign in.
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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

const run = `data${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple data';
const ada = person('ada', 'Ada Admin', run);
const firstName = `First ${run}`;
const secondName = `Second ${run}`;
const xavier = `xavier.${run}@example.test`;
const yara = `yara.${run}@example.test`;

let db: E2eDatabase;
let page: Page;
let firstId = '';
let secondId = '';

/** Workspace ids in the API requests the page makes from now on. */
function workspaceRequests(target: Page): Set<string> {
  const seen = new Set<string>();
  target.on('request', (request) => {
    const match = /\/api\/workspaces\/([0-9a-f-]{36})(\/|$|\?)/.exec(
      request.url(),
    );
    if (match?.[1] !== undefined) {
      seen.add(match[1]);
    }
  });
  return seen;
}

test.beforeAll(async ({ browser, playwright }) => {
  db = await E2eDatabase.connect();
  const request = await playwright.request.newContext({ baseURL: WEB_URL });
  await registerVerified(request, db, ada, PASSWORD);
  await request.dispose();
  page = await (await browser.newContext()).newPage();
  await signIn(page, ada, PASSWORD);
  for (const name of [firstName, secondName]) {
    const created = await apiMutation(page, 'POST', '/workspaces', { name });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as { workspace: { id: string } };
    if (name === firstName) {
      firstId = body.workspace.id;
    } else {
      secondId = body.workspace.id;
    }
  }
});

test.afterAll(async () => {
  await page.context().close();
  await db.close();
});

test('a change reloads its list in its own workspace only', async () => {
  await page.goto(`/workspaces/${firstId}/team`);
  await expect(page.getByText('No open invitations')).toBeVisible();
  await page.getByLabel('Email address to invite').fill(xavier);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${xavier}.`)).toBeVisible();
  // The list loaded again by itself (the mutation invalidated it), without a page reload.
  await expect(page.getByTestId(`invitation-${xavier}`)).toBeVisible();

  // Another workspace, by client-side navigation: none of the first one's data.
  const seen = workspaceRequests(page);
  await page
    .getByRole('combobox', { name: 'Workspace' })
    .selectOption({ label: secondName });
  await expect(page).toHaveURL(`${WEB_URL}/workspaces/${secondId}/team`);
  await expect(page.getByText('No open invitations')).toBeVisible();
  await expect(page.getByTestId(`invitation-${xavier}`)).toHaveCount(0);
  await page.getByLabel('Email address to invite').fill(yara);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByTestId(`invitation-${yara}`)).toBeVisible();
  expect([...seen]).toEqual([secondId]);

  // Back to the first: its own invitation, not the second's.
  await page
    .getByRole('combobox', { name: 'Workspace' })
    .selectOption({ label: firstName });
  await expect(page).toHaveURL(`${WEB_URL}/workspaces/${firstId}/team`);
  await expect(page.getByTestId(`invitation-${xavier}`)).toBeVisible();
  await expect(page.getByTestId(`invitation-${yara}`)).toHaveCount(0);
});

test('revoking asks first, and Escape changes nothing', async () => {
  await page.goto(`/workspaces/${firstId}/team`);
  const revoke = page.getByRole('button', {
    name: `Revoke the invitation for ${xavier}`,
  });
  await revoke.click();
  const dialog = page.getByRole('alertdialog', {
    name: 'Revoke this invitation?',
  });
  await expect(dialog).toContainText(xavier);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(revoke).toBeFocused();
  await expect(page.getByTestId(`invitation-${xavier}`)).toBeVisible();

  await revoke.click();
  await dialog.getByRole('button', { name: 'Revoke invitation' }).click();
  await expect(
    page.getByText(`The invitation for ${xavier} was revoked.`),
  ).toBeVisible();
  await expect(page.getByTestId(`invitation-${xavier}`)).toHaveCount(0);
  expect(await db.workspaceAuditActions(firstId)).toContain(
    'invitation.revoked',
  );
});

test('a session that ends while a page is open sends the user to sign in', async () => {
  await page.goto(`/workspaces/${secondId}/team`);
  await expect(page.getByTestId(`invitation-${yara}`)).toBeVisible();
  await db.expireSessions(ada.email);
  await page
    .getByLabel('Email address to invite')
    .fill(`zed.${run}@example.test`);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page).toHaveURL(
    `${WEB_URL}/login?${new URLSearchParams({
      next: `/workspaces/${secondId}/team`,
      reason: 'expired',
    }).toString()}`,
  );
  // Nothing of the workspace stays on screen.
  await expect(page.getByText(yara)).toHaveCount(0);
});

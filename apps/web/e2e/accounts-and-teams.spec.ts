// Account and team screens against the real API and database (task 04C): two workspaces
// (tenants) and all three roles (Client Admin, Client Team Member, Platform Admin). Emails are
// never sent (fake mail provider); e2e/support/db.ts stands in for the inbox.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { E2eDatabase } from './support/db';
import { SKIP_REASON, WEB_URL, e2eEnabled } from './support/env';

test.skip(!e2eEnabled, SKIP_REASON);
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const PASSWORD = 'correct horse battery staple e2e';
const NEW_PASSWORD = 'a different and longer passphrase';

interface Person {
  readonly email: string;
  readonly name: string;
}
const person = (key: string, name: string): Person => ({
  email: `${key}.${run}@example.test`,
  name,
});
const alice = person('alice', 'Alice Admin');
const bob = person('bob', 'Bob Member');
const carol = person('carol', 'Carol Beta');
const erin = person('erin', 'Erin Late');
const pat = person('pat', 'Pat Platform');
const alphaName = `Alpha ${run}`;
const betaName = `Beta ${run}`;

/** Everything that must never appear in an audit record. */
const secrets = new Set<string>([PASSWORD, NEW_PASSWORD]);

let db: E2eDatabase;
let alphaId = '';
let betaId = '';
const pages = new Map<Person, Page>();
const contexts: BrowserContext[] = [];

test.beforeAll(async () => {
  db = await E2eDatabase.connect();
});

test.afterAll(async () => {
  for (const context of contexts) {
    await context.close();
  }
  await db.close();
});

/** A separate browser (cookies, session) per person. */
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

async function freshBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}

/** Registration and confirmation through the API (the screens are covered once, by Alice). */
async function registerVerified(
  request: APIRequestContext,
  who: Person,
): Promise<void> {
  const headers = { origin: WEB_URL };
  const registered = await request.post('/api/auth/register', {
    data: { email: who.email, password: PASSWORD, displayName: who.name },
    headers,
  });
  expect(registered.status()).toBe(202);
  const token = await db.issueToken(who.email, 'EMAIL_VERIFICATION');
  secrets.add(token);
  const verified = await request.post('/api/auth/verify-email', {
    data: { token },
    headers,
  });
  expect(verified.status()).toBe(200);
}

/** Remembers the session cookie and CSRF token, so the audit check can look for them. */
async function rememberSessionSecrets(page: Page): Promise<void> {
  for (const cookie of await page.context().cookies()) {
    secrets.add(cookie.value);
  }
  const session = await page.request.get('/api/auth/session');
  const body = (await session.json()) as { csrfToken?: string };
  if (body.csrfToken !== undefined) {
    secrets.add(body.csrfToken);
  }
}

async function fillSignIn(page: Page, who: Person, password: string) {
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function signIn(page: Page, who: Person, password = PASSWORD) {
  await page.goto('/login');
  await fillSignIn(page, who, password);
  await expect(page).toHaveURL(`${WEB_URL}/workspaces`);
  await rememberSessionSecrets(page);
}

async function acceptInvitation(page: Page, token: string, workspace: string) {
  await page.goto(`/invitations/accept#token=${token}`);
  await expect(
    page.getByRole('heading', { name: `Join ${workspace}` }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Join workspace' }).click();
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
}

const workspaceIdOf = (page: Page) =>
  /\/workspaces\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';

test('registers with form validation, confirms the email once, and signs in', async ({
  browser,
}) => {
  const page = await browserOf(browser, alice);
  await page.goto('/register');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter an email address.')).toBeVisible();
  await expect(page.getByText('Use at least 15 characters.')).toBeVisible();

  await page.getByLabel('Name (optional)').fill(alice.name);
  await page.getByLabel('Email').fill(alice.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(`${PASSWORD} typo`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your inbox' }),
  ).toBeVisible();

  // An unconfirmed account can't sign in yet.
  await page.goto('/login');
  await fillSignIn(page, alice, PASSWORD);
  await expect(
    page.getByText('Confirm your email address first.'),
  ).toBeVisible();

  const token = await db.issueToken(alice.email, 'EMAIL_VERIFICATION');
  secrets.add(token);
  await page.goto('/verify-email#token=not-a-real-token');
  await expect(
    page.getByRole('heading', { name: 'This link is invalid or has expired' }),
  ).toBeVisible();
  await page.goto(`/verify-email#token=${token}`);
  // The token leaves the address bar before anything else happens.
  await expect(page).toHaveURL(`${WEB_URL}/verify-email`);
  await page.getByRole('button', { name: 'Confirm my email address' }).click();
  await expect(
    page.getByRole('heading', { name: 'Email address confirmed' }),
  ).toBeVisible();
  // The link works once (opened again from the email: a new page load).
  await page.goto('/');
  await page.goto(`/verify-email#token=${token}`);
  await page.getByRole('button', { name: 'Confirm my email address' }).click();
  await expect(
    page.getByRole('heading', { name: 'This link is invalid or has expired' }),
  ).toBeVisible();

  await page.goto('/login');
  await fillSignIn(page, alice, NEW_PASSWORD);
  await expect(
    page.getByText('The email address or password is incorrect.'),
  ).toBeVisible();
  await fillSignIn(page, alice, PASSWORD);
  await expect(page).toHaveURL(`${WEB_URL}/workspaces`);
  await expect(
    page.getByText('You are not a member of any workspace yet.'),
  ).toBeVisible();
  await rememberSessionSecrets(page);
});

test('an admin creates a workspace, invites people and revokes an invitation', async ({
  browser,
}) => {
  const page = await browserOf(browser, alice);
  await page.goto('/workspaces');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();
  await page.getByLabel('Workspace name').fill(alphaName);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: alphaName })).toBeVisible();
  alphaId = workspaceIdOf(page);
  expect(alphaId).not.toBe('');
  await expect(page.getByText('Client Admin')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('link', { name: 'Team' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Team', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId(`member-${alice.email}`)).toContainText(
    '(you)',
  );

  const invite = page.getByLabel('Email address to invite');
  const send = page.getByRole('button', { name: 'Send invitation' });
  await invite.fill('not-an-address');
  await send.click();
  await expect(page.getByText('Enter an email address.')).toBeVisible();
  await invite.fill(alice.email);
  await send.click();
  await expect(
    page.getByText(
      'This address already belongs to a member of the workspace.',
    ),
  ).toBeVisible();

  await invite.fill(bob.email);
  await expect(page.getByLabel('Role', { exact: true })).toHaveValue(/.+/);
  await send.click();
  await expect(
    page.getByText(`Invitation sent to ${bob.email}.`),
  ).toBeVisible();
  await expect(page.getByTestId(`invitation-${bob.email}`)).toContainText(
    'Client Team Member',
  );

  const dave = person('dave', 'Dave');
  await invite.fill(dave.email);
  await send.click();
  await expect(page.getByTestId(`invitation-${dave.email}`)).toBeVisible();
  await page
    .getByRole('button', { name: `Revoke the invitation for ${dave.email}` })
    .click();
  await expect(page.getByTestId(`invitation-${dave.email}`)).toHaveCount(0);
  await expect(
    page.getByText(`The invitation for ${dave.email} was revoked.`),
  ).toBeVisible();
});

test('only the invited account can accept, after signing in', async ({
  browser,
  request,
}) => {
  await registerVerified(request, bob);
  await registerVerified(request, carol);
  const token = await db.issueInvitation({
    workspaceId: alphaId,
    email: bob.email,
    roleKey: 'client_member',
  });
  secrets.add(token);

  // Someone else, signed in, learns nothing about the workspace.
  const carolPage = await browserOf(browser, carol);
  await signIn(carolPage, carol);
  await carolPage.goto(`/invitations/accept#token=${token}`);
  await expect(
    carolPage.getByRole('heading', {
      name: 'This invitation is for another email address',
    }),
  ).toBeVisible();
  await expect(carolPage.getByText(alphaName)).toHaveCount(0);

  // Bob, signed out, is asked to sign in and comes back to the invitation.
  const bobPage = await browserOf(browser, bob);
  await bobPage.goto(`/invitations/accept#token=${token}`);
  await expect(bobPage).toHaveURL(`${WEB_URL}/invitations/accept`);
  await expect(
    bobPage.getByRole('heading', { name: 'Sign in to accept your invitation' }),
  ).toBeVisible();
  await bobPage.getByRole('link', { name: 'Sign in', exact: true }).click();
  await fillSignIn(bobPage, bob, PASSWORD);
  await expect(bobPage).toHaveURL(`${WEB_URL}/invitations/accept`);
  await rememberSessionSecrets(bobPage);
  await expect(bobPage.getByText('Client Team Member')).toBeVisible();
  await bobPage.getByRole('button', { name: 'Join workspace' }).click();
  await expect(bobPage).toHaveURL(`${WEB_URL}/workspaces/${alphaId}`);
  await expect(bobPage.getByText('Client Team Member')).toBeVisible();

  // Single use.
  await bobPage.goto(`/invitations/accept#token=${token}`);
  await expect(
    bobPage.getByRole('heading', {
      name: 'This invitation is invalid or has expired',
    }),
  ).toBeVisible();
});

test('a team member sees the team but cannot change it', async ({
  browser,
}) => {
  const page = await browserOf(browser, bob);
  await page.goto(`/workspaces/${alphaId}/team`);
  await expect(
    page.getByText('Only admins can invite people or change roles.'),
  ).toBeVisible();
  await expect(page.getByTestId(`member-${alice.email}`)).toContainText(
    'Client Admin',
  );
  await expect(
    page.getByRole('heading', { name: 'Invite someone' }),
  ).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /^Role of/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Revoke/ })).toHaveCount(0);

  // The API refuses it as well, with a valid session and CSRF token.
  const session = (await (
    await page.request.get('/api/auth/session')
  ).json()) as {
    csrfToken: string;
  };
  const refused = await page.request.post(
    `/api/workspaces/${alphaId}/invitations`,
    {
      data: {
        email: `mallory.${run}@example.test`,
        roleId: crypto.randomUUID(),
      },
      headers: { origin: WEB_URL, 'x-csrf-token': session.csrfToken },
    },
  );
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: 'forbidden' } });

  // The platform console is not for members.
  await page.goto('/platform');
  await page
    .getByLabel('Reason for this access')
    .fill('Curious about the console');
  await page.getByRole('button', { name: 'Open console' }).click();
  await expect(
    page.getByRole('heading', { name: 'Platform admins only' }),
  ).toBeVisible();
});

test('switching workspaces; other workspaces stay closed', async ({
  browser,
}) => {
  const carolPage = await browserOf(browser, carol);
  await carolPage.goto('/workspaces');
  await carolPage.getByLabel('Workspace name').fill(betaName);
  await carolPage.getByRole('button', { name: 'Create workspace' }).click();
  await expect(
    carolPage.getByRole('heading', { name: betaName }),
  ).toBeVisible();
  betaId = workspaceIdOf(carolPage);

  const token = await db.issueInvitation({
    workspaceId: betaId,
    email: alice.email,
    roleKey: 'client_admin',
  });
  secrets.add(token);
  const alicePage = await browserOf(browser, alice);
  await acceptInvitation(alicePage, token, betaName);
  expect(workspaceIdOf(alicePage)).toBe(betaId);

  // The switcher keeps the page and changes the workspace.
  await alicePage.goto(`/workspaces/${alphaId}/team`);
  await expect(alicePage.getByTestId(`member-${bob.email}`)).toBeVisible();
  await alicePage.getByLabel('Workspace', { exact: true }).selectOption({
    label: betaName,
  });
  await expect(alicePage).toHaveURL(`${WEB_URL}/workspaces/${betaId}/team`);
  await expect(alicePage.getByTestId(`member-${carol.email}`)).toBeVisible();
  await expect(alicePage.getByTestId(`member-${bob.email}`)).toHaveCount(0);

  // Bob is not a member of Beta: unknown and foreign workspaces look the same.
  const bobPage = await browserOf(browser, bob);
  for (const path of [
    `/workspaces/${betaId}`,
    `/workspaces/${betaId}/team`,
    '/workspaces/not-a-workspace',
  ]) {
    await bobPage.goto(path);
    await expect(
      bobPage.getByRole('heading', { name: 'Workspace not found' }),
    ).toBeVisible();
  }
  await bobPage.goto('/workspaces');
  const list = bobPage.getByRole('list', { name: 'Workspaces' });
  await expect(
    list.getByRole('link', { name: new RegExp(alphaName) }),
  ).toBeVisible();
  await expect(
    list.getByRole('link', { name: new RegExp(betaName) }),
  ).toHaveCount(0);
});

test('admins change roles, and a workspace always keeps an admin', async ({
  browser,
}) => {
  const page = await browserOf(browser, alice);
  await page.goto(`/workspaces/${alphaId}/team`);
  await page
    .getByRole('combobox', { name: `Role of ${alice.email}` })
    .selectOption({ label: 'Client Team Member' });
  await expect(
    page.getByText('A workspace needs at least one admin.', { exact: false }),
  ).toBeVisible();

  await page
    .getByRole('combobox', { name: `Role of ${bob.email}` })
    .selectOption({ label: 'Client Admin' });
  await expect(
    page.getByText(`${bob.name} is now Client Admin.`),
  ).toBeVisible();
  const bobPage = await browserOf(browser, bob);
  await bobPage.goto(`/workspaces/${alphaId}/team`);
  await expect(
    bobPage.getByRole('heading', { name: 'Invite someone' }),
  ).toBeVisible();

  await page
    .getByRole('combobox', { name: `Role of ${bob.email}` })
    .selectOption({ label: 'Client Team Member' });
  await expect(
    page.getByText(`${bob.name} is now Client Team Member.`),
  ).toBeVisible();
});

test('expired and revoked invitations are refused', async ({
  browser,
  request,
}) => {
  await registerVerified(request, erin);
  const expired = await db.issueInvitation({
    workspaceId: betaId,
    email: erin.email,
    roleKey: 'client_member',
    expired: true,
  });
  secrets.add(expired);
  const erinPage = await browserOf(browser, erin);
  await signIn(erinPage, erin);
  await erinPage.goto(`/invitations/accept#token=${expired}`);
  await expect(
    erinPage.getByRole('heading', {
      name: 'This invitation is invalid or has expired',
    }),
  ).toBeVisible();

  const revoked = await db.issueInvitation({
    workspaceId: betaId,
    email: erin.email,
    roleKey: 'client_member',
  });
  secrets.add(revoked);
  const carolPage = await browserOf(browser, carol);
  await carolPage.goto(`/workspaces/${betaId}/team`);
  await carolPage
    .getByRole('button', { name: `Revoke the invitation for ${erin.email}` })
    .click();
  await expect(carolPage.getByTestId(`invitation-${erin.email}`)).toHaveCount(
    0,
  );
  await erinPage.goto(`/invitations/accept#token=${revoked}`);
  await expect(
    erinPage.getByRole('heading', {
      name: 'This invitation is invalid or has expired',
    }),
  ).toBeVisible();
  await erinPage.goto('/workspaces');
  await expect(
    erinPage.getByText('You are not a member of any workspace yet.'),
  ).toBeVisible();
});

test('signed-out visitors sign in and return; redirects stay in the app', async ({
  browser,
}) => {
  const page = await freshBrowser(browser);
  await page.goto(`/workspaces/${alphaId}/team`);
  await expect(page).toHaveURL(
    `${WEB_URL}/login?next=${encodeURIComponent(`/workspaces/${alphaId}/team`)}`,
  );
  await fillSignIn(page, bob, PASSWORD);
  await expect(page).toHaveURL(`${WEB_URL}/workspaces/${alphaId}/team`);
  await rememberSessionSecrets(page);

  for (const next of [
    'https://evil.example/',
    '//evil.example/x',
    '/\\evil.example',
  ]) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(`${WEB_URL}/workspaces`);
  }
});

test('a platform admin acts only through the console, with a reason', async ({
  browser,
  request,
}) => {
  await registerVerified(request, pat);
  await db.makePlatformAdmin(pat.email);
  const page = await browserOf(browser, pat);
  await signIn(page, pat);

  // No implicit member access.
  await page.goto(`/workspaces/${alphaId}`);
  await expect(
    page.getByRole('heading', { name: 'Workspace not found' }),
  ).toBeVisible();

  await page.goto('/platform');
  await page.getByRole('button', { name: 'Open console' }).click();
  await expect(
    page.getByText('State the reason in at least 10 characters.'),
  ).toBeVisible();
  await page
    .getByLabel('Reason for this access')
    .fill(`E2E ${run}: checking workspace suspension`);
  await page.getByRole('button', { name: 'Open console' }).click();
  const beta = page.getByRole('row', { name: new RegExp(betaName) });
  const alpha = page.getByRole('row', { name: new RegExp(alphaName) });
  await expect(beta).toBeVisible();

  await alpha.getByRole('button', { name: 'Count members' }).click();
  await expect(
    alpha.getByRole('cell', { name: '2', exact: true }),
  ).toBeVisible();

  await beta.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByText(`${betaName} is now suspended.`)).toBeVisible();
  const carolPage = await browserOf(browser, carol);
  await carolPage.goto(`/workspaces/${betaId}`);
  await expect(
    carolPage.getByRole('heading', { name: 'Workspace not found' }),
  ).toBeVisible();

  await beta.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByText(`${betaName} is now active.`)).toBeVisible();
  await carolPage.goto(`/workspaces/${betaId}`);
  await expect(
    carolPage.getByRole('heading', { name: betaName }),
  ).toBeVisible();

  expect(await db.securityActions(pat.email)).toEqual(
    expect.arrayContaining([
      'platform_admin.console_opened',
      'tenant.status_changed',
    ]),
  );
});

test('a password reset ends every session; signing out works', async ({
  browser,
}) => {
  const bobPage = await browserOf(browser, bob);
  const otherPage = await freshBrowser(browser);
  await signIn(otherPage, bob);

  await bobPage.goto('/forgot-password');
  await bobPage.getByLabel('Email').fill(bob.email);
  await bobPage.getByRole('button', { name: 'Send the link' }).click();
  await expect(
    bobPage.getByRole('heading', { name: 'Check your inbox' }),
  ).toBeVisible();
  const token = await db.issueToken(bob.email, 'PASSWORD_RESET');
  secrets.add(token);

  await bobPage.goto(`/reset-password#token=${token}`);
  await expect(bobPage).toHaveURL(`${WEB_URL}/reset-password`);
  await bobPage.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await bobPage.getByLabel('Confirm new password').fill(PASSWORD);
  await bobPage.getByRole('button', { name: 'Set new password' }).click();
  await expect(bobPage.getByText('The passwords do not match.')).toBeVisible();
  await bobPage.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await bobPage.getByRole('button', { name: 'Set new password' }).click();
  await expect(
    bobPage.getByRole('heading', { name: 'Password changed' }),
  ).toBeVisible();

  // The other browser's session ended with the reset.
  await otherPage.goto('/workspaces');
  await expect(otherPage).toHaveURL(/\/login\?next=%2Fworkspaces/);
  await fillSignIn(otherPage, bob, PASSWORD);
  await expect(
    otherPage.getByText('The email address or password is incorrect.'),
  ).toBeVisible();
  await fillSignIn(otherPage, bob, NEW_PASSWORD);
  await expect(otherPage).toHaveURL(`${WEB_URL}/workspaces`);
  await rememberSessionSecrets(otherPage);

  await otherPage.getByRole('button', { name: 'Sign out' }).click();
  await expect(otherPage).toHaveURL(`${WEB_URL}/login`);
  await otherPage.goto('/workspaces');
  await expect(otherPage).toHaveURL(/\/login\?next=%2Fworkspaces/);
});

test('audit records cover membership and security changes, without secrets', async () => {
  expect(await db.workspaceAuditActions(alphaId)).toEqual(
    expect.arrayContaining([
      'workspace.created',
      'invitation.created',
      'invitation.revoked',
      'invitation.accepted',
      'membership.role_changed',
    ]),
  );
  expect(await db.securityActions(bob.email)).toEqual(
    expect.arrayContaining([
      'user.registered',
      'user.email_verified',
      'user.signed_in',
      'user.sign_in_failed',
      'user.password_reset_requested',
      'user.password_reset',
      'user.signed_out',
    ]),
  );
  const stored = await db.allAuditText();
  for (const secret of secrets) {
    expect(stored.includes(secret), 'a secret is in the audit records').toBe(
      false,
    );
  }
});

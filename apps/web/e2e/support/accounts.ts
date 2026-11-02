// Accounts and API calls for browser scenarios. Registration goes through the real API; the
// scenario's database access stands in for the inbox (E2eDatabase.issueToken).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { E2eDatabase } from './db';
import { WEB_URL } from './env';

export interface Person {
  readonly email: string;
  readonly name: string;
}

export const person = (key: string, name: string, run: string): Person => ({
  email: `${key}.${run}@example.test`,
  name,
});

/** Registers and confirms an account through the API. */
export async function registerVerified(
  request: APIRequestContext,
  db: E2eDatabase,
  who: Person,
  password: string,
  secrets?: Set<string>,
): Promise<void> {
  const headers = { origin: WEB_URL };
  const registered = await request.post('/api/auth/register', {
    data: { email: who.email, password, displayName: who.name },
    headers,
  });
  expect(registered.status()).toBe(202);
  const token = await db.issueToken(who.email, 'EMAIL_VERIFICATION');
  secrets?.add(token);
  const verified = await request.post('/api/auth/verify-email', {
    data: { token },
    headers,
  });
  expect(verified.status()).toBe(200);
}

export async function fillSignIn(page: Page, who: Person, password: string) {
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Signs in through the sign-in screen; the browser lands on the workspace list. */
export async function signIn(page: Page, who: Person, password: string) {
  await page.goto('/login');
  await fillSignIn(page, who, password);
  await expect(page).toHaveURL(`${WEB_URL}/workspaces`);
}

/** The session's CSRF token, as the browser reads it. */
export async function csrfTokenOf(page: Page): Promise<string> {
  const response = await page.request.get('/api/auth/session');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  return body.csrfToken;
}

/** A state-changing API call from the page's session (same origin, CSRF token). */
export async function apiMutation(
  page: Page,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
) {
  return page.request.fetch(`/api${path}`, {
    method,
    headers: { origin: WEB_URL, 'x-csrf-token': await csrfTokenOf(page) },
    ...(data === undefined ? {} : { data }),
  });
}

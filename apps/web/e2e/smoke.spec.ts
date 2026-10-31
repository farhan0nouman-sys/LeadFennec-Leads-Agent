import { expect, test } from '@playwright/test';

test('home page renders', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Lead Fennec AI');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lead Fennec AI' }),
  ).toBeVisible();
});

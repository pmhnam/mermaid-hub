import { expect, test } from '@playwright/test';

test('guests can find sign in from the editor', async ({ page }) => {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 401, body: JSON.stringify({ message: 'Unauthorized' }) })
  );
  await page.goto('/edit');

  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open main menu' }).click();
  await expect(page.getByRole('link', { name: 'Sign in to workspace' })).toHaveAttribute(
    'href',
    '/login'
  );
});

test('signed-in account is visible on mobile and can sign out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'test-token',
        user: { id: 'user-1', displayName: 'Alex Diagram', email: 'alex@example.test' }
      }
    })
  );
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204 }));
  await page.goto('/edit');

  await page.getByRole('button', { name: 'Account: Alex Diagram' }).click();
  await expect(page.getByText('alex@example.test')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open workspace' })).toHaveAttribute(
    'href',
    '/login'
  );
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
});

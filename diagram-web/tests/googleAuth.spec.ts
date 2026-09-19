import { expect, test } from './test';

test.describe('Google sign-in UI', () => {
  test('fits the Google sign-in control on mobile', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/auth/providers', (route) => route.fulfill({ json: { google: true } }));
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('google-login-mobile.png')
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
  });
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/refresh', (route) =>
      route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
    );
  });

  test('offers Google on login and registration only when configured', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({ json: { google: true } }));
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await page.goto('/register');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await page.route('**/api/auth/providers', (route) =>
      route.fulfill({ json: { google: false } })
    );
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  });

  test('starts the backend flow and preserves the original destination', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({ json: { google: true } }));
    await page.route('**/api/auth/google', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>Google redirect endpoint</p>' })
    );
    await page.goto('/login?redirect=%2Fworkspace%2Fworkspace-1');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page).toHaveURL(/\/api\/auth\/google$/);
    expect(await page.evaluate(() => sessionStorage.getItem('google-login-redirect'))).toBe(
      '/workspace/workspace-1'
    );
  });

  test('shows a retryable error after cancelled consent', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({ json: { google: true } }));
    await page.goto('/login?google=cancelled');
    await expect(page.getByRole('alert')).toContainText('cancelled');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  });

  test('restores the application session after the Google callback', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({ json: { google: true } }));
    await page.route('**/api/auth/refresh', (route) =>
      route.fulfill({
        json: {
          accessToken: 'test-access',
          user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' }
        }
      })
    );
    await page.route('**/api/workspaces', (route) =>
      route.fulfill({ json: [{ id: 'workspace-1', name: 'Personal', role: 'owner' }] })
    );
    await page.route('**/api/workspaces/workspace-1/tree', (route) =>
      route.fulfill({ json: { folders: [], diagrams: [] } })
    );
    await page.goto('/login?google=success');
    await expect(page).toHaveURL(/\/workspace\/workspace-1$/);
  });
});

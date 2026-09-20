import { expect, test } from '@playwright/test';
import { postgresDdl } from '$/sql/fixtures';

test('imports SQL as a saved workspace diagram and preserves metadata after reload', async ({
  page
}) => {
  const registration = await page.request.post('/api/auth/register', {
    data: {
      displayName: 'SQL Owner',
      email: `sql-${Date.now()}@example.test`,
      password: 'playwright-password-123'
    }
  });
  expect(registration.ok()).toBe(true);
  const session = await registration.json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const workspaces = await (await page.request.get('/api/workspaces', { headers })).json();
  await page.goto(`/workspace/${workspaces[0].id}`);
  await page.getByRole('button', { name: 'Import SQL', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Diagram name').fill('Imported catalog');
  await dialog.getByLabel('SQL DDL').fill(postgresDdl);
  await dialog.getByRole('button', { name: 'Preview schema', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'SQL import preview' })).toContainText(
    '2 tables'
  );
  await dialog.getByRole('button', { name: 'Create ER diagram', exact: true }).click();
  await expect(page).toHaveURL(/\/diagram\/[\da-f-]+$/);
  await expect(page.getByText('Live and synchronized', { exact: true })).toBeVisible();
  await expect(page.locator('#container svg.erDiagram')).toContainText('catalog.products');
  await page.reload();
  await expect(page.getByText('Live and synchronized', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await dialog
    .locator('label')
    .filter({ has: page.locator('input[value="sql"]') })
    .click();
  await expect(dialog.getByLabel('SQL preview')).toHaveValue(
    /FOREIGN KEY \("tenant_id", "product_id"\)/
  );
  await expect(dialog.getByLabel('SQL preview')).toHaveValue(/Display name/);
});

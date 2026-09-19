import { expect, test } from '@playwright/test';

test('preserves the rendered canvas on editor toggle and supports themes, versions and comments', async ({
  page
}, testInfo) => {
  const registration = await page.request.post('/api/auth/register', {
    data: {
      displayName: 'Canvas Owner',
      email: `canvas-${Date.now()}@example.test`,
      password: 'playwright-password-123'
    }
  });
  expect(registration.ok()).toBe(true);
  const session = await registration.json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const workspaces = await (await page.request.get('/api/workspaces', { headers })).json();
  const workspaceId = workspaces[0].id;
  const response = await page.request.post(`/api/workspaces/${workspaceId}/diagrams`, {
    headers,
    data: {
      title: 'Canvas review',
      currentConfig: '{}',
      currentContent:
        'erDiagram\nPRODUCT {\n UUID id PK\n TEXT sku\n}\nPRODUCT ||--o{ VARIANT : contains'
    }
  });
  expect(response.ok()).toBe(true);
  const diagram = await response.json();
  await page.goto(`/workspace/${workspaceId}/diagram/${diagram.id}`);
  await expect(page.getByText('Live and synchronized', { exact: true })).toBeVisible();
  const svg = page.locator('#container svg.erDiagram');
  await expect(svg).toBeVisible();
  await page.getByTitle('Zoom in', { exact: true }).click();
  const id = await svg.getAttribute('id');
  const transform = await svg.locator('.svg-pan-zoom_viewport').getAttribute('transform');
  await page.getByRole('button', { name: 'Hide code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit code', exact: true })).toBeVisible();
  await expect(svg).toHaveAttribute('id', id ?? '');
  await expect(svg.locator('.svg-pan-zoom_viewport')).toHaveAttribute('transform', transform ?? '');
  await page.getByRole('button', { name: 'Edit code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hide code', exact: true })).toBeVisible();
  await expect(svg).toHaveAttribute('id', id ?? '');
  await expect(svg.locator('.svg-pan-zoom_viewport')).toHaveAttribute('transform', transform ?? '');

  await page.getByLabel('Appearance', { exact: true }).last().selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Public link', { exact: true })).toBeVisible();
  const darkColor = await dialog
    .locator('section')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('share-dark.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Appearance', { exact: true }).last().selectOption('light');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  expect(
    await dialog
      .locator('section')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
  ).not.toBe(darkColor);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('share-light.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  await page.getByLabel('Version note', { exact: true }).fill('Canvas checkpoint');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.getByRole('button', { name: /Canvas checkpoint/ }).click();
  await expect(dialog.getByText(/Version \d+ preview and diff/)).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('versions.png') });
  await dialog.getByRole('button', { name: 'Diagram preview', exact: true }).click();
  await expect(dialog.locator('#embed-container svg')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(svg).toHaveAttribute('id', id ?? '');

  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await dialog.getByLabel('Comment', { exact: true }).fill('Please review the SKU key.');
  await dialog.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(dialog.getByText('Please review the SKU key.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(dialog.getByText('Please review the SKU key.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(dialog.getByText('Please review the SKU key.', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Show resolved').check();
  await dialog.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await expect(dialog.getByText('Please review the SKU key.', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Appearance', { exact: true }).last().selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText('Live and synchronized', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(svg.locator('.svg-pan-zoom_viewport')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom options' })).not.toHaveText('0%');
  const mobileId = await svg.getAttribute('id');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(svg).toHaveAttribute('id', mobileId ?? '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

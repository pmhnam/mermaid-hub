import { expect, test } from '@playwright/test';

test('resizes the editor and aligns the collapsed sidebar and preview toolbar', async ({
  page
}, testInfo) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  const registration = await page.request.post('/api/auth/register', {
    data: {
      displayName: 'Layout owner',
      email: `layout-${Date.now()}@example.test`,
      password: 'playwright-password-123'
    }
  });
  expect(registration.ok()).toBe(true);
  const session = await registration.json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const workspaces = await (await page.request.get('/api/workspaces', { headers })).json();
  const workspaceId = workspaces[0].id;
  const root = await (
    await page.request.post(`/api/workspaces/${workspaceId}/folders`, {
      headers,
      data: { name: 'Schema' }
    })
  ).json();
  const child = await (
    await page.request.post(`/api/workspaces/${workspaceId}/folders`, {
      headers,
      data: { name: 'Catalog', parentId: root.id }
    })
  ).json();
  const source =
    '---\nconfig:\n  layout: elk\n  theme: default\n---\nerDiagram\n"catalog.PRODUCTS" {\n UUID id PK\n TEXT name\n}\n"catalog.PRODUCTS" ||--o{ VARIANT : contains';
  const response = await page.request.post(`/api/workspaces/${workspaceId}/diagrams`, {
    headers,
    data: {
      title: 'Editor layout regression',
      folderId: child.id,
      currentContent: source,
      currentConfig: '{}'
    }
  });
  expect(response.ok()).toBe(true);
  const diagram = await response.json();
  await page.goto(`/workspace/${workspaceId}/diagram/${diagram.id}`);
  await expect(page.getByText('Live and synchronized', { exact: true })).toBeVisible({
    timeout: 30000
  });
  await page.getByLabel('Appearance', { exact: true }).last().selectOption('light');
  const svg = page.locator('#container svg.erDiagram');
  await expect(svg).toBeVisible();
  await page.getByTitle('Zoom in', { exact: true }).click();
  const id = await svg.getAttribute('id');
  const transform = await svg.locator('.svg-pan-zoom_viewport').getAttribute('transform');
  const editor = page.getByTestId('product-editor');
  const width = () => editor.evaluate((element) => element.getBoundingClientRect().width);
  const initial = await width();
  const resizer = page.getByRole('separator').filter({ has: page.locator('svg') });
  const handle = await resizer.boundingBox();
  if (!handle) throw new Error('Missing resize handle');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 110, handle.y + handle.height / 2, {
    steps: 12
  });
  await page.mouse.up();
  await expect.poll(width).toBeGreaterThan(initial + 70);
  const resized = await width();
  await expect(svg).toHaveAttribute('id', id ?? '');
  await expect(svg.locator('.svg-pan-zoom_viewport')).toHaveAttribute('transform', transform ?? '');
  await page.getByRole('button', { name: 'Hide code', exact: true }).click();
  await page.getByRole('button', { name: 'Edit code', exact: true }).click();
  await expect.poll(width).toBeCloseTo(resized, 0);
  await expect(svg).toHaveAttribute('id', id ?? '');

  const row = svg.locator('[id*="entity-catalog.PRODUCTS-"] .row-rect-odd').first();
  const brightness = () =>
    row.evaluate((element) => {
      const shape = element.matches('rect, path, polygon')
        ? element
        : element.querySelector('rect, path, polygon');
      if (!shape) throw new Error('Missing row background');
      const rgb =
        getComputedStyle(shape)
          .fill.match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      return rgb.reduce((total, value) => total + value, 0) / 3;
    });
  await expect.poll(brightness).toBeGreaterThan(180);
  const zoomBeforeTheme = await page.getByRole('button', { name: 'Zoom options' }).textContent();
  await page.getByLabel('Appearance', { exact: true }).last().selectOption('dark');
  await expect.poll(brightness).toBeLessThan(120);
  await expect(page.getByRole('button', { name: 'Zoom options' })).toHaveText(
    zoomBeforeTheme ?? ''
  );
  await expect(svg).toContainText('catalog.PRODUCTS');
  const saved = await (await page.request.get(`/api/diagrams/${diagram.id}`, { headers })).json();
  expect(saved.currentContent).toBe(source);
  expect(saved.currentConfig).toBe('{}');
  await page.getByRole('button', { name: 'Collapse workspace navigation' }).click();
  const sidebar = page.getByRole('complementary');
  await expect
    .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width))
    .toBe(64);
  const sidebarBox = await sidebar.boundingBox();
  if (!sidebarBox) throw new Error('Missing sidebar');
  for (const control of [
    sidebar.getByRole('button', { name: 'Appearance', exact: true }),
    sidebar.getByRole('link', { name: 'Editor layout regression', exact: true }).locator('svg'),
    sidebar.getByRole('button', { name: 'Expand workspace navigation', exact: true })
  ]) {
    const box = await control.boundingBox();
    if (!box) throw new Error('Missing sidebar control');
    expect(Math.abs(box.x + box.width / 2 - sidebarBox.x - sidebarBox.width / 2)).toBeLessThan(2);
    expect(box.x + box.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
  }
  const toolbar = page.getByTestId('preview-toolbar');
  const layoutBox = await toolbar.getByRole('button', { name: 'Choose layout' }).boundingBox();
  const zoomBox = await toolbar.getByRole('button', { name: 'Zoom options' }).boundingBox();
  const fullBox = await toolbar
    .getByRole('button', { name: 'Full screen', exact: true })
    .boundingBox();
  if (!layoutBox || !zoomBox || !fullBox) throw new Error('Missing toolbar control');
  expect(
    Math.abs(layoutBox.y + layoutBox.height / 2 - zoomBox.y - zoomBox.height / 2)
  ).toBeLessThan(1);
  expect(
    Math.abs(layoutBox.y + layoutBox.height / 2 - fullBox.y - fullBox.height / 2)
  ).toBeLessThan(1);
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('aligned-dark-workspace.png')
  });
  await sidebar.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect.poll(brightness).toBeGreaterThan(180);
  await expect(page.getByRole('button', { name: 'Zoom options' })).toHaveText(
    zoomBeforeTheme ?? ''
  );
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('aligned-light-workspace.png')
  });
});

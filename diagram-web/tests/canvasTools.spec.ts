import { defaultState } from '$/constants';
import { serializeState } from '$/util/serde';
import { expect, test } from './test';

const code =
  'erDiagram\nPRODUCT {\n UUID id PK\n TEXT sku\n}\nPRODUCT ||--o{ VARIANT : contains\nVARIANT ||--o{ IMAGE : has\nUNRELATED {\n UUID id PK\n}';
const url = `/edit#${serializeState({ ...defaultState, code })}`;

test('finds fields, focuses neighbors, fits and navigates the minimap', async ({ page }) => {
  await page.goto(url);
  const svg = page.locator('#container svg.erDiagram');
  await expect(svg).toBeVisible();
  await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
  await page.getByLabel('Search diagram or command').fill('sku');
  await page.getByRole('button', { name: 'Find TEXT sku', exact: true }).click();
  await expect(svg.locator('.attribute-name.canvas-selected')).toContainText('sku');
  await page.getByRole('button', { name: 'Close canvas panel' }).click();
  await page.getByRole('button', { name: 'Related', exact: true }).click();
  await expect(svg.locator('[data-visual-node="UNRELATED"]')).toHaveClass(/canvas-dimmed/);
  await expect(svg.locator('[data-visual-node="VARIANT"]')).not.toHaveClass(/canvas-dimmed/);
  await expect(svg.locator('[data-visual-node="IMAGE"]')).toHaveClass(/canvas-dimmed/);
  await page.getByRole('button', { name: '2 levels' }).click();
  await expect(svg.locator('[data-visual-node="IMAGE"]')).not.toHaveClass(/canvas-dimmed/);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(svg.locator('.canvas-dimmed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zoom options' }).click();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zoom options' })).toHaveText('100%');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Minimap/ }).click();
  const viewport = svg.locator('.svg-pan-zoom_viewport');
  const before = await viewport.getAttribute('transform');
  await page
    .getByRole('img', { name: 'Diagram minimap; click to navigate' })
    .click({ position: { x: 20, y: 20 } });
  await expect(viewport).not.toHaveAttribute('transform', before ?? '');
});

test('multi-selects, aligns, undoes group movement and edits validated properties', async ({
  page
}) => {
  await page.goto(url);
  const svg = page.locator('#container svg.erDiagram');
  const product = svg.locator('[data-visual-node="PRODUCT"]');
  const variant = svg.locator('[data-visual-node="VARIANT"]');
  await expect(product).toBeVisible();
  await product.locator('.name').click();
  await variant
    .locator('.label')
    .first()
    .click({ modifiers: ['Shift'] });
  await expect(page.getByText('2 nodes selected', { exact: true })).toBeVisible();
  const original = await variant.getAttribute('transform');
  await page.getByRole('button', { name: 'Align left', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo layout', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await expect(variant).toHaveAttribute('transform', original ?? '');
  await page.getByRole('button', { name: 'Redo layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo layout', exact: true })).toBeEnabled();
  const positions = () =>
    svg.locator('[data-visual-node="PRODUCT"], [data-visual-node="VARIANT"]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const matrix = (node as SVGGraphicsElement).transform.baseVal.consolidate()?.matrix;
        if (!matrix) throw new Error('Missing node transform');
        return { x: matrix.e, y: matrix.f };
      })
    );
  const beforeGroup = await positions();
  await page.getByRole('button', { name: 'Snap', exact: true }).click();
  const box = await product.locator('.name').boundingBox();
  if (!box) throw new Error('Missing drag target');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 25, { steps: 10 });
  await page.mouse.up();
  await expect.poll(positions).not.toEqual(beforeGroup);
  const afterGroup = await positions();
  expect(afterGroup[0].x - beforeGroup[0].x).toBeCloseTo(afterGroup[1].x - beforeGroup[1].x, 3);
  expect(afterGroup[0].y - beforeGroup[0].y).toBeCloseTo(afterGroup[1].y - beforeGroup[1].y, 3);
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await expect.poll(positions).toEqual(beforeGroup);
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await product.locator('.name').click();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByLabel('Entity name').fill('CATALOG');
  await page.getByRole('button', { name: 'Rename entity' }).click();
  await expect(svg.locator('[data-visual-node="CATALOG"]')).toBeVisible();
  await expect(svg.locator('[data-visual-node="PRODUCT"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await expect(product).toBeVisible();
  await page.getByRole('button', { name: 'Redo layout', exact: true }).click();
  await expect(svg.locator('[data-visual-node="CATALOG"]')).toBeVisible();
  await page.getByRole('button', { name: 'Color by schema', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('codeStore') ?? '{}').code))
    .toContain('style CATALOG');
  await page.getByLabel('Diagram theme').selectOption('forest');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(JSON.parse(localStorage.getItem('codeStore') ?? '{}').mermaid).theme
      )
    )
    .toBe('forest');
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search diagram or command').fill('Fit all');
  await page.getByRole('button', { name: 'Fit all', exact: true }).click();
  await page.getByRole('button', { name: 'Choose layout', exact: true }).click();
  await page.getByRole('button', { name: /Adaptive/ }).click();
  await expect(page.getByRole('button', { name: 'Choose layout' })).toContainText('Adaptive');
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose layout' })).toContainText('Hierarchical');
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit presentation' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit presentation' }).click();
});

test('selecting a source line highlights the corresponding field without rerendering', async ({
  page
}) => {
  await page.goto(url);
  const svg = page.locator('#container svg.erDiagram');
  await expect(svg).toBeVisible();
  const id = await svg.getAttribute('id');
  await page.locator('.monaco-editor').click({ position: { x: 150, y: 50 } });
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(svg.locator('.attribute-name.canvas-selected')).toContainText('sku');
  await expect(svg).toHaveAttribute('id', id ?? '');
});

test('keeps search and controls within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(page.locator('#container svg.erDiagram')).toBeVisible();
  await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
  await page.getByLabel('Search diagram or command').fill('sku');
  await expect(page.getByRole('button', { name: 'Find TEXT sku', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

import { defaultState } from '$/constants';
import { serializeState } from '$/util/serde';
import { expect, test } from './test';

const code =
  'erDiagram\n"billing.users" {\n UUID id PK\n}\n"identity.users" {\n UUID id PK\n}\n"billing.users" ||--o{ "identity.users" : references\nAUDIT';
const url = `/edit#${serializeState({ ...defaultState, code })}`;

test('previews, cancels, applies and restores grouped ER layout without changing source', async ({
  page
}) => {
  await page.goto(url);
  const svg = page.locator('#container svg.erDiagram');
  await expect(svg).toBeVisible();
  const original = await svg
    .locator('[data-visual-node="billing.users"]')
    .getAttribute('transform');
  expect(original).not.toBeNull();
  const originalTransform = original ?? '';
  await page.getByRole('button', { name: 'AI Arrange', exact: true }).click();
  await page.getByLabel('Service for billing.users', { exact: true }).fill('Billing');
  await page.getByLabel('Database for billing.users', { exact: true }).fill('billing');
  await page.getByLabel('Service for identity.users', { exact: true }).fill('Identity');
  await page.getByLabel('Database for identity.users', { exact: true }).fill('identity');
  await page.getByRole('button', { name: 'Preview layout', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Proposed table positions' })).toBeVisible();
  await expect(svg.locator('[data-arrange-groups]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Arrange' }).click();
  await expect(svg.locator('[data-visual-node="billing.users"]')).toHaveAttribute(
    'transform',
    originalTransform
  );

  await page.getByRole('button', { name: 'AI Arrange', exact: true }).click();
  await page.getByLabel('Service for billing.users', { exact: true }).fill('Billing');
  await page.getByLabel('Database for billing.users', { exact: true }).fill('billing');
  await page.getByRole('button', { name: 'Preview layout', exact: true }).click();
  await page.getByRole('button', { name: 'Apply arrangement', exact: true }).click();
  await expect(svg.locator('[data-arrange-groups] text')).toContainText([
    'Billing / billing',
    'Unclassified / Unclassified'
  ]);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('codeStore') ?? '{}').code))
    .toBe(code);
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await expect(svg.locator('[data-arrange-groups]')).toHaveCount(0);
  await expect(svg.locator('[data-visual-node="billing.users"]')).toHaveAttribute(
    'transform',
    originalTransform
  );
  await page.getByRole('button', { name: 'Redo layout', exact: true }).click();
  await expect(svg.locator('[data-arrange-groups]')).toHaveCount(1);
  await page.reload();
  await expect(svg.locator('[data-arrange-groups]')).toHaveCount(1);
  await page.getByRole('button', { name: 'AI Arrange', exact: true }).click();
  await expect(page.getByLabel('Service for billing.users', { exact: true })).toHaveValue(
    'Billing'
  );
});

test('rejects a stale preview after another layout change', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'AI Arrange', exact: true }).click();
  await page.getByRole('button', { name: 'Preview layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply arrangement', exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('mermaid-change-layout', { detail: 'elk', cancelable: true })
    )
  );
  await expect(page.getByRole('button', { name: 'Choose layout' })).toContainText('Adaptive');
  await page.getByRole('button', { name: 'Apply arrangement', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'The diagram or layout changed' })
  ).toBeVisible();
  await expect(page.locator('#container [data-arrange-groups]')).toHaveCount(0);
});

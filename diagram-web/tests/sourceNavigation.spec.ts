import { defaultState } from '$/constants';
import { serializeState } from '$/util/serde';
import { expect, test } from './test';

const erState = (code: string): string =>
  `/edit#${serializeState({
    ...defaultState,
    code,
    mermaid: JSON.stringify({ securityLevel: 'strict', theme: 'default' })
  })}`;

test.describe('Source navigation', () => {
  for (const engine of ['dagre', 'elk']) {
    test(`navigates quoted ER fields and repeated relationship text with ${engine}`, async ({
      page
    }) => {
      const code = [
        '---',
        'config:',
        `  layout: ${engine}`,
        '---',
        'erDiagram',
        '  "catalog.PRODUCTS" {',
        '    UUID id PK "Product identifier"',
        '    VARCHAR(255) product_name "Display name"',
        '  }',
        '  "catalog.VARIANTS" {',
        '    UUID id PK',
        '  }',
        '  "catalog.PRODUCTS" ||--o{ "catalog.VARIANTS" : contains',
        '  "catalog.PRODUCTS" ||--o{ "catalog.IMAGES" : contains'
      ].join('\n');
      await page.goto(erState(code));
      const svg = page.locator('#container svg');
      const entity = svg.locator('g[id*="entity-catalog.PRODUCTS-"]').first();
      await expect(entity).toBeVisible();
      for (const selector of [
        '.attribute-type',
        '.attribute-name',
        '.attribute-keys',
        '.attribute-comment',
        '.row-rect-odd'
      ]) {
        await entity.locator(selector).first().dblclick();
        await page.keyboard.press('Control+C');
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toBe('UUID id PK "Product identifier"');
      }
      await entity.locator('.attribute-name').nth(1).dblclick();
      await page.keyboard.press('Control+C');
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('VARCHAR(255) product_name "Display name"');
      for (let index = 0; index < 2; index++) {
        await svg.locator(`.edgeLabel .label[data-id$="_${index}"]`).dblclick();
        await page.keyboard.press('Control+C');
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toBe(
            code
              .split('\n')
              .at(index - 2)
              ?.trim()
          );
      }
      const before = await entity.getAttribute('transform');
      const edge = svg.locator('path[data-et="edge"][data-id$="_0"]');
      const edgeBefore = await edge.getAttribute('d');
      const header = entity.locator('.name');
      const box = await header.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('Missing entity drag target');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 10 });
      await page.mouse.up();
      await expect(entity).not.toHaveAttribute('transform', before ?? '');
      await expect(edge).not.toHaveAttribute('d', edgeBefore ?? '');
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem('codeStore') ?? '{}').visualLayout?.mode
          )
        )
        .toBe('manual');
      await page.reload();
      await expect(entity).toBeVisible();
      await expect(entity).not.toHaveAttribute('transform', before ?? '');
      await entity.locator('.attribute-name').nth(1).dblclick();
      await page.keyboard.press('Control+C');
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('VARCHAR(255) product_name "Display name"');
    });
  }

  test('switches the rendered ER layout despite a frontmatter override', async ({
    page
  }, testInfo) => {
    await page.goto(
      erState(
        '---\nconfig:\n  layout: elk\n---\nerDiagram\nA ||--o{ B : owns\nA ||--o{ C : owns\nB ||--o{ D : owns'
      )
    );
    const nodes = page.locator('#container svg .nodes > g');
    await expect(nodes).toHaveCount(4);
    const positions = () =>
      nodes.evaluateAll((elements) => elements.map((element) => element.getAttribute('transform')));
    const elk = await positions();
    await page.getByRole('button', { name: 'Choose layout' }).click();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('layout-desktop.png')
    });
    await page.getByRole('button', { name: /Hierarchical/ }).click();
    await expect.poll(positions).not.toEqual(elk);
    const dagre = await positions();
    await page.getByRole('button', { name: 'Choose layout' }).click();
    await page.getByRole('button', { name: /Adaptive/ }).click();
    await expect.poll(positions).not.toEqual(dagre);
  });

  test('keeps the layout picker usable on a narrow screen', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(erState('erDiagram\nPRODUCT ||--o{ IMAGE : contains'));
    await expect(page.locator('#container svg')).toContainText('PRODUCT');
    const button = page.getByRole('button', { name: 'Choose layout' });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole('button', { name: /Adaptive/ })).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('layout-mobile.png')
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
  });

  test('selects an ER field instead of its table', async ({ page }) => {
    const code = [
      'erDiagram',
      '  CUSTOMER {',
      '    UUID id PK',
      '    TEXT status',
      '  }',
      '  ORDER {',
      '    UUID id PK',
      '  }',
      '  CUSTOMER ||--o{ ORDER : places'
    ].join('\n');

    await page.goto(erState(code));
    const svg = page.locator('#container svg');
    await expect(svg).toBeVisible();
    await svg.locator('.attribute-name').nth(1).dblclick();
    await page.keyboard.press('Control+C');

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('TEXT status');
  });

  test('opens and selects the field in the mobile editor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      erState('erDiagram\r\n"catalog.PRODUCTS" {\r\n  UUID id PK\r\n  TEXT status\r\n}')
    );
    const field = page.locator('#container svg .attribute-name').nth(1);
    await expect(field).toBeVisible();
    await field.dblclick();
    await expect(page.locator('.cm-editor')).toBeVisible();
    await page.keyboard.press('Control+C');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('TEXT status');
  });
});

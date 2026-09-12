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
});

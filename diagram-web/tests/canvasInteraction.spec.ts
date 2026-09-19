import { defaultState } from '$/constants';
import { serializeState } from '$/util/serde';
import { expect, test } from './test';

for (const engine of ['dagre', 'elk']) {
  test(`zooms and Space-pans over entities with ${engine}`, async ({ page }, testInfo) => {
    await page.goto(
      `/edit#${serializeState({
        ...defaultState,
        code: `---\nconfig:\n  layout: ${engine}\n---\nerDiagram\nA ||--o{ B : owns\nA {\n UUID id PK\n}`
      })}`
    );
    const viewport = page.locator('#container svg.erDiagram .svg-pan-zoom_viewport');
    await expect(viewport).toBeVisible();
    const matrix = () =>
      viewport.evaluate((el) => {
        const m = (el as SVGGraphicsElement).transform.baseVal.consolidate()?.matrix;
        if (!m) throw new Error('No viewport transform');
        return { scale: m.a, x: m.e, y: m.f };
      });
    const initial = await matrix();
    await page.getByTitle('Zoom in', { exact: true }).click();
    await expect.poll(async () => (await matrix()).scale).toBeGreaterThan(initial.scale);
    await page.getByTitle('Zoom out', { exact: true }).click();
    await expect.poll(async () => (await matrix()).scale).toBeCloseTo(initial.scale);
    await viewport.hover();
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await matrix()).scale).toBeGreaterThan(initial.scale);
    await page.getByTitle('Reset view', { exact: true }).click();
    const entity = page.locator('#container [data-visual-node]').first();
    const before = await entity.getAttribute('transform');
    const box = await entity.boundingBox();
    if (!box) throw new Error('No entity');
    await page.mouse.move(box.x + box.width / 2, box.y + 15);
    await page.keyboard.down('Space');
    const start = await matrix();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + 55, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await expect.poll(async () => (await matrix()).x).toBeCloseTo(start.x + 70, 0);
    await expect.poll(async () => (await matrix()).y).toBeCloseTo(start.y + 40, 0);
    await expect(entity).toHaveAttribute('transform', before ?? '');

    // Releasing Space returns to node dragging without moving or resetting the viewport.
    const panned = await matrix();
    const renderedId = await page.locator('#container svg').getAttribute('id');
    const movedBox = await entity.boundingBox();
    if (!movedBox) throw new Error('No entity after pan');
    await page.mouse.move(movedBox.x + movedBox.width / 2, movedBox.y + 15);
    await page.mouse.down();
    await page.mouse.move(movedBox.x + movedBox.width / 2 + 100, movedBox.y + 65, { steps: 10 });
    await page.mouse.up();
    await expect(entity).not.toHaveAttribute('transform', before ?? '');
    await expect(page.locator('#container svg')).not.toHaveAttribute('id', renderedId ?? '');
    await expect.poll(async () => (await matrix()).scale).toBeCloseTo(panned.scale, 5);
    await expect.poll(async () => (await matrix()).x).toBeCloseTo(panned.x, 5);
    await expect.poll(async () => (await matrix()).y).toBeCloseTo(panned.y, 5);

    // Check rendered ports/labels, not just a changed path string.
    const checkGeometry = async () =>
      page.locator('#container svg').evaluate((svg) => {
        const path = svg.querySelector<SVGPathElement>('path[data-et="edge"]');
        const from = svg.querySelector<SVGGElement>('[data-visual-node="A"]');
        const to = svg.querySelector<SVGGElement>('[data-visual-node="B"]');
        const label = svg.querySelector<SVGGElement>('.edgeLabel');
        if (!path || !from || !to || !label) throw new Error('Missing relationship elements');
        const pathMatrix = path.getScreenCTM();
        const labelMatrix = label.getScreenCTM();
        if (!pathMatrix || !labelMatrix) throw new Error('Missing relationship transforms');
        const onBorder = (length: number, node: SVGGElement) => {
          const screen = path.getPointAtLength(length).matrixTransform(pathMatrix);
          const inverse = node.getScreenCTM()?.inverse();
          if (!inverse) return false;
          const p = screen.matrixTransform(inverse);
          const b = node.getBBox();
          const within =
            p.x >= b.x - 0.5 &&
            p.x <= b.x + b.width + 0.5 &&
            p.y >= b.y - 0.5 &&
            p.y <= b.y + b.height + 0.5;
          return (
            within &&
            Math.min(
              Math.abs(p.x - b.x),
              Math.abs(p.x - b.x - b.width),
              Math.abs(p.y - b.y),
              Math.abs(p.y - b.y - b.height)
            ) < 0.5
          );
        };
        const middle = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(pathMatrix);
        const text = new DOMPoint(0, 0).matrixTransform(labelMatrix);
        return {
          from: onBorder(0, from),
          to: onBorder(path.getTotalLength(), to),
          labelDistance: Math.hypot(middle.x - text.x, middle.y - text.y),
          rounded: path.getAttribute('d')?.includes('Q')
        };
      });
    await expect.poll(checkGeometry).toMatchObject({ from: true, to: true, rounded: true });
    expect((await checkGeometry()).labelDistance).toBeLessThan(1);
    await page.getByTitle('Zoom in', { exact: true }).click();
    await expect.poll(async () => (await matrix()).scale).toBeGreaterThan(panned.scale);
    const saved = await matrix();
    await page.screenshot({ path: testInfo.outputPath(`rerouted-${engine}.png`) });
    await page.reload();
    await expect(viewport).toBeVisible();
    await expect.poll(checkGeometry).toMatchObject({ from: true, to: true });
    await expect.poll(async () => (await matrix()).scale).toBeCloseTo(saved.scale, 5);
    const reloaded = await matrix();
    await viewport.hover();
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await matrix()).scale).toBeGreaterThan(reloaded.scale);

    // Space must remain an ordinary character inside the editor, and cannot get
    // stuck in pan mode after switching browser tabs.
    await page.locator('#container .attribute-name').dblclick();
    await page.keyboard.press('End');
    await page.keyboard.down('Space');
    await expect(page.locator('#container svg')).not.toHaveClass(/space-pan/);
    await page.keyboard.up('Space');
    await page.locator('#container svg').click({ position: { x: 5, y: 5 } });
    await page.keyboard.down('Space');
    await expect(page.locator('#container svg')).toHaveClass(/space-pan/);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('#container svg')).not.toHaveClass(/space-pan/);
    await page.keyboard.up('Space');
  });
}

test.describe('Touch canvas', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('pinches to zoom over an entity without dragging it', async ({ page, context }) => {
    await page.goto(
      `/edit#${serializeState({ ...defaultState, code: 'erDiagram\nA ||--o{ B : owns' })}`
    );
    const viewport = page.locator('#container svg.erDiagram .svg-pan-zoom_viewport');
    await expect(viewport).toBeVisible();
    const scale = () => viewport.evaluate((el) => (el as SVGGraphicsElement).getCTM()?.a ?? 0);
    const before = await scale();
    const entity = page.locator('#container [data-visual-node]').first();
    const original = await entity.getAttribute('transform');
    const box = await entity.boundingBox();
    if (!box) throw new Error('Missing touch target');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x - 10, y, id: 0 }]
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 10, y, id: 0 },
        { x: x + 10, y, id: 1 }
      ]
    });
    for (const distance of [20, 30, 40, 50]) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - distance, y, id: 0 },
          { x: x + distance, y, id: 1 }
        ]
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(scale).toBeGreaterThan(before);
    await expect(entity).toHaveAttribute('transform', original ?? '');
    await session.detach();
  });
});

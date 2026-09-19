import { defaultState } from '$/constants';
import { deserializeState, serializeState } from '$/util/serde';
import { expect, test } from './test';

for (const engine of ['dagre', 'elk']) {
  test(`bends relationships around an entity and persists routes with ${engine}`, async ({
    page
  }, testInfo) => {
    const code = `---\nconfig:\n  layout: ${engine}\n---\nerDiagram\nA {\n UUID id PK\n}\nB {\n UUID id PK\n}\nBLOCKER {\n TEXT description\n}\nA ||--o{ B : connects`;
    await page.goto(`/edit#${serializeState({ ...defaultState, code })}`);
    const svg = page.locator('#container svg.erDiagram');
    const blocker = svg.locator('[data-visual-node="BLOCKER"]');
    const edge = svg.locator('path[data-et="edge"]').first();
    await expect(blocker).toBeVisible();
    const midpoint = await edge.evaluate((path: SVGPathElement) => {
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error('Missing edge transform');
      const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    const obstacle = await blocker.boundingBox();
    const header = await blocker.locator('.name').boundingBox();
    if (!obstacle || !header) throw new Error('Missing blocker');
    const start = { x: header.x + header.width / 2, y: header.y + header.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(
      start.x + midpoint.x - obstacle.x - obstacle.width / 2,
      start.y + midpoint.y - obstacle.y - obstacle.height / 2,
      { steps: 12 }
    );
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('codeStore') ?? '{}').visualLayout?.mode
        )
      )
      .toBe('manual');
    await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
    await page.getByLabel('Search diagram or command').fill('connects');
    await page.getByRole('button', { name: 'Find connects', exact: true }).click();
    await page.getByRole('button', { name: 'Close canvas panel' }).click();
    const handle = svg.getByRole('button', { name: 'Relationship bend 1', exact: true });
    await expect(handle).toBeVisible();
    const before = await edge.getAttribute('d');
    const id = await svg.getAttribute('id');
    const box = await handle.boundingBox();
    const occupied = await blocker.boundingBox();
    if (!box || !occupied) throw new Error('Missing bend handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(occupied.x + occupied.width + 90, occupied.y + occupied.height / 2, {
      steps: 15
    });
    await page.mouse.up();
    await expect(edge).not.toHaveAttribute('d', before ?? '');
    await expect(svg).toHaveAttribute('id', id ?? '');
    const readRoutes = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('codeStore') ?? '{}').visualLayout?.edgeRoutes ?? {}
      );
    await expect.poll(async () => Object.keys(await readRoutes()).length).toBe(1);
    const routes = await readRoutes();
    const avoidsBlocker = () =>
      edge.evaluate((path: SVGPathElement) => {
        const node = path.ownerSVGElement?.querySelector('[data-visual-node="BLOCKER"]');
        if (!node) return false;
        const b = node.getBoundingClientRect();
        const matrix = path.getScreenCTM();
        if (!matrix) return false;
        for (let i = 0; i <= 100; i++) {
          const p = path
            .getPointAtLength((path.getTotalLength() * i) / 100)
            .matrixTransform(matrix);
          if (p.x > b.left + 2 && p.x < b.right - 2 && p.y > b.top + 2 && p.y < b.bottom - 2)
            return false;
        }
        return true;
      });
    await expect.poll(avoidsBlocker).toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`manual-route-${engine}.png`)
    });
    await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
    await expect.poll(readRoutes).toEqual({});
    await page.getByRole('button', { name: 'Redo layout', exact: true }).click();
    await expect.poll(readRoutes).toEqual(routes);
    await page.getByRole('button', { name: 'Add bend', exact: true }).click();
    await expect(svg.locator('[data-edge-bend]')).toHaveCount(2);
    const originalPoint = (Object.values(routes)[0] as { x: number; y: number }[])[0];
    const updatedPoints = Object.values(await readRoutes())[0] as { x: number; y: number }[];
    const addedIndex = updatedPoints.findIndex(
      (point) => point.x !== originalPoint.x || point.y !== originalPoint.y
    );
    await svg
      .getByRole('button', { name: `Relationship bend ${addedIndex + 1}`, exact: true })
      .focus();
    await page.keyboard.press('Delete');
    await expect(svg.locator('[data-edge-bend]')).toHaveCount(1);
    await expect.poll(readRoutes).toEqual(routes);
    const saved = await readRoutes();
    await expect
      .poll(() => deserializeState(new URL(page.url()).hash.slice(1)).visualLayout?.edgeRoutes)
      .toEqual(saved);
    await page.reload();
    await expect(svg).toBeVisible();
    await expect.poll(readRoutes).toEqual(saved);
    await expect.poll(avoidsBlocker).toBe(true);
    await expect(svg.locator('[data-edge-bend]')).toHaveCount(0);
    const a = svg.locator('[data-visual-node="A"]');
    const b = svg.locator('[data-visual-node="B"]');
    const bTransform = await b.getAttribute('transform');
    const aHeader = await a.locator('.name').boundingBox();
    if (!aHeader) throw new Error('Missing endpoint');
    await page.mouse.move(aHeader.x + aHeader.width / 2, aHeader.y + aHeader.height / 2);
    await page.mouse.down();
    await page.mouse.move(aHeader.x + aHeader.width / 2 - 35, aHeader.y + aHeader.height / 2 + 10, {
      steps: 10
    });
    await page.mouse.up();
    await expect(b).toHaveAttribute('transform', bTransform ?? '');
    await expect.poll(readRoutes).toEqual(saved);
    await expect
      .poll(() =>
        edge.evaluate((path: SVGPathElement) => {
          const matrix = path.getScreenCTM();
          if (!matrix) return false;
          return ['A', 'B'].every((id, index) => {
            const node = path.ownerSVGElement?.querySelector<SVGGElement>(
              `[data-visual-node="${id}"]`
            );
            const inverse = node?.getScreenCTM()?.inverse();
            if (!node || !inverse) return false;
            const point = path
              .getPointAtLength(index ? path.getTotalLength() : 0)
              .matrixTransform(matrix)
              .matrixTransform(inverse);
            const box = node.getBBox();
            return (
              Math.min(
                Math.abs(point.x - box.x),
                Math.abs(point.x - box.x - box.width),
                Math.abs(point.y - box.y),
                Math.abs(point.y - box.y - box.height)
              ) < 0.1
            );
          });
        })
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
    await page.getByLabel('Search diagram or command').fill('connects');
    await page.getByRole('button', { name: 'Find connects', exact: true }).click();
    await page.getByRole('button', { name: 'Reset line', exact: true }).click();
    await expect.poll(readRoutes).toEqual({});
  });
}

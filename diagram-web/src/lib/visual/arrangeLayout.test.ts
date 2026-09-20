import { describe, expect, it } from 'vitest';
import { arrangeLayout } from './arrangeLayout';
import { completeAssignments } from './arrangement';
import { parseVisualLayout } from './layout';

describe('grouped ER layout', () => {
  it.each([20, 50, 100])(
    'lays out %i variable-sized tables across services without overlap',
    async (count) => {
      const tables = Array.from({ length: count }, (_, index) => ({
        id: `db${index % 4}.table${index}`,
        fields: []
      }));
      const edges = tables
        .slice(1)
        .map((table, index) => ({ source: tables[index].id, target: table.id }));
      const assignments = tables.map((table, index) => ({
        tableId: table.id,
        service: `service${index % 2}`,
        database: `db${index % 4}`
      }));
      const measured = tables.map((table, index) => ({
        height: 80 + (index % 5) * 20,
        id: table.id,
        width: 120 + (index % 3) * 30,
        x: index * 10,
        y: 30
      }));
      const before = {
        engine: 'dagre' as const,
        mode: 'manual' as const,
        offsets: { [tables[0].id]: { x: 20, y: 15 } },
        edgeRoutes: { old: [{ x: 4, y: 4 }] }
      };
      const result = await arrangeLayout(
        { tables, edges },
        assignments,
        measured,
        before,
        'RIGHT',
        80
      );
      expect(result.nodes).toHaveLength(count);
      for (const [index, a] of result.nodes.entries()) {
        expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
        for (const b of result.nodes.slice(index + 1)) {
          expect(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y
          ).toBe(true);
        }
      }
      expect(result.layout.offsets[tables[0].id].x).toBe(result.nodes[0].x - measured[0].x + 20);
      expect(result.layout.edgeRoutes).toBeUndefined();
      expect(
        parseVisualLayout(JSON.parse(JSON.stringify(result.layout)))?.arrangement?.assignments
      ).toEqual(assignments);
    },
    15000
  );

  it('rejects unknown assignments and preserves special IDs safely', () => {
    const item = { tableId: '__proto__', service: 'service', database: 'db' };
    expect(completeAssignments(['__proto__'], [item])).toEqual([item]);
    expect(() => completeAssignments(['other'], [item])).toThrow();
  });
});

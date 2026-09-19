import { describe, expect, it } from 'vitest';
import { routeErRelationship, roundedRelationshipPath, type EntityBounds } from './erRouting';

const a: EntityBounds = { height: 100, width: 120, x: 0, y: 0 };
const onBorder = (point: { x: number; y: number }, box: EntityBounds): boolean =>
  ((point.x === box.x || point.x === box.x + box.width) &&
    point.y >= box.y &&
    point.y <= box.y + box.height) ||
  ((point.y === box.y || point.y === box.y + box.height) &&
    point.x >= box.x &&
    point.x <= box.x + box.width);

describe('ER relationship routing', () => {
  it.each([
    { height: 80, width: 160, x: 260, y: 30 },
    { height: 80, width: 160, x: -260, y: 30 },
    { height: 80, width: 160, x: 50, y: 240 },
    { height: 80, width: 160, x: 50, y: -240 },
    { height: 80, width: 160, x: 140, y: 30 }
  ])('keeps ports on borders and segments orthogonal for %o', (b) => {
    const points = routeErRelationship(a, b);
    expect(onBorder(points[0], a)).toBe(true);
    expect(onBorder(points[points.length - 1], b)).toBe(true);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true);
      expect(points[i]).not.toEqual(points[i - 1]);
    }
    const path = roundedRelationshipPath(points);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path).toContain('Q');
  });

  it('separates parallel relationships and keeps self loops outside their entity', () => {
    const b = { ...a, y: 240 };
    expect(routeErRelationship(a, b, -8)).not.toEqual(routeErRelationship(a, b, 8));
    const loop = routeErRelationship(a, a, 0, true);
    expect(onBorder(loop[0], a)).toBe(true);
    expect(onBorder(loop[loop.length - 1], a)).toBe(true);
    expect(loop[1].x).toBeGreaterThan(a.x + a.width);
    expect(loop[2].x).toBeGreaterThan(a.x + a.width);
    expect(loop).not.toEqual(routeErRelationship(a, a, 16, true));
  });
});

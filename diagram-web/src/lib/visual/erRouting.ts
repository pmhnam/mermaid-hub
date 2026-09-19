import type { VisualLayoutOffset as Point } from './layout';

export interface EntityBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const portOffset = (lane: number, size: number): number =>
  Math.max(-size / 3, Math.min(size / 3, lane));

/** Reconnect moved rectangles with orthogonal segments and ports on their borders. */
export const routeErRelationship = (
  from: EntityBounds,
  to: EntityBounds,
  lane = 0,
  self = false
): Point[] => {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const gapX = Math.abs(a.x - b.x) - (from.width + to.width) / 2;
  const gapY = Math.abs(a.y - b.y) - (from.height + to.height) / 2;
  let points: Point[];
  if (self) {
    const x = from.x + from.width;
    const outside = x + 35 + Math.abs(lane);
    points = [
      { x, y: a.y - from.height / 4 },
      { x: outside, y: a.y - from.height / 4 },
      { x: outside, y: a.y + from.height / 4 },
      { x, y: a.y + from.height / 4 }
    ];
  } else if (gapX >= 24 && (gapY < 24 || Math.abs(a.x - b.x) >= Math.abs(a.y - b.y))) {
    const sign = b.x >= a.x ? 1 : -1;
    const start = { x: a.x + (sign * from.width) / 2, y: a.y + portOffset(lane, from.height) };
    const end = { x: b.x - (sign * to.width) / 2, y: b.y + portOffset(lane, to.height) };
    const x = (start.x + end.x) / 2;
    points = [start, { x, y: start.y }, { x, y: end.y }, end];
  } else if (gapY >= 24) {
    const sign = b.y >= a.y ? 1 : -1;
    const start = { x: a.x + portOffset(lane, from.width), y: a.y + (sign * from.height) / 2 };
    const end = { x: b.x + portOffset(lane, to.width), y: b.y - (sign * to.height) / 2 };
    const y = (start.y + end.y) / 2;
    points = [start, { x: start.x, y }, { x: end.x, y }, end];
  } else {
    // Close/overlapping entities: route outside both instead of through either box.
    const start = { x: from.x + from.width, y: a.y + portOffset(lane, from.height) };
    const end = { x: to.x + to.width, y: b.y + portOffset(lane, to.height) };
    const x = Math.max(start.x, end.x) + 35 + Math.abs(lane);
    points = [start, { x, y: start.y }, { x, y: end.y }, end];
  }
  // Remove repeated and collinear vertices before rounding corners.
  const result: Point[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous?.x === point.x && previous.y === point.y) continue;
    const before = result.at(-2);
    if (
      before &&
      previous &&
      ((before.x === previous.x &&
        previous.x === point.x &&
        (previous.y - before.y) * (point.y - previous.y) >= 0) ||
        (before.y === previous.y &&
          previous.y === point.y &&
          (previous.x - before.x) * (point.x - previous.x) >= 0))
    )
      result.pop();
    result.push(point);
  }
  return result;
};

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const towards = (a: Point, b: Point, length: number): Point => {
  const ratio = length / distance(a, b);
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
};

export const roundedRelationshipPath = (points: Point[]): string => {
  if (points.length < 2) return '';
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index];
    const radius = Math.min(
      8,
      distance(point, points[index - 1]) / 2,
      distance(point, points[index + 1]) / 2
    );
    const entry = towards(point, points[index - 1], radius);
    const exit = towards(point, points[index + 1], radius);
    path += ` L${entry.x},${entry.y} Q${point.x},${point.y} ${exit.x},${exit.y}`;
  }
  const end = points[points.length - 1];
  return `${path} L${end.x},${end.y}`;
};

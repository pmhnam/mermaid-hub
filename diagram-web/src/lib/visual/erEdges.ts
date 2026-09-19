import type { VisualLayoutOffset } from './layout';
import { visualNodeElements, visualNodeKey } from './layout';

// Keep ER connectors attached while manually moving their endpoints. Automatic
// layout remains responsible for routing around other entities.
export const erEdgeUpdater = (
  svg: SVGSVGElement
): ((offsets: Record<string, VisualLayoutOffset>) => void) => {
  const nodes = visualNodeElements(svg).map((node) => ({
    id: node.id.match(/entity-.*-\d+$/)?.[0],
    key: visualNodeKey(node)
  }));
  const edges = [
    ...svg.querySelectorAll<SVGPathElement>('path[data-et="edge"][data-points]')
  ].flatMap((path) => {
    const id = path.getAttribute('data-id') ?? '';
    const from = nodes.find((node) => node.id && id.startsWith(`id_${node.id}_`));
    const to = nodes.find(
      (node) => node.id && id.slice(`id_${from?.id}_`.length).startsWith(`${node.id}_`)
    );
    if (!from?.key || !to?.key) return [];
    try {
      const points: unknown = JSON.parse(atob(path.getAttribute('data-points') ?? ''));
      if (
        !Array.isArray(points) ||
        points.length < 2 ||
        !points.every((point: unknown) => {
          if (!point || typeof point !== 'object') return false;
          const candidate = point as VisualLayoutOffset;
          return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
        })
      )
        return [];
      const label = [...svg.querySelectorAll<SVGGElement>('.edgeLabel .label[data-id]')].find(
        (element) => element.getAttribute('data-id') === id
      )?.parentElement;
      return [
        {
          from: from.key,
          label,
          labelTransform: label?.getAttribute('transform') ?? '',
          original: path.getAttribute('d') ?? '',
          path,
          points: points as VisualLayoutOffset[],
          to: to.key
        }
      ];
    } catch {
      return [];
    }
  });
  return (offsets) => {
    for (const edge of edges) {
      const from = offsets[edge.from] ?? { x: 0, y: 0 };
      const to = offsets[edge.to] ?? { x: 0, y: 0 };
      const moved = from.x || from.y || to.x || to.y;
      edge.path.setAttribute(
        'd',
        moved
          ? edge.points
              .map((point, index) => {
                const ratio = index / (edge.points.length - 1);
                const x = point.x + from.x * (1 - ratio) + to.x * ratio;
                const y = point.y + from.y * (1 - ratio) + to.y * ratio;
                return `${index === 0 ? 'M' : 'L'}${x},${y}`;
              })
              .join(' ')
          : edge.original
      );
      edge.label?.setAttribute(
        'transform',
        `${edge.labelTransform} translate(${(from.x + to.x) / 2}, ${(from.y + to.y) / 2})`
      );
    }
  };
};

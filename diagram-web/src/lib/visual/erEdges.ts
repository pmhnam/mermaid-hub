import { roundedRelationshipPath, routeErRelationship, type EntityBounds } from './erRouting';
import type { VisualLayoutOffset } from './layout';
import { visualNodeElements, visualNodeKey } from './layout';

// Capture geometry before offsets are applied. All routing is in each edge's
// parent coordinates, independent of the canvas pan/zoom transform.
export const erEdgeUpdater = (
  svg: SVGSVGElement
): ((offsets: Record<string, VisualLayoutOffset>) => void) => {
  const nodes = visualNodeElements(svg).map((node) => ({
    element: node,
    id: node.id.match(/entity-.*-\d+$/)?.[0],
    key: visualNodeKey(node)
  }));
  const edges = [...svg.querySelectorAll<SVGPathElement>('path[data-et="edge"]')].flatMap(
    (path) => {
      const id = path.getAttribute('data-id') ?? '';
      const from = nodes.find((node) => node.id && id.startsWith(`id_${node.id}_`));
      const to = nodes.find(
        (node) => node.id && id.slice(`id_${from?.id}_`.length).startsWith(`${node.id}_`)
      );
      const parent = path.parentNode as SVGGraphicsElement;
      const parentMatrix = parent.getCTM();
      if (!from?.key || !to?.key || !parentMatrix) return [];
      const bounds = (node: SVGGElement): EntityBounds | undefined => {
        const box = node.getBBox();
        const nodeMatrix = node.getCTM();
        if (!nodeMatrix) return undefined;
        const matrix = parentMatrix.inverse().multiply(nodeMatrix);
        const top = new DOMPoint(box.x, box.y).matrixTransform(matrix);
        const bottom = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
        return { height: bottom.y - top.y, width: bottom.x - top.x, x: top.x, y: top.y };
      };
      const fromBounds = bounds(from.element);
      const toBounds = bounds(to.element);
      if (!fromBounds || !toBounds) return [];
      const label = [...svg.querySelectorAll<SVGGElement>('.edgeLabel .label[data-id]')].find(
        (element) => element.getAttribute('data-id') === id
      )?.parentElement;
      return [
        {
          from: from.key,
          fromBounds,
          label,
          labelTransform: label?.getAttribute('transform') ?? '',
          original: path.getAttribute('d') ?? '',
          path,
          to: to.key,
          toBounds
        }
      ];
    }
  );
  const lanes = edges.map((edge) => {
    const siblings = edges.filter(
      (other) =>
        (other.from === edge.from && other.to === edge.to) ||
        (other.to === edge.from && other.from === edge.to)
    );
    return edge.from === edge.to
      ? siblings.indexOf(edge) * 16
      : (siblings.indexOf(edge) - (siblings.length - 1) / 2) * 16;
  });
  const movedBounds = (bounds: EntityBounds, offset: VisualLayoutOffset): EntityBounds => ({
    ...bounds,
    x: bounds.x + offset.x,
    y: bounds.y + offset.y
  });
  return (offsets) => {
    for (const [index, edge] of edges.entries()) {
      const from = offsets[edge.from] ?? { x: 0, y: 0 };
      const to = offsets[edge.to] ?? { x: 0, y: 0 };
      if (!(from.x || from.y || to.x || to.y)) {
        edge.path.setAttribute('d', edge.original);
        edge.label?.setAttribute('transform', edge.labelTransform);
        continue;
      }
      const points = routeErRelationship(
        movedBounds(edge.fromBounds, from),
        movedBounds(edge.toBounds, to),
        lanes[index],
        edge.from === edge.to
      );
      edge.path.setAttribute('d', roundedRelationshipPath(points));
      // Place the label on the actual rerouted line, not halfway between offsets.
      const midpoint = edge.path.getPointAtLength(edge.path.getTotalLength() / 2);
      const labelParent = edge.label?.parentNode as SVGGraphicsElement | undefined;
      const labelMatrix = labelParent?.getCTM();
      const edgeMatrix = (edge.path.parentNode as SVGGraphicsElement).getCTM();
      if (labelMatrix && edgeMatrix) {
        const point = midpoint.matrixTransform(labelMatrix.inverse().multiply(edgeMatrix));
        edge.label?.setAttribute('transform', `translate(${point.x}, ${point.y})`);
      }
    }
  };
};

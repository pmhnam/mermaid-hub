import { roundedRelationshipPath, routeErRelationship, type EntityBounds } from './erRouting';
import type { VisualLayout, VisualLayoutOffset } from './layout';
import { visualNodeElements, visualNodeKey } from './layout';
import { elementBounds, relativeMatrix } from './canvasGraph';

type EdgeUpdater = (offsets: VisualLayout['offsets'], routes?: VisualLayout['edgeRoutes']) => void;
const updaters = new WeakMap<SVGSVGElement, EdgeUpdater>();
export const previewErEdges = (svg: SVGSVGElement, layout: VisualLayout): void =>
  updaters.get(svg)?.(layout.offsets, layout.edgeRoutes);

// Capture geometry before offsets are applied. All routing is in each edge's
// parent coordinates, independent of the canvas pan/zoom transform.
export const erEdgeUpdater = (svg: SVGSVGElement): EdgeUpdater => {
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
      if (!from?.key || !to?.key) return [];
      const key = JSON.stringify([from.key, to.key, Number(id.match(/_(\d+)$/)?.[1] ?? 0)]);
      path.dataset.erRouteKey = key;
      const bounds = (node: SVGGElement): EntityBounds => elementBounds(node, parent);
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
          key,
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
  const previous = new Map<
    SVGPathElement,
    { fromX: number; fromY: number; toX: number; toY: number; route?: VisualLayoutOffset[] }
  >();
  const update: EdgeUpdater = (offsets, routes) => {
    for (const [index, edge] of edges.entries()) {
      const from = offsets[edge.from] ?? { x: 0, y: 0 };
      const to = offsets[edge.to] ?? { x: 0, y: 0 };
      const last = previous.get(edge.path);
      const route = routes?.[edge.key];
      if (
        last &&
        last.fromX === from.x &&
        last.fromY === from.y &&
        last.toX === to.x &&
        last.toY === to.y &&
        last.route === route
      )
        continue;
      previous.set(edge.path, { fromX: from.x, fromY: from.y, route, toX: to.x, toY: to.y });
      const waypoints = route ?? [];
      if (!(from.x || from.y || to.x || to.y) && !waypoints.length) {
        edge.path.setAttribute('d', edge.original);
        edge.label?.setAttribute('transform', edge.labelTransform);
        continue;
      }
      const points = routeErRelationship(
        movedBounds(edge.fromBounds, from),
        movedBounds(edge.toBounds, to),
        lanes[index],
        edge.from === edge.to,
        waypoints.map((point) => {
          const transformed = new DOMPoint(point.x, point.y).matrixTransform(
            relativeMatrix(
              svg.querySelector<SVGGElement>('.svg-pan-zoom_viewport') ?? svg,
              edge.path.parentNode as SVGGraphicsElement
            )
          );
          return { x: transformed.x, y: transformed.y };
        })
      );
      edge.path.setAttribute('d', roundedRelationshipPath(points));
      // Place the label on the actual rerouted line, not halfway between offsets.
      const midpoint = edge.path.getPointAtLength(edge.path.getTotalLength() / 2);
      const labelParent = edge.label?.parentNode as SVGGraphicsElement | undefined;
      if (labelParent) {
        const point = new DOMPoint(midpoint.x, midpoint.y).matrixTransform(
          relativeMatrix(edge.path.parentNode as SVGGraphicsElement, labelParent)
        );
        if (waypoints.length && edge.label instanceof SVGGraphicsElement) {
          const box = edge.label.getBBox();
          const length = edge.path.getTotalLength();
          const before = edge.path.getPointAtLength(Math.max(0, length / 2 - 1));
          const after = edge.path.getPointAtLength(Math.min(length, length / 2 + 1));
          // Keep the caption clear of both the line and its draggable bend handle.
          if (Math.abs(after.x - before.x) > Math.abs(after.y - before.y))
            point.y -= box.height / 2 + 10;
          else point.x += box.width / 2 + 10;
        }
        edge.label?.setAttribute('transform', `translate(${point.x}, ${point.y})`);
      }
    }
  };
  updaters.set(svg, update);
  return update;
};

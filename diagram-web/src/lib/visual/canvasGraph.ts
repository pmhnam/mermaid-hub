import type { SourceRange } from '$/types';
import { sourceRangeForSvgTarget } from '$/util/sourceNavigation';
import { buildSourceNavigationIndex } from '$/util/sourceNavigationIndex';
import { visualNodeElements, visualNodeKey } from './layout';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CanvasItem {
  id: string;
  kind: 'node' | 'field' | 'edge';
  label: string;
  nodeIds: string[];
  range?: SourceRange;
  elements: SVGGraphicsElement[];
}
export interface CanvasGraph {
  items: CanvasItem[];
  nodes: CanvasItem[];
  edges: CanvasItem[];
}

// Local SVG transforms work even while a mobile pane is collapsed (screen CTMs
// are singular there). This also keeps persisted edge geometry independent of zoom.
export const relativeMatrix = (
  element: SVGGraphicsElement,
  parent: SVGGraphicsElement
): DOMMatrix => {
  const matrixToRoot = (node: SVGGraphicsElement): DOMMatrix => {
    let result = new DOMMatrix();
    let current: Element | null = node;
    while (current instanceof SVGGraphicsElement && !(current instanceof SVGSVGElement)) {
      const matrix = current.transform.baseVal.consolidate()?.matrix;
      if (matrix)
        result = new DOMMatrix([
          matrix.a,
          matrix.b,
          matrix.c,
          matrix.d,
          matrix.e,
          matrix.f
        ]).multiply(result);
      current = current.parentElement;
    }
    return result;
  };
  return matrixToRoot(parent).inverse().multiply(matrixToRoot(element));
};

export const elementBounds = (
  element: SVGGraphicsElement,
  viewport: SVGGraphicsElement
): Bounds => {
  const box = element.getBBox();
  const transform = relativeMatrix(element, viewport);
  const a = new DOMPoint(box.x, box.y).matrixTransform(transform);
  const b = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(transform);
  return { height: b.y - a.y, width: b.x - a.x, x: a.x, y: a.y };
};

export const unionBounds = (boxes: Bounds[]): Bounds | undefined => {
  if (!boxes.length) return;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    x,
    y
  };
};

export const relatedNodes = (
  selected: string[],
  edges: Pick<CanvasItem, 'nodeIds'>[],
  depth: number
): Set<string> => {
  const result = new Set(selected);
  for (let level = 0; level < depth; level++) {
    const previous = new Set(result);
    for (const edge of edges)
      if (edge.nodeIds.some((id) => previous.has(id))) {
        for (const id of edge.nodeIds) result.add(id);
      }
  }
  return result;
};

export const buildCanvasGraph = (svg: SVGSVGElement, code: string, type: string): CanvasGraph => {
  const index = buildSourceNavigationIndex(code, type);
  const nodes: CanvasItem[] = [];
  const fields: CanvasItem[] = [];
  for (const element of visualNodeElements(svg)) {
    const key = visualNodeKey(element);
    if (!key || nodes.some((item) => item.id === key)) continue;
    element.dataset.canvasId = key;
    const range = sourceRangeForSvgTarget(code, type, element) ?? undefined;
    nodes.push({ elements: [element], id: key, kind: 'node', label: key, nodeIds: [key], range });
    for (const [i, child] of (index.children.get(key) ?? []).entries()) {
      const elements = [
        ...element.querySelectorAll<SVGGraphicsElement>('[data-source-start]')
      ].filter((el) => Number(el.dataset.sourceStart) === child.start);
      const id = `field:${key}:${i}`;
      for (const el of elements) el.dataset.canvasId = id;
      fields.push({
        elements,
        id,
        kind: 'field',
        label: code.slice(child.start, child.end),
        nodeIds: [key],
        range: child
      });
    }
  }
  const edges: CanvasItem[] = [];
  for (const path of svg.querySelectorAll<SVGPathElement>('path[data-et="edge"]')) {
    const id = path.getAttribute('data-id') ?? path.id;
    const from = nodes.find(
      (n) =>
        id.startsWith(`id_${n.elements[0].id.match(/entity-.*-\d+$/)?.[0]}_`) ||
        id.startsWith(`L_${n.id}_`)
    );
    let to: CanvasItem | undefined;
    if (from) {
      const prefix = id.startsWith('L_')
        ? `L_${from.id}_`
        : `id_${from.elements[0].id.match(/entity-.*-\d+$/)?.[0]}_`;
      to = nodes.find((n) =>
        id
          .slice(prefix.length)
          .startsWith(
            `${id.startsWith('L_') ? n.id : n.elements[0].id.match(/entity-.*-\d+$/)?.[0]}_`
          )
      );
    }
    const labels = [
      ...svg.querySelectorAll<SVGGraphicsElement>('.edgeLabel .label[data-id]')
    ].filter((el) => el.getAttribute('data-id') === id);
    const key = `edge:${id}`;
    const elements: SVGGraphicsElement[] = [path, ...labels];
    for (const el of elements) el.dataset.canvasId = key;
    edges.push({
      elements,
      id: key,
      kind: 'edge',
      label: labels[0]?.textContent?.trim() || `${from?.label ?? ''} → ${to?.label ?? ''}`,
      nodeIds: [from?.id, to?.id].filter((value): value is string => Boolean(value)),
      range: sourceRangeForSvgTarget(code, type, path) ?? undefined
    });
  }
  return { edges, items: [...nodes, ...fields, ...edges], nodes };
};

import { elementBounds, unionBounds } from './canvasGraph';
import { visualNodeElements, visualNodeKey, type VisualLayout } from './layout';

/** Recompute decoration from live table bounds so dragging and reload keep groups aligned. */
export const drawArrangeGroups = (svg: SVGSVGElement, layout: VisualLayout): void => {
  svg.querySelector('[data-arrange-groups]')?.remove();
  if (!layout.arrangement) return;
  const viewport = svg.querySelector<SVGGElement>('.svg-pan-zoom_viewport') ?? svg;
  const nodes = new Map(visualNodeElements(svg).map((node) => [visualNodeKey(node), node]));
  const groups = new Map<string, { label: string; ids: string[] }>();
  for (const assignment of layout.arrangement.assignments) {
    const key = JSON.stringify([assignment.service, assignment.database]);
    const group = groups.get(key) ?? {
      label: `${assignment.service} / ${assignment.database}`,
      ids: []
    };
    group.ids.push(assignment.tableId);
    groups.set(key, group);
  }
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layer.dataset.arrangeGroups = '';
  layer.setAttribute('pointer-events', 'none');
  const palette = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'];
  let index = 0;
  for (const group of groups.values()) {
    const bounds = unionBounds(
      group.ids.flatMap((id) => {
        const node = nodes.get(id);
        return node ? [elementBounds(node, viewport)] : [];
      })
    );
    if (!bounds) continue;
    const color = palette[index++ % palette.length];
    const rect = document.createElementNS(layer.namespaceURI, 'rect');
    for (const [key, value] of Object.entries({
      fill: color,
      'fill-opacity': 0.06,
      height: bounds.height + 65,
      rx: 12,
      stroke: color,
      width: bounds.width + 40,
      x: bounds.x - 20,
      y: bounds.y - 45
    }))
      rect.setAttribute(key, String(value));
    const text = document.createElementNS(layer.namespaceURI, 'text');
    text.setAttribute('x', String(bounds.x - 8));
    text.setAttribute('y', String(bounds.y - 20));
    text.setAttribute('fill', color);
    text.setAttribute('font-size', '14');
    text.textContent = group.label.length > 65 ? `${group.label.slice(0, 62)}…` : group.label;
    layer.append(rect, text);
  }
  viewport.prepend(layer);
};

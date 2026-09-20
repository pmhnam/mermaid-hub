import type { PanZoomState } from '$/util/panZoom';
import { erEdgeUpdater } from './erEdges';
import { elementBounds } from './canvasGraph';
import { drawArrangeGroups } from './arrangeGroups';
import {
  emptyVisualLayout,
  isVisualLayoutSupported,
  visualNodeElements,
  visualNodeKey,
  visualTransform,
  type LayoutEngine,
  type VisualLayout
} from './layout';

interface DragOptions {
  getLayout?: () => VisualLayout;
  selection?: (key: string) => string[];
  snap?: () => boolean;
  onGuides?: (guides: { x?: number; y?: number }) => void;
  diagramType?: string;
  editable: boolean;
  engine: LayoutEngine;
  layout?: VisualLayout;
  onChange?: (layout: VisualLayout) => void;
  panZoomState: PanZoomState;
  rough: boolean;
  svg?: SVGSVGElement;
}

interface ActiveDrag {
  center: { x: number; y: number };
  group: {
    key: string;
    element: SVGGElement;
    baseTransform: string;
    offset: { x: number; y: number };
  }[];
  delta: { x: number; y: number };
  baseTransform: string;
  element: SVGGElement;
  key: string;
  start: DOMPoint;
  startOffset: { x: number; y: number };
  pointerStart: { x: number; y: number };
  moved: boolean;
  pointerId: number;
  wasPanEnabled: boolean;
}

const pointFromEvent = (svg: SVGSVGElement, event: PointerEvent): DOMPoint | undefined => {
  const viewport =
    (svg.querySelector('.svg-pan-zoom_viewport') as SVGGraphicsElement | null) ?? svg;
  const matrix = viewport.getScreenCTM();
  if (!matrix) return undefined;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  try {
    return point.matrixTransform(matrix.inverse());
  } catch {
    return undefined;
  }
};

export const setupVisualDragging = ({
  diagramType,
  editable,
  engine,
  getLayout,
  layout: currentLayout,
  onChange,
  panZoomState,
  rough,
  svg,
  selection,
  snap,
  onGuides
}: DragOptions): (() => void) => {
  if (!svg || rough || !isVisualLayoutSupported(diagramType)) {
    return () => undefined;
  }
  let layout = currentLayout?.engine === engine ? currentLayout : emptyVisualLayout(engine);
  const updateEdges = diagramType?.startsWith('er') ? erEdgeUpdater(svg) : undefined;
  for (const node of visualNodeElements(svg)) {
    const baseTransform =
      node.getAttribute('data-visual-base-transform') ?? node.getAttribute('transform') ?? '';
    const key = visualNodeKey(node);
    node.setAttribute('data-visual-base-transform', baseTransform);
    if (key) {
      node.setAttribute('data-visual-node', key);
      if (editable && onChange) {
        node.style.cursor = 'grab';
        node.style.touchAction = 'none';
      }
      node.setAttribute('transform', visualTransform(baseTransform, layout.offsets[key]));
    }
  }
  updateEdges?.(layout.offsets, layout.edgeRoutes);
  drawArrangeGroups(svg, layout);
  if (!editable || !onChange) return () => undefined;

  let active: ActiveDrag | undefined;
  const handleDown = (event: PointerEvent): void => {
    // A second finger changes the gesture into pinch-to-zoom, cancelling a node move.
    if (event.pointerType === 'touch' && !event.isPrimary) {
      finish(undefined, false);
      return;
    }
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      event.shiftKey ||
      active ||
      panZoomState.isSpacePanning
    )
      return;
    const element = (event.target as Element | null)?.closest<SVGGElement>('[data-visual-node]');
    const key = element?.getAttribute('data-visual-node');
    const start = pointFromEvent(svg, event);
    if (!element || !key || !start) return;
    layout = getLayout?.() ?? layout;
    event.stopPropagation();
    const keys = selection?.(key) ?? [key];
    const bounds = elementBounds(element, panZoomState.viewport() ?? svg);
    active = {
      baseTransform: element.getAttribute('data-visual-base-transform') ?? '',
      center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      delta: { x: 0, y: 0 },
      element,
      group: visualNodeElements(svg).flatMap((node) => {
        const id = visualNodeKey(node);
        return id && keys.includes(id)
          ? [
              {
                baseTransform: node.getAttribute('data-visual-base-transform') ?? '',
                element: node,
                key: id,
                offset: layout.offsets[id] ?? { x: 0, y: 0 }
              }
            ]
          : [];
      }),
      key,
      moved: false,
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      start,
      startOffset: layout.offsets[key] ?? { x: 0, y: 0 },
      wasPanEnabled: panZoomState.isPanEnabled
    };
    panZoomState.setPanEnabled(false);
  };
  const handleMove = (event: PointerEvent): void => {
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.moved) {
      if (
        Math.hypot(event.clientX - active.pointerStart.x, event.clientY - active.pointerStart.y) < 5
      )
        return;
      active.moved = true;
      active.element.setPointerCapture(event.pointerId);
      active.element.style.cursor = 'grabbing';
    }
    event.preventDefault();
    const point = pointFromEvent(svg, event);
    if (!point) return;
    let x = point.x - active.start.x,
      y = point.y - active.start.y;
    if (snap?.()) {
      x = Math.round((active.center.x + x) / 20) * 20 - active.center.x;
      y = Math.round((active.center.y + y) / 20) * 20 - active.center.y;
      onGuides?.({ x: active.center.x + x, y: active.center.y + y });
    }
    active.delta = { x, y };
    const offsets = { ...layout.offsets };
    for (const node of active.group) {
      offsets[node.key] = { x: node.offset.x + x, y: node.offset.y + y };
      node.element.setAttribute(
        'transform',
        visualTransform(node.baseTransform, offsets[node.key])
      );
    }
    updateEdges?.(offsets, layout.edgeRoutes);
    drawArrangeGroups(svg, layout);
  };
  const finish = (event: PointerEvent | undefined, commit: boolean): void => {
    if (!active || (event && active.pointerId !== event.pointerId)) return;
    const drag = active;
    active = undefined;
    onGuides?.({});
    if (drag.element.hasPointerCapture(drag.pointerId))
      drag.element.releasePointerCapture(drag.pointerId);
    drag.element.style.cursor = 'grab';
    panZoomState.setPanEnabled(drag.wasPanEnabled);
    if (!drag.moved) return;
    const point = event ? pointFromEvent(svg, event) : undefined;
    if (!commit || !point) {
      for (const node of drag.group)
        node.element.setAttribute('transform', visualTransform(node.baseTransform, node.offset));
      updateEdges?.(layout.offsets, layout.edgeRoutes);
      drawArrangeGroups(svg, layout);
      return;
    }
    layout = {
      ...layout,
      mode: 'manual',
      offsets: {
        ...layout.offsets,
        ...Object.fromEntries(
          drag.group.map((node) => [
            node.key,
            { x: node.offset.x + drag.delta.x, y: node.offset.y + drag.delta.y }
          ])
        )
      }
    };
    onChange(layout);
  };
  const handleUp = (event: PointerEvent): void => finish(event, true);
  const handleCancel = (event: PointerEvent): void => finish(event, false);
  const handleBlur = (): void => finish(undefined, false);
  svg.addEventListener('pointerdown', handleDown, true);
  svg.addEventListener('pointermove', handleMove, true);
  window.addEventListener('pointerup', handleUp, true);
  window.addEventListener('pointercancel', handleCancel, true);
  window.addEventListener('blur', handleBlur);
  return () => {
    if (active) {
      for (const node of active.group)
        node.element.setAttribute('transform', visualTransform(node.baseTransform, node.offset));
      panZoomState.setPanEnabled(active.wasPanEnabled);
    }
    svg.removeEventListener('pointerdown', handleDown, true);
    svg.removeEventListener('pointermove', handleMove, true);
    window.removeEventListener('pointerup', handleUp, true);
    window.removeEventListener('pointercancel', handleCancel, true);
    window.removeEventListener('blur', handleBlur);
  };
};

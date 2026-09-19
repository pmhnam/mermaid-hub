import type { PanZoomState } from '$/util/panZoom';
import { erEdgeUpdater } from './erEdges';
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
  baseTransform: string;
  element: SVGGElement;
  key: string;
  start: DOMPoint;
  startOffset: { x: number; y: number };
  pointerStart: { x: number; y: number };
  moved: boolean;
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
  layout: currentLayout,
  onChange,
  panZoomState,
  rough,
  svg
}: DragOptions): (() => void) => {
  if (!svg || rough || !isVisualLayoutSupported(diagramType)) {
    return () => undefined;
  }
  let layout = currentLayout?.engine === engine ? currentLayout : emptyVisualLayout(engine);
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
  const updateEdges = diagramType?.startsWith('er') ? erEdgeUpdater(svg) : undefined;
  updateEdges?.(layout.offsets);
  if (!editable || !onChange) return () => undefined;

  let active: ActiveDrag | undefined;
  const handleDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const element = (event.target as Element | null)?.closest<SVGGElement>('[data-visual-node]');
    const key = element?.getAttribute('data-visual-node');
    const start = pointFromEvent(svg, event);
    if (!element || !key || !start) return;
    event.stopPropagation();
    active = {
      baseTransform: element.getAttribute('data-visual-base-transform') ?? '',
      element,
      key,
      moved: false,
      pointerStart: { x: event.clientX, y: event.clientY },
      start,
      startOffset: layout.offsets[key] ?? { x: 0, y: 0 }
    };
    panZoomState.setPanEnabled(false);
  };
  const handleMove = (event: PointerEvent): void => {
    if (!active) return;
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
    active.element.setAttribute(
      'transform',
      visualTransform(active.baseTransform, {
        x: active.startOffset.x + point.x - active.start.x,
        y: active.startOffset.y + point.y - active.start.y
      })
    );
    updateEdges?.({
      ...layout.offsets,
      [active.key]: {
        x: active.startOffset.x + point.x - active.start.x,
        y: active.startOffset.y + point.y - active.start.y
      }
    });
  };
  const finish = (event: PointerEvent, commit: boolean): void => {
    if (!active) return;
    const drag = active;
    active = undefined;
    if (drag.element.hasPointerCapture(event.pointerId))
      drag.element.releasePointerCapture(event.pointerId);
    drag.element.style.cursor = 'grab';
    panZoomState.setPanEnabled(true);
    if (!drag.moved) return;
    const point = pointFromEvent(svg, event);
    if (!commit || !point) {
      drag.element.setAttribute('transform', visualTransform(drag.baseTransform, drag.startOffset));
      updateEdges?.(layout.offsets);
      return;
    }
    layout = {
      engine: layout.engine,
      mode: 'manual',
      offsets: {
        ...layout.offsets,
        [drag.key]: {
          x: drag.startOffset.x + point.x - drag.start.x,
          y: drag.startOffset.y + point.y - drag.start.y
        }
      }
    };
    onChange(layout);
  };
  const handleUp = (event: PointerEvent): void => finish(event, true);
  const handleCancel = (event: PointerEvent): void => finish(event, false);
  svg.addEventListener('pointerdown', handleDown, true);
  svg.addEventListener('pointermove', handleMove, true);
  window.addEventListener('pointerup', handleUp, true);
  window.addEventListener('pointercancel', handleCancel, true);
  return () => {
    if (active) {
      active.element.setAttribute(
        'transform',
        visualTransform(active.baseTransform, active.startOffset)
      );
      panZoomState.setPanEnabled(true);
    }
    svg.removeEventListener('pointerdown', handleDown, true);
    svg.removeEventListener('pointermove', handleMove, true);
    window.removeEventListener('pointerup', handleUp, true);
    window.removeEventListener('pointercancel', handleCancel, true);
  };
};

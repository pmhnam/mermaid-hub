import type { PanZoomState } from '$/util/panZoom';
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
  if (!svg || !editable || !onChange || rough || !isVisualLayoutSupported(diagramType)) {
    return () => undefined;
  }
  const layout = currentLayout ?? emptyVisualLayout(engine);
  for (const node of visualNodeElements(svg)) {
    const baseTransform =
      node.getAttribute('data-visual-base-transform') ?? node.getAttribute('transform') ?? '';
    const key = visualNodeKey(node);
    node.setAttribute('data-visual-base-transform', baseTransform);
    if (key) {
      node.setAttribute('data-visual-node', key);
      node.setAttribute('transform', visualTransform(baseTransform, layout.offsets[key]));
    }
  }

  let active: ActiveDrag | undefined;
  const handleDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const element = (event.target as Element | null)?.closest<SVGGElement>('[data-visual-node]');
    const key = element?.getAttribute('data-visual-node');
    const start = pointFromEvent(svg, event);
    if (!element || !key || !start) return;
    event.preventDefault();
    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    active = {
      baseTransform: element.getAttribute('data-visual-base-transform') ?? '',
      element,
      key,
      start,
      startOffset: layout.offsets[key] ?? { x: 0, y: 0 }
    };
    panZoomState.setPanEnabled(false);
    element.classList.add('cursor-grabbing');
  };
  const handleMove = (event: PointerEvent): void => {
    if (!active) return;
    const point = pointFromEvent(svg, event);
    if (!point) return;
    active.element.setAttribute(
      'transform',
      visualTransform(active.baseTransform, {
        x: active.startOffset.x + point.x - active.start.x,
        y: active.startOffset.y + point.y - active.start.y
      })
    );
  };
  const finish = (event: PointerEvent, commit: boolean): void => {
    if (!active) return;
    const drag = active;
    active = undefined;
    if (drag.element.hasPointerCapture(event.pointerId))
      drag.element.releasePointerCapture(event.pointerId);
    drag.element.classList.remove('cursor-grabbing');
    panZoomState.setPanEnabled(true);
    const point = pointFromEvent(svg, event);
    if (!commit || !point) {
      drag.element.setAttribute('transform', visualTransform(drag.baseTransform, drag.startOffset));
      return;
    }
    onChange({
      engine: layout.engine,
      mode: 'manual',
      offsets: {
        ...layout.offsets,
        [drag.key]: {
          x: drag.startOffset.x + point.x - drag.start.x,
          y: drag.startOffset.y + point.y - drag.start.y
        }
      }
    });
  };
  svg.addEventListener('pointerdown', handleDown, true);
  svg.addEventListener('pointermove', handleMove, true);
  svg.addEventListener('pointerup', (event) => finish(event, true), true);
  svg.addEventListener('pointercancel', (event) => finish(event, false), true);
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
  };
};

import type { PanZoomState } from '$/util/panZoom';
import type { VisualLayout, VisualLayoutOffset as Point } from './layout';
import { relativeMatrix } from './canvasGraph';
import { previewErEdges } from './erEdges';

const namespace = 'http://www.w3.org/2000/svg';
interface EdgeSelection {
  key: string;
  path: SVGPathElement;
}

/** Editor-only handles: all coordinates are diagram-space, not screen pixels. */
export class EdgeControls {
  private group?: SVGGElement;
  private circles: SVGCircleElement[] = [];
  private active?: {
    before: VisualLayout;
    circle: SVGCircleElement;
    index: number;
    key: string;
    moved: boolean;
    panEnabled: boolean;
    pointerId: number;
    points: Point[];
    start: Point;
  };
  private unsubscribe: () => void;
  private destroyed = false;
  constructor(
    private readonly svg: SVGSVGElement,
    private readonly camera: PanZoomState,
    private readonly options: {
      change: (layout: VisualLayout) => void;
      editable: () => boolean;
      layout: () => VisualLayout;
      selection: () => EdgeSelection | undefined;
      snap: () => boolean;
      source: () => void;
    }
  ) {
    this.unsubscribe = camera.subscribe(() => this.resize());
    window.addEventListener('pointermove', this.move, true);
    window.addEventListener('pointerdown', this.anotherPointer, true);
    window.addEventListener('pointerup', this.up, true);
    window.addEventListener('pointercancel', this.cancel, true);
    window.addEventListener('blur', this.blur);
    window.addEventListener('keydown', this.escape, true);
  }
  private pointAt(path: SVGPathElement, fraction: number): Point {
    const point = path.getPointAtLength(path.getTotalLength() * fraction);
    const world = new DOMPoint(point.x, point.y).matrixTransform(
      relativeMatrix(path.parentNode as SVGGraphicsElement, this.camera.viewport() ?? this.svg)
    );
    return { x: world.x, y: world.y };
  }
  refresh(): void {
    if (this.active && !this.options.editable()) this.finish(false);
    if (this.active || this.destroyed) return;
    const focused = this.circles.findIndex((circle) => circle === document.activeElement);
    this.group?.remove();
    this.group = undefined;
    this.circles = [];
    const edge = this.options.selection();
    const viewport = this.camera.viewport();
    if (!edge || !viewport || !this.options.editable()) return;
    // Keep the initial grip away from the relationship label at the midpoint.
    const points = this.options.layout().edgeRoutes?.[edge.key] ?? [this.pointAt(edge.path, 0.25)];
    const group = document.createElementNS(namespace, 'g');
    group.setAttribute('data-canvas-overlay', 'edge-controls');
    group.setAttribute('data-canvas-id', edge.path.dataset.canvasId ?? '');
    this.group = group;
    for (const [index, point] of points.entries()) {
      const circle = document.createElementNS(namespace, 'circle');
      circle.dataset.edgeBend = String(index);
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('fill', '#f8fafc');
      circle.setAttribute('stroke', '#0284c7');
      circle.setAttribute('tabindex', '0');
      circle.setAttribute('role', 'button');
      circle.setAttribute('aria-label', `Relationship bend ${index + 1}`);
      circle.style.cursor = 'move';
      circle.style.touchAction = 'none';
      const title = document.createElementNS(namespace, 'title');
      title.textContent = 'Drag to route the relationship · Arrow keys to move · Delete to remove';
      circle.append(title);
      circle.addEventListener('pointerdown', (event) => {
        if (
          !this.options.editable() ||
          event.button !== 0 ||
          !event.isPrimary ||
          this.camera.isSpacePanning ||
          this.active
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        circle.focus({ preventScroll: true });
        this.active = {
          before: this.options.layout(),
          circle,
          index,
          key: edge.key,
          moved: false,
          panEnabled: this.camera.isPanEnabled,
          pointerId: event.pointerId,
          points: points.map((p) => ({ ...p })),
          start: { x: event.clientX, y: event.clientY }
        };
        this.camera.setPanEnabled(false);
        circle.setPointerCapture(event.pointerId);
      });
      circle.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          event.stopPropagation();
          this.save(
            edge.key,
            points.filter((_, i) => i !== index)
          );
        } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 20 : 5;
          this.save(
            edge.key,
            points.map((p, i) =>
              i !== index
                ? p
                : {
                    x:
                      p.x +
                      (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                    y:
                      p.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
                  }
            )
          );
        }
      });
      circle.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        this.options.source();
      });
      group.append(circle);
      this.circles.push(circle);
    }
    viewport.append(group);
    this.resize();
    if (focused >= 0)
      this.circles[Math.min(focused, this.circles.length - 1)]?.focus({ preventScroll: true });
  }
  private resize(): void {
    const zoom = (this.camera.snapshot()?.percent ?? 100) / 100;
    for (const circle of this.circles) {
      circle.setAttribute('r', String(6 / zoom));
      circle.setAttribute('stroke-width', String(2 / zoom));
    }
  }
  private move = (event: PointerEvent): void => {
    const active = this.active;
    if (!active || event.pointerId !== active.pointerId) return;
    if (
      Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) < 3 &&
      !active.moved
    )
      return;
    const matrix = this.camera.viewport()?.getScreenCTM()?.inverse();
    if (!matrix) return;
    event.preventDefault();
    active.moved = true;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    const x = this.options.snap() ? Math.round(point.x / 20) * 20 : point.x;
    const y = this.options.snap() ? Math.round(point.y / 20) * 20 : point.y;
    active.points = active.points.map((point, index) =>
      index === active.index ? { x, y } : point
    );
    active.circle.setAttribute('cx', String(x));
    active.circle.setAttribute('cy', String(y));
    previewErEdges(this.svg, {
      ...active.before,
      edgeRoutes: { ...active.before.edgeRoutes, [active.key]: active.points }
    });
  };
  private finish(commit: boolean): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    if (active.circle.hasPointerCapture(active.pointerId))
      active.circle.releasePointerCapture(active.pointerId);
    this.camera.setPanEnabled(active.panEnabled);
    if (!active.moved) return;
    if (commit && active.moved) this.save(active.key, active.points);
    else if (this.svg.isConnected) previewErEdges(this.svg, this.options.layout());
    this.refresh();
  }
  private up = (event: PointerEvent): void => {
    if (event.pointerId === this.active?.pointerId) this.finish(true);
  };
  private cancel = (event: PointerEvent): void => {
    if (event.pointerId === this.active?.pointerId) this.finish(false);
  };
  private blur = (): void => this.finish(false);
  private anotherPointer = (event: PointerEvent): void => {
    if (this.active && !event.isPrimary && event.pointerType === 'touch') this.finish(false);
  };
  private escape = (event: KeyboardEvent): void => {
    if (this.active && event.key === 'Escape') {
      event.stopImmediatePropagation();
      this.finish(false);
    }
  };
  private save(key: string, points: Point[]): void {
    const current = this.options.layout();
    const edgeRoutes = { ...current.edgeRoutes };
    if (points.length) edgeRoutes[key] = points;
    else Reflect.deleteProperty(edgeRoutes, key);
    this.options.change({ ...current, edgeRoutes, mode: 'manual' });
  }
  addBend(): void {
    const edge = this.options.selection();
    if (!edge) return;
    const points = this.options.layout().edgeRoutes?.[edge.key] ?? [];
    if (points.length >= 32) return;
    // Find the largest interval not already controlled by a bend, measured along
    // the displayed path. This inserts a handle without rearranging existing ones.
    const samples = Array.from({ length: 129 }, (_, index) => this.pointAt(edge.path, index / 128));
    const fractions = points.map((point) => {
      let closest = 0;
      for (let i = 1; i < samples.length; i++)
        if (
          Math.hypot(samples[i].x - point.x, samples[i].y - point.y) <
          Math.hypot(samples[closest].x - point.x, samples[closest].y - point.y)
        )
          closest = i;
      return closest / 128;
    });
    const boundaries = [0, ...fractions, 1];
    let gap = 0;
    for (let i = 1; i < boundaries.length - 1; i++)
      if (boundaries[i + 1] - boundaries[i] > boundaries[gap + 1] - boundaries[gap]) gap = i;
    const next = [...points];
    next.splice(gap, 0, this.pointAt(edge.path, (boundaries[gap] + boundaries[gap + 1]) / 2));
    this.save(edge.key, next);
  }
  reset(): void {
    const edge = this.options.selection();
    if (edge) this.save(edge.key, []);
  }
  cancelActive(): boolean {
    if (!this.active) return false;
    this.finish(false);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
    this.finish(false);
    this.group?.remove();
    this.unsubscribe();
    window.removeEventListener('pointermove', this.move, true);
    window.removeEventListener('pointerdown', this.anotherPointer, true);
    window.removeEventListener('pointerup', this.up, true);
    window.removeEventListener('pointercancel', this.cancel, true);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('keydown', this.escape, true);
  }
}

import type { State } from '$/types';
import Hammer from 'hammerjs';
import type { Point } from 'mermaid/dist/types.js';
import panzoom from 'svg-pan-zoom';
import { setupCanvasShortcuts } from './canvasShortcuts';
import { elementBounds, unionBounds, type Bounds } from '$/visual/canvasGraph';
type PanZoom = typeof panzoom;

export interface CanvasViewport {
  offset: Point;
  bounds: Bounds;
  content: Bounds;
  percent: number;
}

export class PanZoomState {
  private pan?: Point;
  private zoom?: number;
  private pzoom: PanZoom | undefined;
  private isDirty = false;
  private resizeObserver: ResizeObserver;
  private removeShortcuts?: () => void;
  private initializing = false;
  private pendingElement?: { element: SVGElement; state: Pick<State, 'pan' | 'zoom'> };
  private svg?: SVGSVGElement;
  private listeners = new Set<() => void>();
  private selected: SVGGraphicsElement[] = [];

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  public viewport(): SVGGraphicsElement | undefined {
    return this.svg?.querySelector<SVGGraphicsElement>('.svg-pan-zoom_viewport') ?? undefined;
  }

  public snapshot(): CanvasViewport | undefined {
    const instance = this.pzoom;
    const viewport = this.viewport();
    if (!instance || !viewport) return;
    const { width, height, realZoom } = instance.getSizes();
    const pan = instance.getPan();
    return {
      bounds: {
        height: height / realZoom,
        width: width / realZoom,
        x: -pan.x / realZoom,
        y: -pan.y / realZoom
      },
      content: viewport.getBBox(),
      offset: {
        x: this.svg?.parentElement?.offsetLeft ?? 0,
        y: this.svg?.parentElement?.offsetTop ?? 0
      },
      percent: realZoom * 100
    };
  }

  public setSelection(elements: SVGGraphicsElement[]): void {
    this.selected = elements;
    this.notify();
  }
  public get hasSelection(): boolean {
    return this.selected.length > 0;
  }

  public setPercent(percent: number): void {
    if (!this.pzoom || !Number.isFinite(percent)) return;
    const base = this.pzoom.getSizes().realZoom / this.pzoom.getZoom();
    this.pzoom.zoom(Math.max(5, Math.min(400, percent)) / 100 / base);
  }

  public centerOn(x: number, y: number): void {
    if (!this.pzoom) return;
    const { width, height, realZoom } = this.pzoom.getSizes();
    this.pzoom.pan({ x: width / 2 - x * realZoom, y: height / 2 - y * realZoom });
  }

  public fitElements(elements: SVGGraphicsElement[]): void {
    const viewport = this.viewport();
    if (!viewport) return;
    const bounds = unionBounds(elements.map((element) => elementBounds(element, viewport)));
    if (bounds) this.fitBounds(bounds);
  }

  public fitBounds(bounds: Bounds): void {
    if (!this.pzoom) return;
    const { width, height } = this.pzoom.getSizes();
    this.setPercent(
      Math.min(
        (width - 96) / Math.max(bounds.width, 1),
        (height - 128) / Math.max(bounds.height, 1)
      ) * 100
    );
    this.centerOn(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  }

  public fitSelection(): void {
    this.fitElements(this.selected);
  }

  public isPanEnabled: boolean;
  public isSpacePanning = false;
  public onPanZoomChange?: (pan: Point, zoom: number) => void;

  constructor() {
    this.isPanEnabled = true;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.pendingElement) {
        const { element, state } = this.pendingElement;
        const bounds = element.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) this.updateElement(element, state);
        return;
      }
      this.resize();
      if (!this.isDirty) {
        this.reset();
      }
    });
  }

  public updateElement(diagramView: SVGElement, { pan, zoom }: Pick<State, 'pan' | 'zoom'>) {
    const selected = this.selected.filter((element) => element.ownerSVGElement === diagramView);
    this.destroy();
    this.selected = selected;
    this.svg = diagramView as SVGSVGElement;
    const bounds = diagramView.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      this.pendingElement = { element: diagramView, state: { pan, zoom } };
      this.resizeObserver.observe(diagramView);
      return;
    }
    this.initializing = true;
    let hammer: HammerManager | undefined;
    this.pzoom = panzoom(diagramView, {
      center: true,
      controlIconsEnabled: false,
      customEventsHandler: {
        haltEventListeners: ['touchstart', 'touchend', 'touchmove', 'touchleave', 'touchcancel'],
        init: function (options) {
          const instance = options.instance;
          let initialScale = 1;
          let pannedX = 0;
          let pannedY = 0;
          // Mouse panning belongs to svg-pan-zoom; Hammer handles touch only.
          hammer = new Hammer(options.svgElement, { inputClass: Hammer.TouchInput });

          const resetPanned = () => {
            pannedX = 0;
            pannedY = 0;
          };
          const handlePan = (event: HammerInput) => {
            instance.panBy({ x: event.deltaX - pannedX, y: event.deltaY - pannedY });
            pannedX = event.deltaX;
            pannedY = event.deltaY;
          };

          hammer.get('pinch').set({ enable: true });
          hammer.on('panstart panmove', function (event) {
            if (!instance.isPanEnabled()) return;
            if (event.type === 'panstart') {
              resetPanned();
            }
            handlePan(event);
          });
          hammer.on('pinchstart pinchmove', function (event) {
            if (event.type === 'pinchstart') {
              initialScale = instance.getZoom();
              resetPanned();
            }
            const bounds = options.svgElement.getBoundingClientRect();
            instance.zoomAtPoint(initialScale * event.scale, {
              x: event.center.x - bounds.left,
              y: event.center.y - bounds.top
            });
            handlePan(event);
          });
        },
        destroy: function () {
          hammer?.destroy();
        }
      },
      fit: true,
      maxZoom: 1000,
      minZoom: 0.01,
      onPan: (pan) => {
        if (this.initializing) return;
        this.pan = pan;
        this.zoom = this.pzoom?.getZoom();
        this.isDirty = true;
        if (this.zoom) {
          this.onPanZoomChange?.(this.pan, this.zoom);
        }
      },
      onUpdatedCTM: () => this.notify(),
      onZoom: (zoom) => {
        if (this.initializing) return;
        this.zoom = zoom;
        this.pan = this.pzoom?.getPan();
        this.isDirty = true;
        if (this.pan) {
          this.onPanZoomChange?.(this.pan, this.zoom);
        }
      },
      panEnabled: true,
      zoomEnabled: true
    });

    this.pzoom.disableDblClickZoom();

    this.resizeObserver.disconnect();
    this.resizeObserver.observe(diagramView);

    if (pan && zoom && Number.isFinite(zoom) && Number.isFinite(pan.x) && Number.isFinite(pan.y)) {
      this.restorePanZoom(pan, zoom);
      this.isDirty = true;
    } else {
      this.reset();
    }

    // Locking entity dragging must never disable wheel/pinch zoom on a new SVG.
    this.setPanEnabled(this.isPanEnabled);
    this.removeShortcuts = setupCanvasShortcuts(diagramView, (enabled) => {
      this.isSpacePanning = enabled;
    });
    this.pan = this.pzoom.getPan();
    this.zoom = this.pzoom.getZoom();
    this.initializing = false;
    this.notify();
  }

  public restorePanZoom(pan: Point, zoom: number) {
    if (!this.pzoom) {
      console.error('PanZoomState.restorePanZoom: pzoom is not initialized');
      return;
    }
    this.pzoom.zoom(zoom);
    this.pzoom.pan(pan);
  }

  public resize() {
    this.pzoom?.resize();
    if (!this.isDirty) {
      this.reset();
    }
    this.notify();
  }

  public zoomIn() {
    this.pzoom?.zoomIn();
  }

  public zoomOut() {
    this.pzoom?.zoomOut();
  }

  public setPanEnabled(enabled: boolean): void {
    this.isPanEnabled = enabled;
    if (enabled) this.pzoom?.enablePan();
    else this.pzoom?.disablePan();
  }

  public reset() {
    const viewport = this.viewport();
    if (viewport && this.pzoom) this.fitBounds(viewport.getBBox());
    this.isDirty = false;
  }

  public destroy(): void {
    this.pendingElement = undefined;
    this.resizeObserver.disconnect();
    this.removeShortcuts?.();
    this.removeShortcuts = undefined;
    this.pzoom?.destroy();
    this.pzoom = undefined;
    this.svg = undefined;
    this.selected = [];
    this.notify();
  }
}

import type { State } from '$/types';
import Hammer from 'hammerjs';
import type { Point } from 'mermaid/dist/types.js';
import panzoom from 'svg-pan-zoom';
import { setupCanvasShortcuts } from './canvasShortcuts';
type PanZoom = typeof panzoom;

export class PanZoomState {
  private pan?: Point;
  private zoom?: number;
  private pzoom: PanZoom | undefined;
  private isDirty = false;
  private resizeObserver: ResizeObserver;
  private removeShortcuts?: () => void;
  private initializing = false;

  public isPanEnabled: boolean;
  public isSpacePanning = false;
  public onPanZoomChange?: (pan: Point, zoom: number) => void;

  constructor() {
    this.isPanEnabled = true;
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      if (!this.isDirty) {
        this.reset();
      }
    });
  }

  public updateElement(diagramView: SVGElement, { pan, zoom }: Pick<State, 'pan' | 'zoom'>) {
    this.destroy();
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
      maxZoom: 12,
      minZoom: 0.2,
      onPan: (pan) => {
        if (this.initializing) return;
        this.pan = pan;
        this.zoom = this.pzoom?.getZoom();
        this.isDirty = true;
        if (this.zoom) {
          this.onPanZoomChange?.(this.pan, this.zoom);
        }
      },
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
    this.pzoom?.reset();
    // Zoom out a bit to avoid overlap with the toolbar
    this.pzoom?.zoom(0.875);
    this.isDirty = false;
  }

  public destroy(): void {
    this.resizeObserver.disconnect();
    this.removeShortcuts?.();
    this.removeShortcuts = undefined;
    this.pzoom?.destroy();
    this.pzoom = undefined;
  }
}

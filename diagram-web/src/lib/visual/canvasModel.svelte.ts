import type { SourceRange } from '$/types';
import { SvelteSet } from 'svelte/reactivity';
import type { PanZoomState } from '$/util/panZoom';
import { parse } from '$/util/mermaid';
import { sourcePosition } from '$/util/sourcePosition';
import type { SourceCursor } from '$/util/canvasEvents';
import {
  buildCanvasGraph,
  elementBounds,
  relatedNodes,
  unionBounds,
  type CanvasGraph,
  type CanvasItem
} from './canvasGraph';
import {
  emptyVisualLayout,
  layoutEngineFromDocument,
  updateMermaidDocumentLayout,
  type VisualLayout
} from './layout';
import { LayoutHistory } from './layoutHistory';
import { EdgeControls } from './edgeControls';

export interface CanvasDocument {
  code: string;
  config: string;
  visualLayout?: VisualLayout;
  resetView?: boolean;
}
export class CanvasModel {
  graph = $state.raw<CanvasGraph>({ edges: [], items: [], nodes: [] });
  selected = $state<string[]>([]);
  focusDepth = $state(0);
  query = $state('');
  panel = $state<'search' | 'properties' | 'commands' | null>(null);
  menu = $state<{ x: number; y: number } | undefined>();
  snap = $state(false);
  guides = $state<{ x?: number; y?: number }>({});
  canUndo = $state(false);
  canRedo = $state(false);
  message = $state('');
  presenting = $state(false);
  code = $state('');
  config = $state('');
  type = $state('');
  svg = $state.raw<SVGSVGElement>();
  layout: VisualLayout = emptyVisualLayout('dagre');
  private history = new LayoutHistory();
  private past: ('layout' | 'document')[] = [];
  private future: ('layout' | 'document')[] = [];
  private documents: { before: CanvasDocument; after: CanvasDocument }[] = [];
  private documentRedo: { before: CanvasDocument; after: CanvasDocument }[] = [];
  private cleanup?: () => void;
  private edgeControls?: EdgeControls;
  constructor(
    private readonly getCamera: () => PanZoomState,
    private readonly options: {
      editable: () => boolean;
      layout: (layout: VisualLayout) => void;
      document: (before: CanvasDocument, after: CanvasDocument) => boolean;
      source: (range: SourceRange) => void;
    }
  ) {}
  get camera(): PanZoomState {
    return this.getCamera();
  }

  attach(
    svg: SVGSVGElement,
    code: string,
    config: string,
    type: string,
    layout?: VisualLayout
  ): void {
    this.cleanup?.();
    this.edgeControls?.destroy();
    const engine = layoutEngineFromDocument(code, config);
    if (this.layout.engine !== engine) {
      this.history.clear();
      this.past = [];
      this.future = [];
      this.documents = [];
      this.documentRedo = [];
    }
    this.code = code;
    this.config = config;
    this.type = type;
    this.svg = svg;
    this.layout = layout ?? emptyVisualLayout(engine);
    this.graph = buildCanvasGraph(svg, code, type);
    this.edgeControls = new EdgeControls(svg, this.camera, {
      change: (next) => this.commitLayout(next),
      editable: this.options.editable,
      layout: () => this.layout,
      selection: () => this.selectedEdge,
      snap: () => this.snap,
      source: () => this.source()
    });
    this.selected = this.selected.filter((id) => this.graph.items.some((item) => item.id === id));
    this.refresh();
    let start: { x: number; y: number } | undefined;
    let moved = false;
    let box: SVGRectElement | undefined;
    let previousPan = true;
    let additive = false;
    const pointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || this.camera.isSpacePanning) return;
      start = { x: event.clientX, y: event.clientY };
      moved = false;
      if ((event.target as Element).closest('[data-canvas-id]')) return;
      // Touch background drags belong to Hammer's pan gesture, not marquee selection.
      if (event.pointerType === 'touch') return;
      const viewport = this.camera.viewport();
      if (!viewport) return;
      previousPan = this.camera.isPanEnabled;
      this.camera.setPanEnabled(false);
      additive = event.shiftKey;
      box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      box.setAttribute('fill', '#0ea5e922');
      box.setAttribute('stroke', '#0284c7');
      box.setAttribute('pointer-events', 'none');
      viewport.append(box);
      svg.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!start) return;
      moved ||= Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5;
      const matrix = this.camera.viewport()?.getScreenCTM()?.inverse();
      if (!box || !matrix) return;
      const a = new DOMPoint(start.x, start.y).matrixTransform(matrix);
      const b = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
      for (const [key, value] of Object.entries({
        height: Math.abs(a.y - b.y),
        width: Math.abs(a.x - b.x),
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y)
      }))
        box.setAttribute(key, String(value));
    };
    const finish = (event?: PointerEvent) => {
      if (box) {
        const viewport = this.camera.viewport();
        if (event?.type === 'pointerup' && moved && viewport) {
          const bounds = box.getBBox();
          const ids = this.graph.nodes
            .filter((node) => {
              const b = elementBounds(node.elements[0], viewport);
              return (
                b.x >= bounds.x &&
                b.y >= bounds.y &&
                b.x + b.width <= bounds.x + bounds.width &&
                b.y + b.height <= bounds.y + bounds.height
              );
            })
            .map((node) => node.id);
          this.selected = additive ? [...new SvelteSet([...this.selected, ...ids])] : ids;
          this.refresh();
        }
        box.remove();
        box = undefined;
        this.camera.setPanEnabled(previousPan);
      }
      start = undefined;
    };
    const blur = () => finish();
    const click = (event: MouseEvent) => {
      if (moved || this.camera.isSpacePanning) return;
      const id = (event.target as Element).closest<SVGElement>('[data-canvas-id]')?.dataset
        .canvasId;
      this.select(id, event.shiftKey);
      this.menu = undefined;
    };
    const context = (event: MouseEvent) => {
      event.preventDefault();
      const id = (event.target as Element).closest<SVGElement>('[data-canvas-id]')?.dataset
        .canvasId;
      if (id && !this.selected.includes(id)) this.select(id);
      const bounds = svg.closest('#view')?.getBoundingClientRect() ?? svg.getBoundingClientRect();
      this.menu = {
        x: Math.max(8, Math.min(event.clientX - bounds.x, bounds.width - 190)),
        y: Math.max(8, Math.min(event.clientY - bounds.y, bounds.height - 230))
      };
    };
    svg.addEventListener('pointerdown', pointerDown, true);
    svg.addEventListener('click', click);
    svg.addEventListener('contextmenu', context);
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', blur);
    this.cleanup = () => {
      finish();
      svg.removeEventListener('pointerdown', pointerDown, true);
      svg.removeEventListener('click', click);
      svg.removeEventListener('contextmenu', context);
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', blur);
    };
  }

  get selection(): CanvasItem[] {
    return this.graph.items.filter((item) => this.selected.includes(item.id));
  }
  get selectedEdge(): { path: SVGPathElement; key: string } | undefined {
    if (!this.type.startsWith('er') || this.selection.length !== 1) return;
    const element = this.selection[0].elements[0];
    const key = element?.dataset.erRouteKey;
    if (key && element instanceof SVGPathElement) return { key, path: element };
  }
  addEdgeBend(): void {
    this.edgeControls?.addBend();
  }
  resetEdgeRoute(): void {
    this.edgeControls?.reset();
  }
  get nodeIds(): string[] {
    return [...new SvelteSet(this.selection.flatMap((item) => item.nodeIds))];
  }
  select(id?: string, additive = false): void {
    if (!additive && this.selected.length === 1 && this.selected[0] === id) return;
    this.selected = id
      ? additive
        ? this.selected.includes(id)
          ? this.selected.filter((value) => value !== id)
          : [...this.selected, id]
        : [id]
      : [];
    if (!this.selected.length) this.focusDepth = 0;
    this.refresh();
  }
  focus(depth: number): void {
    this.focusDepth = depth;
    this.refresh();
  }
  locate(item: CanvasItem): void {
    this.select(item.id);
    this.camera.fitElements(
      this.graph.nodes.filter((n) => item.nodeIds.includes(n.id)).flatMap((n) => n.elements)
    );
  }
  source(): void {
    const range = this.selection[0]?.range;
    if (range) this.options.source({ ...range, sourceCode: this.code });
  }
  fromSource(cursor: SourceCursor): void {
    if (cursor.code.replaceAll('\r\n', '\n') !== this.code.replaceAll('\r\n', '\n')) return;
    const matches = this.graph.items.filter(
      (item) =>
        item.range && sourcePosition(this.code, item.range.start).lineNumber === cursor.lineNumber
    );
    const item = matches.find((candidate) => candidate.kind === 'field') ?? matches[0];
    if (item) this.select(item.id);
  }
  private refresh(): void {
    const ids = this.nodeIds;
    const related = relatedNodes(ids, this.graph.edges, this.focusDepth || 1);
    for (const item of this.graph.items)
      for (const element of item.elements) {
        element.classList.toggle('canvas-selected', this.selected.includes(item.id));
        element.classList.toggle(
          'canvas-related',
          ids.length > 0 && item.kind === 'edge' && item.nodeIds.some((id) => ids.includes(id))
        );
        element.classList.toggle(
          'canvas-dimmed',
          this.focusDepth > 0 && !item.nodeIds.every((id) => related.has(id))
        );
      }
    this.camera.setSelection(
      this.graph.nodes.filter((node) => ids.includes(node.id)).flatMap((node) => node.elements)
    );
    this.canUndo = this.past.length > 0;
    this.canRedo = this.future.length > 0;
    this.edgeControls?.refresh();
  }
  syncSelection(): void {
    this.refresh();
  }
  dragKeys(key: string): string[] {
    const nodes = this.selection
      .filter((item) => item.kind !== 'edge')
      .flatMap((item) => item.nodeIds);
    if (!nodes.includes(key)) {
      this.select(key);
      return [key];
    }
    return [...new SvelteSet(nodes)];
  }
  commitLayout(layout: VisualLayout, record = true): void {
    if (!this.options.editable()) return;
    if (record && this.history.record(this.layout, layout)) this.recordOperation('layout');
    this.layout = layout;
    this.options.layout(layout);
    this.refresh();
  }
  undo(redo = false): void {
    if (!this.options.editable()) return;
    if (this.edgeControls?.cancelActive()) return;
    const kind = (redo ? this.future : this.past).pop();
    let applied = false;
    if (kind === 'document') {
      const entry = (redo ? this.documentRedo : this.documents).pop();
      if (entry) {
        const expected = redo ? entry.before : entry.after;
        const next = redo ? entry.after : entry.before;
        const layoutMatches =
          !expected.visualLayout ||
          (this.layout.engine === expected.visualLayout.engine &&
            JSON.stringify(Object.entries(this.layout.offsets).sort()) ===
              JSON.stringify(Object.entries(expected.visualLayout.offsets).sort()) &&
            JSON.stringify(Object.entries(this.layout.edgeRoutes ?? {}).sort()) ===
              JSON.stringify(Object.entries(expected.visualLayout.edgeRoutes ?? {}).sort()));
        if (
          layoutMatches &&
          this.code === expected.code &&
          this.config === expected.config &&
          this.options.document(expected, next)
        ) {
          this.code = next.code;
          this.config = next.config;
          if (next.visualLayout) this.layout = next.visualLayout;
          (redo ? this.documents : this.documentRedo).push(entry);
          applied = true;
        }
      }
    } else if (kind === 'layout') {
      const next = this.history.step(this.layout, redo);
      if (next) {
        this.commitLayout(next, false);
        applied = true;
      }
    }
    if (kind && applied) (redo ? this.past : this.future).push(kind);
    else if (kind) this.message = 'Changed by another edit; nothing to restore.';
    this.refresh();
  }
  private recordOperation(kind: 'layout' | 'document'): void {
    this.past.push(kind);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.documentRedo = [];
  }
  async changeEngine(engine: VisualLayout['engine']): Promise<void> {
    const next = updateMermaidDocumentLayout(this.code, this.config, engine);
    if (next)
      await this.editDocument({
        ...next,
        resetView: true,
        visualLayout: emptyVisualLayout(engine)
      });
  }
  resetPositions(): void {
    const offsets = Object.fromEntries(
      Object.entries(this.layout.offsets).filter(([key]) => !this.nodeIds.includes(key))
    );
    this.commitLayout({ ...this.layout, offsets });
  }
  align(mode: 'left' | 'right' | 'top' | 'bottom' | 'horizontal' | 'vertical'): void {
    const viewport = this.camera.viewport();
    if (!viewport) return;
    const nodes = this.graph.nodes
      .filter((node) => this.nodeIds.includes(node.id))
      .map((node) => ({ bounds: elementBounds(node.elements[0], viewport), id: node.id }));
    const all = unionBounds(nodes.map((node) => node.bounds));
    if (!all || nodes.length < 2) return;
    const offsets = { ...this.layout.offsets };
    const horizontal = mode === 'horizontal';
    nodes.sort((a, b) => (horizontal ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
    const total = nodes.reduce(
      (sum, node) => sum + (horizontal ? node.bounds.width : node.bounds.height),
      0
    );
    const gap = ((horizontal ? all.width : all.height) - total) / (nodes.length - 1);
    let position = horizontal ? all.x : all.y;
    for (const node of nodes) {
      const b = node.bounds;
      let dx = 0,
        dy = 0;
      if (mode === 'left') dx = all.x - b.x;
      if (mode === 'right') dx = all.x + all.width - b.x - b.width;
      if (mode === 'top') dy = all.y - b.y;
      if (mode === 'bottom') dy = all.y + all.height - b.y - b.height;
      if (mode === 'horizontal') dx = position - b.x;
      if (mode === 'vertical') dy = position - b.y;
      position += (horizontal ? b.width : b.height) + gap;
      offsets[node.id] = { x: (offsets[node.id]?.x ?? 0) + dx, y: (offsets[node.id]?.y ?? 0) + dy };
    }
    this.commitLayout({ ...this.layout, mode: 'manual', offsets });
  }
  async editDocument(after: CanvasDocument): Promise<boolean> {
    if (!this.options.editable()) return false;
    const before = {
      code: this.code,
      config: this.config,
      ...(after.visualLayout ? { visualLayout: this.layout } : {}),
      ...(after.resetView ? { resetView: true } : {})
    };
    try {
      await parse(after.code);
      if (!this.options.document(before, after))
        throw new Error('The diagram changed. Reopen properties and retry.');
      this.message = 'Changes applied.';
      this.documents.push({ before, after });
      if (this.documents.length > 100) this.documents.shift();
      this.recordOperation('document');
      this.code = after.code;
      this.config = after.config;
      if (after.visualLayout) {
        this.layout = after.visualLayout;
      }
      this.refresh();
      return true;
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Unable to apply changes';
      return false;
    }
  }
  destroy(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.edgeControls?.destroy();
    this.edgeControls = undefined;
    this.camera.setSelection([]);
  }
}

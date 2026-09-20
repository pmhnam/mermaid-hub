<script lang="ts">
  import type { State, ValidatedState } from '$/types';
  import type { SourceRange } from '$lib/types';
  import { recordRenderTime, shouldRefreshView } from '$/util/autoSync';
  import { PanZoomState } from '$/util/panZoom';
  import { renderAndPlaceDiagram } from '$/util/renderView';
  import { updateCodeStore, validatedState } from '$/util/state.svelte';
  import { saveStatistics } from '$/util/stats';
  import { annotateSvgSourceNavigation, sourceRangeForSvgTarget } from '$lib/util/sourceNavigation';
  import PreviewErrorOverlay from './PreviewErrorOverlay.svelte';
  import FontAwesome, { mayContainFontAwesome } from '$lib/components/FontAwesome.svelte';
  import uniqueID from 'lodash-es/uniqueId';
  import type { MermaidConfig } from 'mermaid';
  import { mode } from 'mode-watcher';
  import { onMount, untrack } from 'svelte';
  import { setupVisualDragging } from '$/visual/drag';
  import { layoutEngineFromDocument, type VisualLayout } from '$/visual/layout';
  import CanvasTools from './CanvasTools.svelte';
  import { CanvasModel, type CanvasDocument } from '$/visual/canvasModel.svelte';
  import { previewErEdges } from '$/visual/erEdges';
  import { drawArrangeGroups } from '$/visual/arrangeGroups';

  let {
    onSourceSelect,
    panZoomState = new PanZoomState(),
    shouldShowGrid = true,
    editable = false,
    visualLayout,
    onVisualLayoutChange,
    onDocumentChange,
    onComment
  }: {
    editable?: boolean;
    onSourceSelect?: (range: SourceRange) => void;
    onVisualLayoutChange?: (layout: VisualLayout) => void;
    onDocumentChange?: (before: CanvasDocument, after: CanvasDocument) => boolean;
    onComment?: (target?: string) => void;
    panZoomState?: PanZoomState;
    shouldShowGrid?: boolean;
    visualLayout?: VisualLayout;
  } = $props();
  let code = '';
  let config = '';
  let container: HTMLDivElement | undefined = $state();
  let rough = $state(false);
  let view: HTMLDivElement | undefined = $state();
  let error = $state<Error | undefined>();
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let hasRenderedDiagram = $state(false);
  let disposed = false;
  let navigationMessage = $state('');
  let panZoom = true;
  let manualUpdate = true;
  let renderedDiagramType = '';
  let visualLayoutKey = '';
  let renderedLayout: VisualLayout | undefined;
  let renderedAppearance: 'light' | 'dark' | undefined;
  let removeVisualDragging: (() => void) | undefined;
  let waitForFontAwesomeToLoad: FontAwesome['waitForFontAwesomeToLoad'] | undefined = $state();
  const canvas = new CanvasModel(() => panZoomState, {
    document: (before, after) => {
      if (onDocumentChange) return onDocumentChange(before, after);
      if (
        validatedState.current.code !== before.code ||
        validatedState.current.mermaid !== before.config
      )
        return false;
      updateCodeStore({
        code: after.code,
        mermaid: after.config,
        ...(after.resetView ? { pan: undefined, zoom: undefined } : {}),
        ...(after.visualLayout ? { visualLayout: after.visualLayout } : {})
      });
      return true;
    },
    editable: () => editable,
    layout: (layout) => onVisualLayoutChange?.(layout),
    source: (range) => onSourceSelect?.(range)
  });
  $effect(() => {
    void editable;
    untrack(() => canvas.syncSelection());
  });

  // Set up panZoom state observer to update the store when pan/zoom changes
  const setupPanZoomObserver = () => {
    panZoomState.onPanZoomChange = (pan, zoom) => {
      updateCodeStore({ pan, zoom });
    };
  };

  const handlePanZoom = (state: State, graphDiv: SVGSVGElement) => {
    try {
      panZoomState.updateElement(graphDiv, state);
    } catch (error) {
      console.error('PanZoom error:', error);
    }
  };

  const handleStateChange = async (state: ValidatedState, appearance: 'light' | 'dark') => {
    if (disposed) return;
    const startTime = Date.now();
    if (state.error !== undefined) {
      if (errorTimer) clearTimeout(errorTimer);
      const nextError = state.error;
      errorTimer = setTimeout(() => {
        error = nextError;
      }, 1000);
      return;
    }
    if (errorTimer) clearTimeout(errorTimer);
    error = undefined;
    let diagramType: string | undefined;
    try {
      if (container) {
        manualUpdate = true;
        const currentVisualLayout = visualLayout ?? state.visualLayout;
        // Do not render if there is no change in Code/Config/PanZoom
        if (
          code === state.code &&
          config === state.mermaid &&
          rough === state.rough &&
          panZoom === state.panZoom &&
          renderedAppearance === appearance &&
          visualLayoutKey === JSON.stringify(currentVisualLayout ?? null)
        ) {
          return;
        }

        // Bending an edge only changes its path. Keep the SVG, camera, focus and
        // editor intact instead of running Mermaid's automatic layout again.
        if (
          renderedDiagramType.startsWith('er') &&
          canvas.svg &&
          currentVisualLayout &&
          code === state.code &&
          config === state.mermaid &&
          rough === state.rough &&
          panZoom === state.panZoom &&
          renderedAppearance === appearance &&
          currentVisualLayout.engine === layoutEngineFromDocument(code, config) &&
          JSON.stringify(currentVisualLayout.offsets) ===
            JSON.stringify(renderedLayout?.offsets ?? {})
        ) {
          previewErEdges(canvas.svg, currentVisualLayout);
          drawArrangeGroups(canvas.svg, currentVisualLayout);
          canvas.layout = currentVisualLayout;
          canvas.syncSelection();
          renderedLayout = currentVisualLayout;
          visualLayoutKey = JSON.stringify(currentVisualLayout);
          return;
        }

        if (renderedAppearance === appearance && !shouldRefreshView()) {
          return;
        }

        const nextCode = state.code;
        const nextConfig = state.mermaid;
        const nextPanZoom = state.panZoom ?? true;
        const appearanceViewport =
          renderedAppearance !== appearance && code === nextCode && config === nextConfig
            ? panZoomState.snapshot()
            : undefined;

        if (mayContainFontAwesome(nextCode)) {
          await waitForFontAwesomeToLoad?.();
        }

        const scroll = view?.parentElement?.scrollTop;
        const { diagramType: detectedDiagramType, graphDiv } = await renderAndPlaceDiagram({
          appearance,
          code: nextCode,
          config: JSON.parse(nextConfig) as MermaidConfig,
          container,
          rough: state.rough,
          viewId: uniqueID('graph-')
        });
        if (disposed) return;
        diagramType = detectedDiagramType;
        code = nextCode;
        config = nextConfig;
        rough = state.rough;
        panZoom = nextPanZoom;
        renderedAppearance = appearance;
        hasRenderedDiagram = true;
        renderedDiagramType = detectedDiagramType ?? '';
        if (graphDiv && detectedDiagramType) {
          annotateSvgSourceNavigation(code, detectedDiagramType, graphDiv);
        }
        removeVisualDragging?.();
        if (graphDiv && !rough)
          canvas.attach(graphDiv, code, config, renderedDiagramType, currentVisualLayout);
        else canvas.destroy();
        removeVisualDragging = setupVisualDragging({
          diagramType: detectedDiagramType,
          editable,
          engine: layoutEngineFromDocument(nextCode, nextConfig),
          getLayout: () => canvas.layout,
          layout: currentVisualLayout,
          onChange: (layout) => canvas.commitLayout(layout),
          onGuides: (guides) => {
            canvas.guides = guides;
          },
          panZoomState,
          rough: state.rough,
          selection: (key) => canvas.dragKeys(key),
          snap: () => canvas.snap,
          svg: graphDiv
        });
        if (graphDiv && state.panZoom) {
          handlePanZoom(state, graphDiv);
          if (appearanceViewport) panZoomState.restoreViewport(appearanceViewport);
        } else {
          panZoomState.destroy();
        }
        canvas.syncSelection();
        if (view?.parentElement && scroll) {
          view.parentElement.scrollTop = scroll;
        }
        visualLayoutKey = JSON.stringify(currentVisualLayout ?? null);
        renderedLayout = currentVisualLayout;
        error = undefined;
      } else if (manualUpdate) {
        manualUpdate = false;
      }
    } catch (error_) {
      console.error('view fail', error_);
      error = error_ instanceof Error ? error_ : new Error(String(error_));
    }
    const renderTime = Date.now() - startTime;
    saveStatistics({ code, diagramType, isRough: state.rough, renderTime });
    recordRenderTime(renderTime, () => {
      updateCodeStore({ updateDiagram: true });
    });
  };

  onMount(() => {
    setupPanZoomObserver();
    return () => {
      disposed = true;
      if (errorTimer) clearTimeout(errorTimer);
      removeVisualDragging?.();
      canvas.destroy();
      panZoomState.destroy();
      panZoomState.onPanZoomChange = undefined;
    };
  });

  // Queue state changes to avoid race condition
  let pendingStateChange = Promise.resolve();
  $effect(() => {
    const state = validatedState.current;
    const appearance = mode.current === 'dark' ? 'dark' : 'light';
    pendingStateChange = pendingStateChange.then(() =>
      handleStateChange(state, appearance).catch(() => undefined)
    );
  });

  const handleDoubleClick = (event: MouseEvent): void => {
    if (
      !onSourceSelect ||
      rough ||
      panZoomState.isSpacePanning ||
      !(event.target instanceof Element)
    )
      return;
    const range = sourceRangeForSvgTarget(code, renderedDiagramType, event.target);
    if (!range) return;
    event.preventDefault();
    onSourceSelect({ ...range, sourceCode: code });
    const line = code.slice(0, range.start).split('\n').length;
    navigationMessage = `Source selected at line ${line}`;
  };
</script>

<FontAwesome bind:waitForFontAwesomeToLoad />

<div
  id="view"
  bind:this={view}
  role="application"
  aria-label="Interactive diagram preview"
  class:source-navigation={Boolean(onSourceSelect) && !rough}
  class:canvas-presenting={canvas.presenting}
  ondblclick={handleDoubleClick}
  class={['relative h-full w-full', shouldShowGrid && `grid-bg-${mode.current}`]}>
  <div
    id="container"
    bind:this={container}
    class={[
      'absolute inset-x-0 bottom-14 overflow-hidden',
      canvas.presenting ? 'top-24' : 'top-44'
    ]}>
  </div>
  {#if !rough && hasRenderedDiagram && canvas.graph.nodes.length}<CanvasTools
      model={canvas}
      {editable}
      {onComment} />{/if}
  {#if onSourceSelect && !rough && hasRenderedDiagram && !canvas.selected.length && !canvas.presenting}
    <div
      class="pointer-events-none absolute bottom-14 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md border bg-background/90 px-2 py-1 text-center text-xs text-muted-foreground shadow-sm">
      {editable ? 'Drag entities to move · ' : ''}Scroll to zoom · Hold Space + drag to pan ·
      Double-click to open source
    </div>
    <span class="sr-only" role="status">{navigationMessage}</span>
  {/if}
  {#if error}
    <PreviewErrorOverlay
      {error}
      hasPreviousDiagram={hasRenderedDiagram}
      onSourceSelect={error && validatedState.current.errorSource === 'code'
        ? onSourceSelect
        : undefined}
      range={validatedState.current.errorRange} />
  {/if}
</div>

<style>
  .canvas-presenting {
    position: fixed;
    inset: 0;
    z-index: 100;
    background-color: var(--background);
  }
  #view:fullscreen {
    background-color: var(--background);
  }
  #view :global(.canvas-selected > rect),
  #view :global(.canvas-selected > polygon),
  #view :global(.canvas-selected .basic.label-container) {
    stroke: #0284c7 !important;
    stroke-width: 3px !important;
  }
  #view :global(.canvas-selected.attribute-name),
  #view :global(.canvas-selected.attribute-type) {
    text-decoration: underline;
    filter: drop-shadow(0 0 2px #38bdf8);
  }
  #view :global(path.canvas-selected),
  #view :global(path.canvas-related) {
    stroke: #0284c7 !important;
    /* ER cardinality markers scale with stroke width; highlight without enlarging them. */
    filter: drop-shadow(0 0 1px #0284c7);
  }
  #view :global(.canvas-dimmed) {
    opacity: 0.16;
  }
  #view :global(svg.space-pan),
  #view :global(svg.space-pan *) {
    cursor: grab !important;
  }
  #view :global(svg.space-panning),
  #view :global(svg.space-panning *) {
    cursor: grabbing !important;
  }
  .source-navigation :global([data-source-start]) {
    cursor: pointer;
  }
  .source-navigation :global(.attribute-name:hover),
  .source-navigation :global(.attribute-type:hover),
  .source-navigation :global(.attribute-keys:hover),
  .source-navigation :global(.attribute-comment:hover),
  .source-navigation :global(.edgeLabel .label[data-source-start]:hover) {
    text-decoration: underline;
  }
  .grid-bg-light {
    background-size: 30px 30px;
    background-image: radial-gradient(circle, #e4e4e48c 2px, #0000 2px);
  }

  .grid-bg-dark {
    background-size: 30px 30px;
    background-image: radial-gradient(circle, #46464646 2px, #0000 2px);
  }
</style>

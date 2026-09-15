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
  import { onMount } from 'svelte';
  import { setupVisualDragging } from '$/visual/drag';
  import { layoutEngineFromConfig, type VisualLayout } from '$/visual/layout';

  let {
    onSourceSelect,
    panZoomState = new PanZoomState(),
    shouldShowGrid = true,
    editable = false,
    visualLayout,
    onVisualLayoutChange
  }: {
    editable?: boolean;
    onSourceSelect?: (range: SourceRange) => void;
    onVisualLayoutChange?: (layout: VisualLayout) => void;
    panZoomState?: PanZoomState;
    shouldShowGrid?: boolean;
    visualLayout?: VisualLayout;
  } = $props();
  let code = '';
  let config = '';
  let container: HTMLDivElement | undefined = $state();
  let rough: boolean;
  let view: HTMLDivElement | undefined = $state();
  let error = $state<Error | undefined>();
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let hasRenderedDiagram = $state(false);
  let panZoom = true;
  let manualUpdate = true;
  let renderedDiagramType = '';
  let visualLayoutKey = '';
  let removeVisualDragging: (() => void) | undefined;
  let waitForFontAwesomeToLoad: FontAwesome['waitForFontAwesomeToLoad'] | undefined = $state();

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

  const handleStateChange = async (state: ValidatedState) => {
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
          visualLayoutKey === JSON.stringify(currentVisualLayout ?? null)
        ) {
          return;
        }

        if (!shouldRefreshView()) {
          return;
        }

        const nextCode = state.code;
        const nextConfig = state.mermaid;
        const nextPanZoom = state.panZoom ?? true;

        if (mayContainFontAwesome(nextCode)) {
          await waitForFontAwesomeToLoad?.();
        }

        const scroll = view?.parentElement?.scrollTop;
        const { diagramType: detectedDiagramType, graphDiv } = await renderAndPlaceDiagram({
          code: nextCode,
          config: JSON.parse(nextConfig) as MermaidConfig,
          container,
          rough: state.rough,
          viewId: uniqueID('graph-')
        });
        diagramType = detectedDiagramType;
        code = nextCode;
        config = nextConfig;
        rough = state.rough;
        panZoom = nextPanZoom;
        hasRenderedDiagram = true;
        renderedDiagramType = detectedDiagramType ?? '';
        if (graphDiv && detectedDiagramType) {
          annotateSvgSourceNavigation(code, detectedDiagramType, graphDiv);
        }
        removeVisualDragging?.();
        removeVisualDragging = setupVisualDragging({
          diagramType: detectedDiagramType,
          editable,
          engine: layoutEngineFromConfig(nextConfig),
          layout: currentVisualLayout,
          onChange: onVisualLayoutChange,
          panZoomState,
          rough: state.rough,
          svg: graphDiv
        });
        if (graphDiv && state.panZoom) {
          handlePanZoom(state, graphDiv);
        }
        if (view?.parentElement && scroll) {
          view.parentElement.scrollTop = scroll;
        }
        visualLayoutKey = JSON.stringify(currentVisualLayout ?? null);
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
    return () => removeVisualDragging?.();
  });

  // Queue state changes to avoid race condition
  let pendingStateChange = Promise.resolve();
  $effect(() => {
    const state = validatedState.current;
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    pendingStateChange = pendingStateChange.then(() => handleStateChange(state).catch(() => {}));
  });

  const handleDoubleClick = (event: MouseEvent): void => {
    if (!onSourceSelect || rough || !(event.target instanceof Element)) return;
    const range = sourceRangeForSvgTarget(code, renderedDiagramType, event.target);
    if (!range) return;
    event.preventDefault();
    onSourceSelect(range);
  };
</script>

<FontAwesome bind:waitForFontAwesomeToLoad />

<div
  id="view"
  bind:this={view}
  role="application"
  aria-label="Interactive diagram preview"
  ondblclick={handleDoubleClick}
  class={['relative h-full w-full', shouldShowGrid && `grid-bg-${mode.current}`]}>
  <div id="container" bind:this={container} class="h-full overflow-auto"></div>
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
  .grid-bg-light {
    background-size: 30px 30px;
    background-image: radial-gradient(circle, #e4e4e48c 2px, #0000 2px);
  }

  .grid-bg-dark {
    background-size: 30px 30px;
    background-image: radial-gradient(circle, #46464646 2px, #0000 2px);
  }
</style>

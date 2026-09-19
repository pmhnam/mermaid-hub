<script lang="ts">
  import type { CanvasModel } from '$/visual/canvasModel.svelte';
  import { elementBounds, unionBounds, type Bounds } from '$/visual/canvasGraph';
  import type { CanvasViewport } from '$/util/panZoom';
  let { model }: { model: CanvasModel } = $props();
  let open = $state(false);
  let frame = $state<CanvasViewport>();
  let nodes = $state<{ id: string; bounds: Bounds }[]>([]);
  let map: SVGSVGElement | undefined = $state();
  $effect(() => {
    const graph = model.graph;
    return model.camera.subscribe(() => {
      frame = model.camera.snapshot();
      const viewport = model.camera.viewport();
      nodes = viewport
        ? graph.nodes.map((node) => ({
            bounds: elementBounds(node.elements[0], viewport),
            id: node.id
          }))
        : [];
    });
  });
  const bounds = $derived(
    unionBounds([...nodes.map((node) => node.bounds), ...(frame ? [frame.bounds] : [])])
  );
  const navigate = (event: PointerEvent) => {
    if (!map || !bounds || !frame) return;
    const matrix = map.getScreenCTM()?.inverse();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    model.camera.centerOn(point.x, point.y);
  };
</script>

{#if nodes.length && frame}
  <div
    class="absolute right-3 bottom-16 z-20 rounded-lg border bg-background/95 shadow-sm"
    data-testid="canvas-minimap">
    <button
      class="w-full px-3 py-1 text-xs text-muted-foreground"
      aria-expanded={open}
      onclick={() => (open = !open)}>Minimap {open ? '−' : '+'}</button>
    {#if open && bounds}
      <svg
        bind:this={map}
        width="176"
        height="112"
        viewBox={`${bounds.x - 20} ${bounds.y - 20} ${bounds.width + 40} ${bounds.height + 40}`}
        role="img"
        aria-label="Diagram minimap; click to navigate"
        class="cursor-crosshair touch-none"
        onpointerdown={(event) => {
          event.preventDefault();
          map?.setPointerCapture(event.pointerId);
          navigate(event);
        }}
        onpointermove={(event) => {
          if (map?.hasPointerCapture(event.pointerId)) navigate(event);
        }}>
        {#each model.graph.edges as edge (edge.id)}
          {@const from = nodes.find((node) => node.id === edge.nodeIds[0])?.bounds}
          {@const to = nodes.find((node) => node.id === edge.nodeIds[1])?.bounds}
          {#if from && to}<line
              x1={from.x + from.width / 2}
              y1={from.y + from.height / 2}
              x2={to.x + to.width / 2}
              y2={to.y + to.height / 2}
              stroke="#94a3b8"
              vector-effect="non-scaling-stroke" />{/if}
        {/each}
        {#each nodes as node (node.id)}<rect
            {...node.bounds}
            rx="3"
            fill={model.nodeIds.includes(node.id) ? '#0284c7' : '#94a3b8'} />{/each}
        <rect
          {...frame.bounds}
          fill="#38bdf81a"
          stroke="#0284c7"
          vector-effect="non-scaling-stroke" />
      </svg>
    {/if}
  </div>
{/if}

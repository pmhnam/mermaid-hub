<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$/product/auth.svelte';
  import type { CanvasModel } from '$/visual/canvasModel.svelte';
  import { elementBounds } from '$/visual/canvasGraph';
  import { parseArrangeGraph } from '$/visual/arrangeGraph';
  import { arrangeLayout, type ArrangePreview } from '$/visual/arrangeLayout';
  import {
    completeAssignments,
    type ArrangeGraph,
    type TableAssignment
  } from '$/visual/arrangement';

  const { model, close }: { model: CanvasModel; close: () => void } = $props();
  let graph = $state.raw<ArrangeGraph>();
  let assignments = $state<TableAssignment[]>([]);
  let instruction = $state(
    'Group tables by microservice and database. Keep closely related tables together.'
  );
  let direction = $state<'RIGHT' | 'DOWN'>('RIGHT');
  let spacing = $state(80);
  let busy = $state(true);
  let error = $state('');
  let preview = $state.raw<ArrangePreview>();
  let previewInput = '';
  let baseline = '';
  let disposed = false;
  const snapshot = () => JSON.stringify([model.code, model.config, model.layout]);
  const inputs = () => JSON.stringify([assignments, direction, spacing]);
  const unchanged = () => {
    if (snapshot() !== baseline)
      throw new Error(
        'The diagram or layout changed. Close Arrange and reopen it to use the latest version.'
      );
  };
  const fail = (caught: unknown) => {
    error = caught instanceof Error ? caught.message : 'Unable to arrange diagram.';
  };

  onMount(() => {
    baseline = snapshot();
    void parseArrangeGraph(model.code, model.layout.arrangement)
      .then((parsed) => {
        if (disposed) return;
        unchanged();
        graph = parsed;
        assignments = parsed.tables.map((table) => ({
          tableId: table.id,
          service: table.service ?? '',
          database: table.database ?? ''
        }));
      })
      .catch(fail)
      .finally(() => {
        busy = false;
      });
    return () => {
      disposed = true;
    };
  });

  const suggest = async () => {
    if (!graph) return;
    busy = true;
    error = '';
    preview = undefined;
    try {
      unchanged();
      const result = await auth.api.arrangeErd({
        ...graph,
        instruction,
        tables: graph.tables.map((table) => {
          const assigned = assignments.find((item) => item.tableId === table.id);
          if (!assigned) throw new Error(`Missing ownership for ${table.id}.`);
          return { ...table, service: assigned.service.trim(), database: assigned.database.trim() };
        })
      });
      if (disposed) return;
      unchanged();
      assignments = completeAssignments(
        graph.tables.map((table) => table.id),
        result.assignments
      );
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  };

  const buildPreview = async () => {
    if (!graph) return;
    busy = true;
    error = '';
    preview = undefined;
    try {
      unchanged();
      const viewport = model.camera.viewport();
      if (!viewport) throw new Error('The canvas is not ready.');
      const measured = model.graph.nodes.map((node) => ({
        id: node.id,
        ...elementBounds(node.elements[0], viewport)
      }));
      const normalized = assignments.map((item) => ({
        ...item,
        service: item.service.trim() || 'Unclassified',
        database: item.database.trim() || 'Unclassified'
      }));
      const result = await arrangeLayout(
        graph,
        normalized,
        measured,
        model.layout,
        direction,
        spacing
      );
      if (disposed) return;
      unchanged();
      preview = result;
      previewInput = inputs();
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  };

  const apply = async () => {
    if (!preview) return;
    busy = true;
    error = '';
    try {
      unchanged();
      if (inputs() !== previewInput)
        throw new Error('Groups or layout options changed. Preview again before applying.');
      if (
        await model.editDocument({
          code: model.code,
          config: model.config,
          visualLayout: preview.layout,
          resetView: true
        })
      )
        close();
      else throw new Error(model.message);
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  };
</script>

<section
  aria-label="AI Arrange ERD"
  class="mt-2 max-h-[75vh] w-[min(36rem,calc(100vw-3rem))] space-y-3 overflow-auto rounded-lg border bg-background p-3 shadow-lg">
  <div class="flex items-center justify-between">
    <strong>AI Arrange ERD</strong><button aria-label="Close Arrange" onclick={close}>×</button>
  </div>
  <p class="text-xs text-muted-foreground">
    Assign service and database ownership, then preview. Blank ownership stays unclassified.
    Existing assignments are preserved by AI.
  </p>
  <fieldset disabled={busy} class="space-y-3">
    <label class="block text-xs"
      >Instructions<textarea
        bind:value={instruction}
        maxlength="2000"
        class="mt-1 h-16 w-full rounded border bg-background p-2"></textarea
      ></label>
    <button
      class="rounded border px-3 py-1"
      disabled={!graph || auth.current.status !== 'authenticated'}
      onclick={suggest}>Suggest groups with AI</button>
    {#if auth.current.status !== 'authenticated'}<p class="text-xs text-muted-foreground">
        Sign in to use AI suggestions. Manual grouping works without AI.
      </p>{/if}
    {#if graph}
      <div class="max-h-56 overflow-auto">
        <table class="w-full text-xs">
          <thead
            ><tr
              ><th class="text-left">Table</th><th class="text-left">Service</th><th
                class="text-left">Database</th
              ></tr
            ></thead>
          <tbody
            >{#each assignments as assignment (assignment.tableId)}
              <tr
                ><td class="max-w-40 truncate p-1" title={assignment.tableId}
                  >{assignment.tableId}</td>
                <td
                  ><input
                    aria-label={`Service for ${assignment.tableId}`}
                    bind:value={assignment.service}
                    maxlength="120"
                    placeholder="Unclassified"
                    class="w-full min-w-20 rounded border bg-background p-1" /></td>
                <td
                  ><input
                    aria-label={`Database for ${assignment.tableId}`}
                    bind:value={assignment.database}
                    maxlength="120"
                    placeholder="Unclassified"
                    class="w-full min-w-20 rounded border bg-background p-1" /></td
                ></tr>
            {/each}</tbody>
        </table>
      </div>
    {/if}
    <div class="flex flex-wrap items-center gap-3">
      <label class="text-xs"
        >Direction <select bind:value={direction} class="rounded border bg-background p-1"
          ><option value="RIGHT">Horizontal</option><option value="DOWN">Vertical</option></select
        ></label>
      <label class="text-xs"
        >Spacing <select bind:value={spacing} class="rounded border bg-background p-1"
          ><option value={50}>Compact</option><option value={80}>Normal</option><option value={120}
            >Spacious</option
          ></select
        ></label>
      <button class="rounded border px-3 py-1" disabled={!graph} onclick={buildPreview}
        >Preview layout</button>
    </div>
    {#if preview}
      <svg
        role="img"
        aria-label="Proposed table positions"
        viewBox={`0 0 ${preview.width} ${preview.height}`}
        class="h-56 w-full rounded border bg-muted/20">
        {#each graph?.edges ?? [] as edge, index (index)}
          {@const from = preview.nodes.find((node) => node.id === edge.source)}
          {@const to = preview.nodes.find((node) => node.id === edge.target)}
          {#if from && to}<line
              x1={from.x + from.width / 2}
              y1={from.y + from.height / 2}
              x2={to.x + to.width / 2}
              y2={to.y + to.height / 2}
              stroke="#94a3b8"
              stroke-width="2" />{/if}
        {/each}
        {#each preview.nodes as node (node.id)}
          <g
            ><title>{node.id}</title><rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx="8"
              fill="#dbeafe"
              stroke="#3b82f6" /><text x={node.x + 8} y={node.y + 22} font-size="16" fill="#0f172a"
              >{node.id}</text
            ></g>
        {/each}
      </svg>
      <p class="text-xs text-muted-foreground">
        Position preview; relationship paths are recalculated on the canvas. Source tables and
        relationships are preserved.
      </p>
      <button class="rounded border bg-primary px-3 py-1 text-primary-foreground" onclick={apply}
        >Apply arrangement</button>
    {/if}
  </fieldset>
  {#if busy}<p role="status" class="text-xs">Working…</p>{/if}
  {#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
</section>

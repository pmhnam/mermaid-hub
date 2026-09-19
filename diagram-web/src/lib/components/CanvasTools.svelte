<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { CanvasModel } from '$/visual/canvasModel.svelte';
  import type { CanvasViewport } from '$/util/panZoom';
  import { renameErEntity, replaceSourceRange, themeDocument } from '$/visual/documentEdits';
  import { SOURCE_SELECTION_EVENT, type SourceCursor } from '$/util/canvasEvents';
  import CanvasMinimap from './CanvasMinimap.svelte';
  import ExportDialog from '$/product/ExportDialog.svelte';
  let {
    model,
    editable,
    onComment
  }: { model: CanvasModel; editable: boolean; onComment?: (target?: string) => void } = $props();
  let input: HTMLInputElement | undefined = $state();
  let text = $state('');
  let entityName = $state('');
  let working = $state(false);
  let exportOpen = $state(false);
  let viewport = $state<CanvasViewport>();
  const item = $derived(model.selection[0]);
  const results = $derived(
    model.graph.items
      .filter((entry) =>
        `${entry.label} ${entry.nodeIds.join(' ')}`
          .toLocaleLowerCase()
          .includes(model.query.toLocaleLowerCase())
      )
      .slice(0, 60)
  );
  $effect(() => {
    text = item?.range ? model.code.slice(item.range.start, item.range.end) : '';
    entityName = item?.nodeIds[0] ?? '';
  });
  $effect(() =>
    model.camera.subscribe(() => {
      viewport = model.camera.snapshot();
    })
  );
  const open = async (panel: 'search' | 'properties' | 'commands') => {
    model.panel = model.panel === panel ? null : panel;
    model.menu = undefined;
    await tick();
    input?.focus();
  };
  const present = async () => {
    model.presenting = !model.presenting;
    if (model.presenting) {
      model.panel = null;
      await model.svg
        ?.closest<HTMLElement>('#view')
        ?.requestFullscreen?.()
        .catch(() => undefined);
    } else if (document.fullscreenElement) await document.exitFullscreen();
    await tick();
    model.camera.resize();
  };
  const apply = async (rename = false) => {
    if (!item) return;
    if (!item?.range && !rename) return;
    working = true;
    const nextName = entityName.trim();
    try {
      const code = rename
        ? renameErEntity(model.code, item.nodeIds[0], nextName)
        : item.range
          ? replaceSourceRange(model.code, item.range.start, item.range.end, text)
          : model.code;
      const oldName = item.nodeIds[0];
      const offsets = Object.fromEntries(
        Object.entries(model.layout.offsets).map(([key, value]) => [
          key === oldName ? nextName : key,
          value
        ])
      );
      const edgeRoutes = model.layout.edgeRoutes
        ? Object.fromEntries(
            Object.entries(model.layout.edgeRoutes).map(([key, points]) => {
              try {
                const parts: unknown = JSON.parse(key);
                if (Array.isArray(parts) && parts.length === 3)
                  return [
                    JSON.stringify([
                      parts[0] === oldName ? nextName : parts[0],
                      parts[1] === oldName ? nextName : parts[1],
                      parts[2]
                    ]),
                    points
                  ];
              } catch {
                /* Keep keys from older documents intact. */
              }
              return [key, points];
            })
          )
        : undefined;
      const applied = await model.editDocument({
        code,
        config: model.config,
        ...(rename
          ? { visualLayout: { ...model.layout, ...(edgeRoutes ? { edgeRoutes } : {}), offsets } }
          : {})
      });
      if (applied && rename) model.selected = [nextName];
    } catch (error) {
      model.message = error instanceof Error ? error.message : 'Unable to edit entity';
    } finally {
      working = false;
    }
  };
  const color = async (fill: string) => {
    const ids = model.nodeIds.filter((id) => /^[\w.-]+$/.test(id));
    if (!ids.length) {
      model.message = 'This identifier needs styling through the code editor.';
      return;
    }
    await model.editDocument({
      code: `${model.code}\nstyle ${ids.join(',')} fill:${fill},stroke:#64748b,color:#0f172a\n`,
      config: model.config
    });
  };
  const colorSchemas = async () => {
    const groups = new SvelteMap<string, string[]>();
    for (const node of model.graph.nodes) {
      if (!/^[\w.-]+$/.test(node.id)) continue;
      const schema = node.id.includes('.') ? node.id.split('.')[0] : 'default';
      groups.set(schema, [...(groups.get(schema) ?? []), node.id]);
    }
    const palette = ['#dbeafe', '#ede9fe', '#dcfce7', '#fef3c7', '#fce7f3'];
    const styles = [...groups.values()].map(
      (ids, index) =>
        `style ${ids.join(',')} fill:${palette[index % palette.length]},stroke:#64748b,color:#0f172a`
    );
    await model.editDocument({
      code: `${model.code}\n${styles.join('\n')}\n`,
      config: model.config
    });
  };
  const commands = $derived([
    {
      label: 'Find in diagram',
      run: () => {
        model.panel = 'search';
        model.query = '';
      }
    },
    { label: 'Fit all', run: () => model.camera.reset() },
    { label: 'Fit selection', run: () => model.camera.fitSelection() },
    { label: 'Zoom to 100%', run: () => model.camera.setPercent(100) },
    { label: 'Focus related tables', run: () => model.focus(1) },
    { label: 'Show all tables', run: () => model.focus(0) },
    { label: 'Go to source', run: () => model.source() },
    {
      label: 'Export diagram',
      run: () => {
        exportOpen = true;
      }
    },
    {
      label: 'Presentation mode',
      run: () => {
        void present();
      }
    },
    ...(editable
      ? [
          { label: 'Undo layout', run: () => model.undo() },
          { label: 'Redo layout', run: () => model.undo(true) },
          { label: 'Reset selected positions', run: () => model.resetPositions() },
          {
            label: 'Use hierarchical layout (Dagre)',
            run: () => {
              void model.changeEngine('dagre');
            }
          },
          {
            label: 'Use adaptive layout (ELK)',
            run: () => {
              void model.changeEngine('elk');
            }
          }
        ]
      : [])
  ]);
  onMount(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      const typing = Boolean(
        target?.closest('input, textarea, [contenteditable="true"], [role="textbox"]')
      );
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
        event.preventDefault();
        event.stopImmediatePropagation();
        void open('commands');
        return;
      }
      if (typing) return;
      if (event.key === 'Escape') {
        model.menu = undefined;
        model.panel = null;
        if (model.presenting) void present();
        else model.select();
      }
      const onCanvas =
        model.svg?.matches(':hover') ||
        model.svg?.contains(document.activeElement) ||
        target?.closest('[data-canvas-tools]');
      if (!onCanvas) return;
      if (event.key === 'F2' && editable && item) {
        event.preventDefault();
        void open('properties');
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && editable) {
        event.preventDefault();
        model.undo(event.shiftKey);
      }
    };
    const source = (event: Event) => model.fromSource((event as CustomEvent<SourceCursor>).detail);
    const fullscreen = () => {
      if (!document.fullscreenElement) model.presenting = false;
    };
    const locate = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const match = model.graph.nodes.find((node) => node.id === id);
      if (match) model.locate(match);
      else model.message = 'This entity is no longer in the diagram.';
    };
    const layout = (event: Event) => {
      const engine = (event as CustomEvent<string>).detail;
      if (!editable || (engine !== 'elk' && engine !== 'dagre')) return;
      event.preventDefault();
      void model.changeEngine(engine);
    };
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener(SOURCE_SELECTION_EVENT, source);
    window.addEventListener('mermaid-locate-node', locate);
    window.addEventListener('mermaid-change-layout', layout);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => {
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener(SOURCE_SELECTION_EVENT, source);
      window.removeEventListener('mermaid-locate-node', locate);
      window.removeEventListener('mermaid-change-layout', layout);
      document.removeEventListener('fullscreenchange', fullscreen);
    };
  });
</script>

<div data-canvas-tools class="absolute top-14 left-3 z-30 max-w-[calc(100%-1.5rem)] text-sm">
  <div class="flex flex-wrap items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-sm">
    <button
      class="tool"
      aria-label="Find in diagram"
      aria-expanded={model.panel === 'search'}
      onclick={() => open('search')}>Find</button>
    <button class="tool" title="Commands (Ctrl/⌘ K)" onclick={() => open('commands')}>⌘K</button>
    {#if editable}<button class="tool" onclick={() => open('properties')}>Style</button>{/if}
    {#if editable && !model.presenting}
      <button
        class="tool"
        disabled={!model.canUndo}
        aria-label="Undo layout"
        onclick={() => model.undo()}>↶</button>
      <button
        class="tool"
        disabled={!model.canRedo}
        aria-label="Redo layout"
        onclick={() => model.undo(true)}>↷</button>
      <button class="tool" aria-pressed={model.snap} onclick={() => (model.snap = !model.snap)}
        >Snap</button>
    {/if}
    <button class="tool" onclick={present}
      >{model.presenting ? 'Exit presentation' : 'Present'}</button>
  </div>
  {#if model.panel}
    <section
      class="mt-2 max-h-[min(65vh,32rem)] w-72 max-w-full space-y-2 overflow-auto rounded-lg border bg-background p-3 shadow-lg"
      aria-label={model.panel === 'properties'
        ? 'Selection properties'
        : model.panel === 'commands'
          ? 'Commands'
          : 'Diagram search'}>
      <div class="flex items-center justify-between">
        <strong
          >{model.panel === 'properties'
            ? 'Properties'
            : model.panel === 'commands'
              ? 'Commands'
              : 'Explore diagram'}</strong
        ><button class="tool" aria-label="Close canvas panel" onclick={() => (model.panel = null)}
          >×</button>
      </div>
      {#if model.panel !== 'properties'}
        <input
          bind:this={input}
          bind:value={model.query}
          aria-label="Search diagram or command"
          placeholder={model.panel === 'commands'
            ? 'Type a command…'
            : 'Table, field, relationship…'}
          class="w-full rounded border bg-background p-2 text-sm"
          onkeydown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>('[data-result]')
                ?.focus();
            }
            if (event.key === 'Escape') model.panel = null;
          }} />
        {#if model.panel === 'commands'}
          {#each commands.filter((command) => command.label
              .toLowerCase()
              .includes(model.query.toLowerCase())) as command (command.label)}<button
              data-result
              class="result"
              onclick={() => {
                model.panel = null;
                command.run();
              }}>{command.label}</button
            >{/each}
          {#if model.query.trim()}{#each results.slice(0, 15) as result (result.id)}<button
                data-result
                class="result"
                onclick={() => {
                  model.locate(result);
                  model.panel = null;
                }}>Find {result.label}</button
              >{/each}{/if}
        {:else}
          <p class="text-xs text-muted-foreground">
            {model.graph.nodes.length} tables/nodes · {model.graph.edges.length} relationships
          </p>
          {#each results as result (result.id)}<button
              data-result
              class="result"
              aria-label={`Find ${result.label}`}
              onclick={() => model.locate(result)}
              ><span class="block truncate">{result.label}</span><span
                class="text-xs text-muted-foreground"
                >{result.kind}{result.kind === 'field' ? ` · ${result.nodeIds[0]}` : ''}</span
              ></button
            >{:else}<p class="p-2 text-muted-foreground">No matches.</p>{/each}
          {#if results.length === 60}<p class="text-xs text-muted-foreground">
              Showing first 60 matches. Refine your search.
            </p>{/if}
        {/if}
      {:else}
        {#if item}
          <p class="break-words font-medium">{item.label}</p>
          {#if editable && model.type.startsWith('er') && item.kind === 'node'}
            <label class="block text-xs"
              >Entity name<input
                class="mt-1 w-full rounded border bg-background p-2"
                bind:value={entityName} /></label>
            <button class="tool" disabled={working} onclick={() => apply(true)}
              >Rename entity</button>
          {/if}
          {#if item.range}<label class="block text-xs"
              >Source for selection<textarea
                class="mt-1 h-24 w-full rounded border bg-background p-2 font-mono"
                bind:value={text}
                readonly={!editable}></textarea
              ></label
            >{/if}
          {#if editable && item.range}<button
              class="tool"
              disabled={working}
              onclick={() => apply()}>Apply source edit</button
            >{/if}
          <button class="tool" onclick={() => model.source()}>Go to source</button>
          {#if editable && /^(er|flowchart)/.test(model.type)}
            <p class="text-xs text-muted-foreground">Selected table/node color</p>
            <div class="flex gap-2">
              {#each ['#dbeafe', '#ede9fe', '#dcfce7', '#fef3c7', '#f1f5f9'] as fill (fill)}<button
                  aria-label={`Apply color ${fill}`}
                  class="size-7 rounded border"
                  style:background-color={fill}
                  onclick={() => color(fill)}></button
                >{/each}
            </div>
          {/if}
        {:else}<p class="text-muted-foreground">Select an entity or relationship.</p>{/if}
        {#if editable}<label class="block text-xs"
            >Diagram theme<select
              class="mt-1 w-full rounded border bg-background p-2"
              aria-label="Diagram theme"
              onchange={(event) => {
                void model.editDocument(
                  themeDocument(
                    { code: model.code, config: model.config },
                    event.currentTarget.value as 'default' | 'dark' | 'forest' | 'neutral'
                  )
                );
              }}
              ><option value="" disabled selected>Choose theme</option
              >{#each ['default', 'dark', 'forest', 'neutral'] as theme (theme)}<option
                  value={theme}>{theme}</option
                >{/each}</select
            ></label
          >{/if}
        {#if editable && model.type.startsWith('er')}<button class="tool" onclick={colorSchemas}
            >Color by schema</button
          >{/if}
      {/if}
    </section>
  {/if}
  {#if model.selected.length && !model.presenting}
    <div
      class="mt-1 flex max-w-full flex-wrap items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-sm">
      <div class="flex items-center justify-between gap-2">
        <span class="max-w-32 truncate text-xs font-medium"
          >{model.selected.length > 1
            ? `${model.nodeIds.length} nodes selected`
            : item?.label}</span
        ><button class="tool" aria-label="Clear selection" onclick={() => model.select()}>×</button>
      </div>
      <div class="flex flex-wrap gap-1">
        <button class="tool" onclick={() => model.camera.fitSelection()}>Fit selection</button>
        <button
          class="tool"
          aria-pressed={model.focusDepth === 1}
          onclick={() => model.focus(model.focusDepth === 1 ? 0 : 1)}>Related</button>
        {#if model.focusDepth}<button
            class="tool"
            onclick={() => model.focus(model.focusDepth === 2 ? 1 : 2)}
            >{model.focusDepth === 2 ? '1 level' : '2 levels'}</button
          ><button class="tool" onclick={() => model.focus(0)}>Show all</button>{/if}
        <button class="tool" onclick={() => open('properties')}>Properties</button>
        {#if editable && model.selectedEdge}
          <button class="tool" onclick={() => model.addEdgeBend()}>Add bend</button>
          <button class="tool" onclick={() => model.resetEdgeRoute()}>Reset line</button>
          <span class="hidden self-center text-xs text-muted-foreground sm:inline"
            >Drag the blue handles · Delete removes a bend</span>
        {/if}
        {#if onComment}<button class="tool" onclick={() => onComment?.(model.nodeIds[0])}
            >Comment</button
          >{/if}
      </div>
      {#if editable && model.nodeIds.length > 1 && !model.selectedEdge}<div
          class="flex flex-wrap gap-1">
          {#each ['left', 'right', 'top', 'bottom', 'horizontal', 'vertical'] as alignment (alignment)}<button
              class="tool"
              aria-label={`Align ${alignment}`}
              onclick={() =>
                model.align(
                  alignment as 'left' | 'right' | 'top' | 'bottom' | 'horizontal' | 'vertical'
                )}>{alignment}</button
            >{/each}
        </div>{/if}
    </div>
  {/if}
  {#if model.message}<p
      class="mt-2 max-w-72 rounded border bg-background p-2 text-xs"
      role="status">
      {model.message}<button
        class="ml-2"
        aria-label="Dismiss message"
        onclick={() => (model.message = '')}>×</button>
    </p>{/if}
</div>
{#if model.menu}<div
    data-canvas-tools
    class="absolute z-40 w-44 rounded-lg border bg-background p-1 text-sm shadow-lg"
    style:left={`${model.menu.x}px`}
    style:top={`${model.menu.y}px`}
    role="menu">
    <button
      class="result"
      role="menuitem"
      onclick={() => {
        model.source();
        model.menu = undefined;
      }}>Go to source</button>
    <button
      class="result"
      role="menuitem"
      onclick={() => {
        model.camera.fitSelection();
        model.menu = undefined;
      }}>Fit selection</button>
    <button
      class="result"
      role="menuitem"
      onclick={() => {
        model.focus(1);
        model.menu = undefined;
      }}>Focus related</button>
    <button class="result" role="menuitem" onclick={() => open('properties')}>Properties</button>
    {#if editable && model.selectedEdge}<button
        class="result"
        role="menuitem"
        onclick={() => {
          model.addEdgeBend();
          model.menu = undefined;
        }}>Add bend</button
      ><button
        class="result"
        role="menuitem"
        onclick={() => {
          model.resetEdgeRoute();
          model.menu = undefined;
        }}>Reset line</button
      >{/if}
    {#if editable && !model.selectedEdge}<button
        class="result"
        role="menuitem"
        onclick={() => {
          model.resetPositions();
          model.menu = undefined;
        }}>Reset positions</button
      >{/if}
  </div>{/if}
{#if !model.presenting}<CanvasMinimap {model} />{/if}
<ExportDialog
  code={model.code}
  config={model.config}
  bind:open={exportOpen}
  svgElement={model.svg ?? null}
  getSvgElement={() => model.svg ?? null}
  title="Diagram" />
{#if viewport && (model.guides.x !== undefined || model.guides.y !== undefined)}
  <svg
    class="pointer-events-none absolute inset-x-0 z-10 w-full"
    style:top={`${viewport.offset.y}px`}
    height={(viewport.bounds.height * viewport.percent) / 100}
    aria-hidden="true">
    {#if model.guides.x !== undefined}<line
        x1={((model.guides.x - viewport.bounds.x) * viewport.percent) / 100}
        x2={((model.guides.x - viewport.bounds.x) * viewport.percent) / 100}
        y1="0"
        y2="100%"
        stroke="#0284c7"
        stroke-dasharray="4" />{/if}
    {#if model.guides.y !== undefined}<line
        y1={((model.guides.y - viewport.bounds.y) * viewport.percent) / 100}
        y2={((model.guides.y - viewport.bounds.y) * viewport.percent) / 100}
        x1="0"
        x2="100%"
        stroke="#0284c7"
        stroke-dasharray="4" />{/if}
  </svg>
{/if}

<style>
  .tool {
    border-radius: 0.25rem;
    padding: 0.35rem 0.5rem;
    font-size: 0.75rem;
  }
  .tool:hover,
  .result:hover,
  .tool[aria-pressed='true'] {
    background: var(--muted);
  }
  .tool:disabled {
    opacity: 0.35;
  }
  .result {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.45rem;
    border-radius: 0.25rem;
  }
</style>

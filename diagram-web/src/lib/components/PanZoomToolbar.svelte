<script lang="ts">
  import FloatingToolbar from '$/components/FloatingToolbar.svelte';
  import { Button } from '$/components/ui/button';
  import { Separator } from '$/components/ui/separator';
  import type { PanZoomState } from '$/util/panZoom';
  import * as Popover from '$/components/ui/popover';
  import ExpandIcon from '~icons/material-symbols/open-in-full-rounded';
  import ArrowsToCircleIcon from '~icons/material-symbols/screenshot-frame-2';
  import MagnifyingGlassPlusIcon from '~icons/material-symbols/zoom-in';
  import MagnifyingGlassMinusIcon from '~icons/material-symbols/zoom-out';

  let {
    /** Embed/narrow frames: keep zoom buttons visible below the `sm` breakpoint. */
    compact = false,
    fullScreenHref,
    panZoomState
  }: {
    compact?: boolean;
    /** When set, shows a "Full Screen" button linking here. Omit for store-free embeds. */
    fullScreenHref?: string;
    panZoomState: PanZoomState;
  } = $props();

  const zoomClass = $derived(compact ? 'size-8' : 'hidden sm:block');
  let percent = $state(100);
  let enabled = $state(false);
  let hasSelection = $state(false);
  $effect(() =>
    panZoomState.subscribe(() => {
      const value = panZoomState.snapshot();
      enabled = Boolean(value);
      percent = Math.round(value?.percent ?? 100);
      hasSelection = panZoomState.hasSelection;
    })
  );
</script>

<FloatingToolbar {compact}>
  <Button
    variant="ghost"
    size="icon"
    class={compact ? 'size-8' : undefined}
    title="Reset view"
    onclick={() => panZoomState.reset()}>
    <ArrowsToCircleIcon />
  </Button>
  <Popover.Root>
    <Popover.Trigger
      class="h-8 min-w-11 rounded px-1 text-xs tabular-nums hover:bg-accent"
      disabled={!enabled}
      aria-label="Zoom options">{percent}%</Popover.Trigger>
    <Popover.Content class="w-44 space-y-2 p-2">
      <label class="flex items-center gap-2 text-xs"
        >Zoom %<input
          class="w-20 rounded border p-1"
          aria-label="Zoom percentage"
          type="number"
          min="5"
          max="400"
          value={percent}
          onchange={(event) =>
            panZoomState.setPercent(Number(event.currentTarget.value))} /></label>
      {#each [25, 50, 100, 200] as value (value)}<button
          class="block w-full rounded p-1 text-left text-sm hover:bg-accent"
          onclick={() => panZoomState.setPercent(value)}>{value}%</button
        >{/each}
      <button
        class="block w-full rounded p-1 text-left text-sm hover:bg-accent"
        onclick={() => panZoomState.reset()}>Fit all</button>
      <button
        class="block w-full rounded p-1 text-left text-sm hover:bg-accent disabled:opacity-40"
        disabled={!hasSelection}
        onclick={() => panZoomState.fitSelection()}>Fit selection</button>
    </Popover.Content>
  </Popover.Root>
  <Separator orientation="vertical" />
  <Button
    variant="ghost"
    size="icon"
    class={zoomClass}
    title="Zoom out"
    onclick={() => panZoomState.zoomOut()}>
    <MagnifyingGlassMinusIcon />
  </Button>
  <Button
    variant="ghost"
    size="icon"
    class={zoomClass}
    title="Zoom in"
    onclick={() => panZoomState.zoomIn()}>
    <MagnifyingGlassPlusIcon />
  </Button>
  {#if fullScreenHref}
    <Separator orientation="vertical" class={compact ? undefined : 'hidden sm:block'} />
    <Button
      variant="ghost"
      size="icon"
      class={compact ? 'size-8' : undefined}
      title="Full Screen"
      href={fullScreenHref}
      target="_blank">
      <ExpandIcon />
    </Button>
  {/if}
</FloatingToolbar>

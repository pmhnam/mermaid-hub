<script lang="ts">
  import type { SourceRange } from '$/types';
  import { Button } from '$/components/ui/button';
  import ErrorIcon from '~icons/material-symbols/error-outline-rounded';

  let {
    error,
    hasPreviousDiagram,
    onSourceSelect,
    range
  }: {
    error: Error;
    hasPreviousDiagram: boolean;
    onSourceSelect?: (range: SourceRange) => void;
    range?: SourceRange;
  } = $props();
</script>

<div
  class="absolute top-3 right-3 left-3 z-10 flex items-start gap-3 rounded-lg border border-destructive/40 bg-background/95 p-3 text-sm shadow-lg backdrop-blur-sm sm:right-6 sm:left-6"
  role="status"
  aria-live="polite"
  aria-atomic="true">
  <ErrorIcon class="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
  <div class="min-w-0 flex-1">
    <p class="font-medium">Preview could not be updated</p>
    <p class="text-muted-foreground">
      {hasPreviousDiagram
        ? 'Showing the last valid diagram.'
        : 'Fix the error to render this diagram.'}
    </p>
    <p class="mt-1 truncate text-xs text-muted-foreground" title={error.message}>{error.message}</p>
  </div>
  {#if range && onSourceSelect}
    <Button size="sm" variant="outline" class="shrink-0" onclick={() => onSourceSelect?.(range)}
      >Jump to error</Button>
  {/if}
</div>

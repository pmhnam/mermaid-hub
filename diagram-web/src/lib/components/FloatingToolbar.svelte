<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    compact?: boolean;
  }

  let { children, compact = false }: Props = $props();
</script>

<div
  class={[
    'flex shrink-0 items-center justify-between',
    compact
      ? 'h-10 gap-1 rounded-lg border bg-background/95 p-1 shadow-sm'
      : 'h-12 gap-2 rounded-2xl bg-muted p-1.5'
  ]}>
  {@render children()}
</div>

<script lang="ts">
  import { Toaster } from '$lib/components/ui/sonner';
  import { ModeWatcher } from 'mode-watcher';
  import type { Snippet } from 'svelte';

  const { children }: { children: Snippet } = $props();
</script>

<ModeWatcher />
<Toaster />
{@render children()}

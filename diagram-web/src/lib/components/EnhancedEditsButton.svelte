<script lang="ts">
  import { Button } from '$/components/ui/button';
  import { validatedState, urls } from '$/util/state.svelte';
</script>

{#if validatedState.current.diagramType}
  <Button variant="secondary" size="sm" href={urls.current.workspaceImport}>
    Save to workspace
  </Button>
{/if}

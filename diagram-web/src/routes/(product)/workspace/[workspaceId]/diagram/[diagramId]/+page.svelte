<script lang="ts">
  import ProductDiagramEditor from '$lib/product/ProductDiagramEditor.svelte';

  const { params }: { params: { diagramId: string; workspaceId: string } } = $props();
</script>

{#key params.diagramId}
  <ProductDiagramEditor diagramId={params.diagramId} workspaceId={params.workspaceId} />
{/key}

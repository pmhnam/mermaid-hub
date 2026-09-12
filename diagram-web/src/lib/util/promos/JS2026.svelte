<script lang="ts">
  import { Button } from '$/components/ui/button';
  import { resolve } from '$app/paths';
  import type { Snippet } from 'svelte';

  interface Props {
    closeBanner: Snippet;
  }

  let { closeBanner }: Props = $props();

  const url = resolve('/register', {});
</script>

<div class="flex w-full items-center bg-[#E0095F] p-1.5" role="banner">
  <div class="grid grow">
    <a
      href={url}
      target="_blank"
      class="col-start-1 row-start-1 flex items-center justify-center gap-4 no-underline">
      <span class="text-base tracking-wider text-white">
        Save and collaborate in Mermaid Workspace
      </span>
      <Button
        class="shrink-0 rounded-md bg-[#1E1A2E] px-3 py-1.5 text-base font-semibold tracking-wide text-white hover:bg-[#261A56]">
        Create account
      </Button>
    </a>
  </div>
  {@render closeBanner()}
</div>

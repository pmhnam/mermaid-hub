<script lang="ts">
  import { Button } from '$/components/ui/button';
  import { resolve } from '$app/paths';
  import { onDestroy, type Snippet } from 'svelte';
  import { fade } from 'svelte/transition';

  interface Props {
    closeBanner: Snippet;
  }

  let { closeBanner }: Props = $props();

  interface Taglines {
    label: string;
  }

  let taglines: Taglines[] = [
    { label: 'Save and organize your diagrams in Mermaid Workspace' },
    { label: 'Collaborate with your team in Mermaid Workspace' },
    { label: 'Keep your diagrams available across devices' }
  ];

  const getRandomIndex = (array: unknown[]) => Math.floor(Math.random() * array.length);

  let index = $state(getRandomIndex(taglines));
  let currentTagline = $derived(taglines[index]);
  let shouldAnimate = $state(true);

  const interval = setInterval(() => {
    if (shouldAnimate) {
      index = (index + 1) % taglines.length;
    }
  }, 5000);

  onDestroy(() => {
    clearInterval(interval);
  });

  const taglineHref = resolve('/register', {});
</script>

<div
  class="flex w-full items-center bg-[#E0095F] p-1.5"
  role="banner"
  onmouseenter={() => (shouldAnimate = false)}
  onmouseleave={() => (shouldAnimate = true)}>
  <div class="grid grow">
    {#key currentTagline}
      <a
        href={taglineHref}
        class="col-start-1 row-start-1 flex items-center justify-center gap-4 no-underline"
        in:fade={{ delay: 800 }}
        out:fade={{ duration: 1000 }}>
        <span class="text-base tracking-wider text-white">{currentTagline.label}</span>
        <Button
          class="shrink-0 rounded-md bg-[#1E1A2E] px-3 py-1.5 text-base font-semibold tracking-wide text-white hover:bg-[#261A56]">
          Try now
        </Button>
      </a>
    {/key}
  </div>
  {@render closeBanner()}
</div>

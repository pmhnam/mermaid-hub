<script lang="ts">
  import { setMode, userPrefersMode } from 'mode-watcher';
  import * as Popover from '$/components/ui/popover';
  import ThemeIcon from './ThemeIcon.svelte';
  let { compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean } = $props();
</script>

{#if iconOnly}
  <Popover.Root>
    <Popover.Trigger
      aria-label="Appearance"
      title={`Appearance: ${userPrefersMode.current}`}
      class="grid size-8 shrink-0 place-items-center rounded-md border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 [&_svg]:size-4"
      ><ThemeIcon /></Popover.Trigger>
    <Popover.Content side="right" align="start" class="w-32 p-1">
      {#each ['light', 'dark', 'system'] as preference (preference)}
        <Popover.Close
          class="block w-full rounded px-3 py-2 text-left text-sm capitalize hover:bg-muted"
          aria-pressed={userPrefersMode.current === preference}
          onclick={() => setMode(preference as 'light' | 'dark' | 'system')}
          >{preference[0].toUpperCase() + preference.slice(1)}</Popover.Close>
      {/each}
    </Popover.Content>
  </Popover.Root>
{:else}
  <label
    class="inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
    title="Appearance">
    <span class:sr-only={compact}>Appearance</span>
    <select
      aria-label="Appearance"
      class="h-8 rounded-md border border-input bg-background px-2 text-foreground"
      value={userPrefersMode.current}
      onchange={(event) => setMode(event.currentTarget.value as 'light' | 'dark' | 'system')}>
      <option value="system">System</option><option value="light">Light</option><option value="dark"
        >Dark</option>
    </select>
  </label>
{/if}

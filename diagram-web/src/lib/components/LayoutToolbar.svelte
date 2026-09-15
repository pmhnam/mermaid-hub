<script lang="ts">
  import { buttonVariants } from '$/components/ui/button';
  import * as Popover from '$/components/ui/popover';
  import {
    isVisualLayoutSupported,
    layoutEngineFromConfig,
    type LayoutEngine
  } from '$/visual/layout';
  import { cn } from '$lib/utils';
  import AccountTreeIcon from '~icons/material-symbols/account-tree-outline-rounded';
  import CheckIcon from '~icons/material-symbols/check-rounded';
  import KeyboardArrowDownIcon from '~icons/material-symbols/keyboard-arrow-down-rounded';

  let {
    config,
    diagramType,
    disabled = false,
    onChange
  }: {
    config: string;
    diagramType?: string;
    disabled?: boolean;
    onChange: (engine: LayoutEngine) => void;
  } = $props();

  const engines: { description: string; engine: LayoutEngine; label: string }[] = [
    {
      description: 'Arranges nodes in ordered levels following their hierarchy.',
      engine: 'dagre',
      label: 'Hierarchical'
    },
    {
      description: 'Rearranges nodes based on their context and connections.',
      engine: 'elk',
      label: 'Adaptive'
    }
  ];
  const selected = $derived(layoutEngineFromConfig(config));
  const unsupported = $derived(diagramType !== undefined && !isVisualLayoutSupported(diagramType));

  const choose = (engine: LayoutEngine): void => {
    if (!disabled && !unsupported && engine !== selected) onChange(engine);
  };
</script>

<Popover.Root>
  <Popover.Trigger
    disabled={disabled || unsupported}
    aria-label="Choose layout"
    title={unsupported ? 'Layout is managed by this diagram type' : 'Layout'}
    class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 gap-1 px-2')}>
    <AccountTreeIcon />
    <span class="hidden sm:inline">Layout</span>
    <KeyboardArrowDownIcon class="size-4" />
  </Popover.Trigger>
  <Popover.Content side="top" align="end" class="w-72 p-1">
    <div class="px-3 py-2 text-xs font-semibold text-muted-foreground">Layout</div>
    {#each engines as option (option.engine)}
      <Popover.Close
        disabled={disabled || unsupported}
        class={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'h-auto w-full justify-start p-2'
        )}
        onclick={() => choose(option.engine)}>
        <AccountTreeIcon class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1 text-left">
          <span class="block">{option.label}</span>
          <span class="mt-0.5 block text-[11px] font-normal leading-4 text-muted-foreground"
            >{option.description}</span>
        </span>
        {#if selected === option.engine}<CheckIcon class="size-5 shrink-0" />{/if}
      </Popover.Close>
    {/each}
  </Popover.Content>
</Popover.Root>

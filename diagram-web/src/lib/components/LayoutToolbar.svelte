<script lang="ts">
  import { buttonVariants } from '$/components/ui/button';
  import * as Popover from '$/components/ui/popover';
  import {
    isVisualLayoutSupported,
    layoutEngineFromDocument,
    type LayoutEngine
  } from '$/visual/layout';
  import { cn } from '$lib/utils';
  import AccountTreeIcon from '~icons/material-symbols/account-tree-outline-rounded';
  import CheckIcon from '~icons/material-symbols/check-rounded';
  import KeyboardArrowDownIcon from '~icons/material-symbols/keyboard-arrow-down-rounded';

  let {
    config,
    code,
    diagramType,
    disabled = false,
    onChange
  }: {
    config: string;
    code: string;
    diagramType?: string;
    disabled?: boolean;
    onChange: (engine: LayoutEngine) => void;
  } = $props();

  const engines: { description: string; engine: LayoutEngine; label: string }[] = [
    {
      description: 'Dagre · Arrange tables and nodes in ordered levels.',
      engine: 'dagre',
      label: 'Hierarchical'
    },
    {
      description: 'ELK · Arrange connected tables and nodes automatically.',
      engine: 'elk',
      label: 'Adaptive'
    }
  ];
  const selected = $derived(layoutEngineFromDocument(code, config));
  const unsupported = $derived(diagramType !== undefined && !isVisualLayoutSupported(diagramType));

  const choose = (engine: LayoutEngine): void => {
    if (disabled || unsupported || engine === selected) return;
    const unhandled = window.dispatchEvent(
      new CustomEvent('mermaid-change-layout', { cancelable: true, detail: engine })
    );
    if (unhandled) onChange(engine);
  };
</script>

<Popover.Root>
  <Popover.Trigger
    disabled={disabled || unsupported}
    aria-label="Choose layout"
    title={unsupported
      ? 'Layout is managed by this diagram type'
      : disabled
        ? 'Layout is read-only'
        : 'Choose automatic layout'}
    class={cn(
      buttonVariants({ variant: 'outline', size: 'sm' }),
      'h-8 gap-1.5 bg-background px-2 shadow-sm'
    )}>
    <AccountTreeIcon />
    <span>{selected === 'elk' ? 'Adaptive' : 'Hierarchical'}</span>
    <KeyboardArrowDownIcon class="size-4" />
  </Popover.Trigger>
  <Popover.Content side="top" align="start" class="w-72 max-w-[calc(100vw-2rem)] p-1">
    <div class="px-3 py-2 text-xs font-semibold text-muted-foreground">Layout</div>
    <p class="px-3 pb-2 text-xs text-muted-foreground">
      Switching layout resets manually moved nodes.
    </p>
    {#each engines as option (option.engine)}
      <Popover.Close
        disabled={disabled || unsupported}
        aria-pressed={selected === option.engine}
        class={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'h-auto w-full items-start justify-start whitespace-normal p-2',
          selected === option.engine && 'bg-accent'
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

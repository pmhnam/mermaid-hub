<script lang="ts">
  import * as Popover from '$/components/ui/popover';
  import { Switch } from '$/components/ui/switch';
  import { env } from '$/util/env';
  import { urls } from '$/util/state.svelte';
  import { cn } from '$/utils';
  import { resolve } from '$app/paths';
  import { mode, setMode } from 'mode-watcher';
  import type { Component, Snippet } from 'svelte';
  import MermaidTailIcon from '~icons/custom/mermaid-tail';
  import AddIcon from '~icons/material-symbols/add-2-rounded';
  import BookIcon from '~icons/material-symbols/book-2-outline-rounded';
  import DuplicateIcon from '~icons/material-symbols/content-copy-outline-rounded';
  import ContrastIcon from '~icons/material-symbols/contrast';
  import MenuIcon from '~icons/material-symbols/menu-rounded';
  import CommunityIcon from '~icons/material-symbols/person-play-outline-rounded';
  import PlaygroundIcon from '~icons/material-symbols/shape-line-outline';
  import MermaidChartIcon from './MermaidChartIcon.svelte';

  interface MenuItem {
    label: string;
    icon: Component;
    href: string;
    class?: string;
    onclick?: () => void;
    sharesData?: boolean;
    checkDiagramType?: boolean;
    isSectionEnd?: boolean;
    renderer: Snippet<[Omit<MenuItem, 'renderer'>]>;
  }

  const menuItems: MenuItem[] = $derived([
    { label: 'New', icon: AddIcon, href: urls.current.new, renderer: menuItem },
    { label: 'Duplicate', icon: DuplicateIcon, href: window.location.href, renderer: menuItem },
    {
      href: urls.current.workspaceImport,
      icon: PlaygroundIcon,
      isSectionEnd: true,
      label: 'Save to Workspace',
      renderer: menuItem
    },
    {
      label: 'Mermaid.js',
      icon: MermaidTailIcon,
      href: env.docsUrl,
      renderer: menuItem
    },
    {
      label: 'Documentation',
      icon: BookIcon,
      href: `${env.docsUrl}/intro/`,
      renderer: menuItem
    },
    {
      label: 'Community',
      icon: CommunityIcon,
      href: 'https://discord.gg/sKeNQX4Wtj',
      renderer: menuItem
    },
    {
      href: '#',
      icon: ContrastIcon,
      isSectionEnd: true,
      label: 'Dark Mode',
      renderer: darkModeMenuItem
    },
    {
      class: 'text-accent border-b-0',
      href: resolve('/register', {}),
      icon: MermaidChartIcon,
      label: 'Workspace',
      renderer: menuItem
    }
  ]);
</script>

{#snippet menuItem(options: Omit<MenuItem, 'renderer'>)}
  <a
    href={options.href}
    target="_blank"
    onclick={options.onclick}
    class={cn(
      'flex items-center justify-start gap-2 border-b-2 p-2 px-3 hover:bg-muted',
      options.isSectionEnd && 'border-border-dark',
      options.class
    )}>
    <options.icon class="size-5" />
    {options.label}
  </a>
{/snippet}

{#snippet darkModeMenuItem(options: Omit<MenuItem, 'renderer'>)}
  <div
    class={cn(
      'flex cursor-pointer items-center justify-between border-b-2 px-3 py-2 hover:bg-muted',
      options.isSectionEnd && 'border-border-dark',
      options.class
    )}>
    <span class="flex items-center gap-2">
      <ContrastIcon />
      Dark Mode
    </span>
    <Switch
      checked={mode.current === 'dark'}
      onCheckedChange={(dark) => setMode(dark ? 'dark' : 'light')} />
  </div>
{/snippet}

<Popover.Root>
  <Popover.Trigger class="shrink-0" aria-label="Open main menu">
    <MenuIcon class="size-6" />
  </Popover.Trigger>
  <Popover.Content align="start" class="flex flex-col overflow-hidden border-2 p-0" sideOffset={16}>
    {#each menuItems as { renderer, ...item } (item.label)}
      {@render renderer(item)}
    {/each}
  </Popover.Content>
</Popover.Root>

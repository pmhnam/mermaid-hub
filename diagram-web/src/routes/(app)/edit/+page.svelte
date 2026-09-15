<script lang="ts">
  import Actions from '$/components/Actions.svelte';
  import Card from '$/components/Card/Card.svelte';
  import DiagramDocButton from '$/components/DiagramDocumentationButton.svelte';
  import Editor from '$/components/Editor.svelte';
  import EnhancedEditsButton from '$/components/EnhancedEditsButton.svelte';
  import History from '$/components/History/History.svelte';
  import { startAutoSave } from '$/components/History/historyState.svelte';
  import Navbar from '$/components/Navbar.svelte';
  import PanZoomToolbar from '$/components/PanZoomToolbar.svelte';
  import Preset from '$/components/Preset.svelte';
  import Share from '$/components/Share.svelte';
  import SyncRoughToolbar from '$/components/SyncRoughToolbar.svelte';
  import { Button, buttonVariants } from '$/components/ui/button';
  import * as Dialog from '$/components/ui/dialog';
  import * as Popover from '$/components/ui/popover';
  import * as Resizable from '$/components/ui/resizable';
  import { Switch } from '$/components/ui/switch';
  import { Toggle } from '$/components/ui/toggle';
  import VersionSecurityToolbar from '$/components/VersionSecurityToolbar.svelte';
  import View from '$/components/View.svelte';
  import type { EditorMode, SourceRange, SourceSelectionRequest, Tab } from '$/types';
  import { PanZoomState } from '$/util/panZoom';
  import { validatedState, updateCodeStore, urls } from '$/util/state.svelte';
  import { logEvent } from '$/util/stats';
  import { initHandler } from '$/util/util';
  import type { VisualLayout } from '$/visual/layout';
  import { onMount } from 'svelte';
  import CodeIcon from '~icons/custom/code';
  import HistoryIcon from '~icons/material-symbols/history';
  import GearIcon from '~icons/material-symbols/settings-outline-rounded';
  import MoreIcon from '~icons/material-symbols/more-horiz';

  const panZoomState = new PanZoomState();

  const tabSelectHandler = (tab: Tab) => {
    const editorMode: EditorMode = tab.id === 'code' ? 'code' : 'config';
    updateCodeStore({ editorMode });
  };

  const editorTabs: Tab[] = [
    {
      icon: CodeIcon,
      id: 'code',
      title: 'Code'
    },
    {
      icon: GearIcon,
      id: 'config',
      title: 'Config'
    }
  ];

  let width = $state(0);
  let isMobile = $derived(width < 640);
  let isViewMode = $state(true);
  let selectionRequest = $state<SourceSelectionRequest | undefined>();
  let selectionId = 0;

  const selectSource = (range: SourceRange): void => {
    isViewMode = false;
    updateCodeStore({ editorMode: 'code' });
    selectionRequest = { ...range, id: ++selectionId };
  };

  const updateVisualLayout = (visualLayout: VisualLayout): void => {
    updateCodeStore({ visualLayout });
  };

  onMount(async () => {
    await initHandler();
    window.addEventListener('appinstalled', () => {
      logEvent('pwaInstalled', { isMobile });
    });
  });

  // Record the Timeline for the whole session, not just while the panel is open.
  onMount(() => startAutoSave());

  let isHistoryOpen = $state(false);
  let isMobileActionsOpen = $state(false);
  let isMobileHistoryOpen = $state(false);
  let isMobileMenuOpen = $state(false);
  let isShareOpen = $state(false);

  let editorPane: Resizable.Pane | undefined;
  $effect(() => {
    if (isMobile) {
      editorPane?.resize(50);
    }
  });
</script>

<div class="flex h-full flex-col overflow-hidden">
  {#snippet mobileToggle()}
    <div class="flex items-center gap-2">
      Edit <Switch
        id="editorMode"
        class="data-[state=checked]:bg-accent"
        bind:checked={isViewMode}
        onclick={() => {
          logEvent('mobileViewToggle');
        }} /> View
    </div>
  {/snippet}

  {#snippet mobileActions()}
    <div class="flex items-center gap-1 sm:hidden">
      <Button variant="accent" size="sm" href={urls.current.workspaceImport}>Save</Button>
      <Popover.Root bind:open={isMobileMenuOpen}>
        <Popover.Trigger
          class={buttonVariants({ size: 'icon', variant: 'ghost' })}
          aria-label="More editor actions">
          <MoreIcon />
        </Popover.Trigger>
        <Popover.Content align="end" class="flex w-52 flex-col gap-1 p-1">
          <Button
            variant="ghost"
            class="justify-start"
            onclick={() => {
              isMobileMenuOpen = false;
              isShareOpen = true;
            }}>Share</Button>
          <Button
            variant="ghost"
            class="justify-start"
            onclick={() => {
              isMobileMenuOpen = false;
              isMobileHistoryOpen = true;
            }}>History</Button>
          <Button
            variant="ghost"
            class="justify-start"
            onclick={() => {
              isMobileMenuOpen = false;
              isMobileActionsOpen = true;
            }}>Actions</Button>
        </Popover.Content>
      </Popover.Root>
    </div>
  {/snippet}

  <Navbar {mobileActions} mobileToggle={isMobile ? mobileToggle : undefined}>
    <Toggle bind:pressed={isHistoryOpen} size="sm" title="History" aria-label="History">
      <HistoryIcon />
    </Toggle>
    <Share showTrigger={!isMobile} bind:open={isShareOpen} />
    <Button variant="accent" size="sm" href={urls.current.workspaceImport}>
      Save to workspace
    </Button>
  </Navbar>

  <div class="flex flex-1 flex-col overflow-hidden" bind:clientWidth={width}>
    <div
      class={[
        'size-full',
        isMobile && ['w-[200%] duration-300', isViewMode && '-translate-x-1/2']
      ]}>
      <Resizable.PaneGroup
        direction="horizontal"
        autoSaveId="liveEditor"
        class="gap-4 p-2 pt-0 sm:gap-0 sm:p-6 sm:pt-0">
        <Resizable.Pane bind:this={editorPane} defaultSize={30} minSize={15}>
          <div class="flex h-full flex-col gap-4 sm:gap-6">
            <Card
              onselect={tabSelectHandler}
              isOpen
              tabs={editorTabs}
              activeTabID={validatedState.current.editorMode}
              isClosable={false}>
              {#snippet actions()}
                <DiagramDocButton />
              {/snippet}
              <Editor {isMobile} {selectionRequest} />
            </Card>

            <div class="group flex flex-wrap justify-between gap-4 sm:gap-6">
              <Preset />
              {#if !isMobile}
                <Actions />
              {/if}
            </div>
          </div>
        </Resizable.Pane>
        <Resizable.Handle class="mr-1 hidden opacity-0 sm:block" />
        <Resizable.Pane minSize={15} class="relative flex h-full flex-1 flex-col overflow-hidden">
          <View
            onSourceSelect={selectSource}
            {panZoomState}
            shouldShowGrid={validatedState.current.grid}
            editable
            onVisualLayoutChange={updateVisualLayout}
            visualLayout={validatedState.current.visualLayout} />
          <div class="absolute top-0 left-5 hidden md:block"><EnhancedEditsButton /></div>
          <div class="absolute top-0 right-0">
            <PanZoomToolbar {panZoomState} fullScreenHref={urls.current.view} />
          </div>
          <div class="absolute right-0 bottom-0"><VersionSecurityToolbar /></div>
          <div class="absolute bottom-0 left-0 sm:left-5"><SyncRoughToolbar /></div>
        </Resizable.Pane>
        {#if isHistoryOpen}
          <Resizable.Handle class="ml-1 hidden opacity-0 sm:block" />
          <Resizable.Pane minSize={15} defaultSize={30} class="hidden h-full grow flex-col sm:flex">
            <History />
          </Resizable.Pane>
        {/if}
      </Resizable.PaneGroup>
    </div>
  </div>
</div>

<Dialog.Root bind:open={isMobileHistoryOpen}>
  <Dialog.Content class="flex max-h-[90vh] flex-col sm:hidden">
    <Dialog.Header>
      <Dialog.Title>History</Dialog.Title>
      <Dialog.Description>Restore a saved diagram or browse the Timeline.</Dialog.Description>
    </Dialog.Header>
    <div class="h-[60vh] min-h-0">
      <History />
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={isMobileActionsOpen}>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:hidden">
    <Dialog.Header>
      <Dialog.Title>Actions</Dialog.Title>
      <Dialog.Description>Export, copy, or load this diagram.</Dialog.Description>
    </Dialog.Header>
    <Actions mobile />
  </Dialog.Content>
</Dialog.Root>

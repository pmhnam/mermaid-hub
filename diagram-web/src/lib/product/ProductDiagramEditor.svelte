<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import Editor from '$lib/components/Editor.svelte';
  import LayoutToolbar from '$lib/components/LayoutToolbar.svelte';
  import PanZoomToolbar from '$lib/components/PanZoomToolbar.svelte';
  import View from '$lib/components/View.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Resizable from '$lib/components/ui/resizable';
  import { defaultState } from '$lib/constants';
  import { ApiError } from '$lib/product/api';
  import { auth } from '$lib/product/auth.svelte';
  import { CollaborativeDocumentController } from '$lib/product/collaboration/CollaborativeDocumentController';
  import PreviewCursors from '$lib/product/collaboration/PreviewCursors.svelte';
  import {
    presenceInitials,
    presenceRevision,
    type RemotePreviewCursor
  } from '$lib/product/collaboration/presence';
  import ExportDialog from '$lib/product/ExportDialog.svelte';
  import ShareDialog from '$lib/product/ShareDialog.svelte';
  import type { Diagram, DiagramVersion, ResourceRole } from '$lib/product/types';
  import type { SourceRange, SourceSelectionRequest } from '$lib/types';
  import { createVersionDiff } from '$lib/product/version-diff';
  import { PanZoomState } from '$lib/util/panZoom';
  import { updateMermaidLayout, type LayoutEngine, type VisualLayout } from '$lib/visual/layout';
  import {
    disableURLSubscription,
    replaceInputState,
    updateCodeStore,
    validatedState
  } from '$lib/util/state.svelte';
  import { onMount, tick } from 'svelte';
  import CodeIcon from '~icons/custom/code';
  import DownloadIcon from '~icons/material-symbols/download';
  import FullscreenIcon from '~icons/material-symbols/fullscreen-rounded';
  import HistoryIcon from '~icons/material-symbols/history-rounded';
  import PreviewIcon from '~icons/material-symbols/visibility-outline-rounded';
  import SettingsIcon from '~icons/material-symbols/settings-outline-rounded';
  import ShareIcon from '~icons/material-symbols/share';

  const { diagramId, workspaceId }: { diagramId: string; workspaceId: string } = $props();
  const panZoomState = new PanZoomState();
  let title = $state('Loading diagram...');
  let diagram = $state<Diagram | null>(null);
  let loaded = $state(false);
  let error = $state('');
  let collaborationError = $state('');
  let collaborationStatus = $state('connecting');
  let role = $state<ResourceRole>('viewer');
  let controller = $state<CollaborativeDocumentController | null>(null);
  let presence = $state<{ color: string; displayName: string; userId: string }[]>([]);
  let previewCursors = $state<RemotePreviewCursor[]>([]);
  let mobilePanel = $state<'editor' | 'preview'>('editor');
  let viewportWidth = $state(0);
  let isMobile = $derived(viewportWidth < 768);
  let historyOpen = $state(false);
  let shareOpen = $state(false);
  let exportOpen = $state(false);
  let editorOpen = $state(true);
  let previewElement = $state<HTMLElement | null>(null);
  let exportSvgElement = $state<SVGSVGElement | null>(null);
  let versions = $state<DiagramVersion[]>([]);
  let selectedVersion = $state<DiagramVersion | null>(null);
  let versionsLoading = $state(false);
  let versionMessage = $state('');
  let actionMessage = $state('');
  let currentContent = $state('');
  let currentConfig = $state('');
  let currentVisualLayout = $state<VisualLayout | undefined>();
  let selectionRequest = $state<SourceSelectionRequest | undefined>();
  let selectionId = 0;
  let previewRevision = $derived(presenceRevision(currentContent, currentConfig));
  let routeDestroyed = false;
  let versionDiff = $derived(
    selectedVersion
      ? createVersionDiff(
          { config: currentConfig, content: currentContent },
          { config: selectedVersion.config, content: selectedVersion.content }
        )
      : null
  );
  let cleanup = (): void => undefined;

  const loadVersions = async (): Promise<void> => {
    versionsLoading = true;
    try {
      versions = await auth.api.getVersions(diagramId);
    } catch (caught) {
      actionMessage = caught instanceof ApiError ? caught.message : 'Unable to load versions.';
    } finally {
      versionsLoading = false;
    }
  };

  const selectVersion = async (version: DiagramVersion): Promise<void> => {
    try {
      selectedVersion = await auth.api.getVersion(diagramId, version.id);
    } catch (caught) {
      actionMessage = caught instanceof ApiError ? caught.message : 'Unable to load this version.';
    }
  };

  const createVersion = async (): Promise<void> => {
    actionMessage = '';
    try {
      await auth.api.createVersion(diagramId, versionMessage);
      versionMessage = '';
      actionMessage = 'Version saved.';
      await loadVersions();
    } catch (caught) {
      actionMessage = caught instanceof ApiError ? caught.message : 'Unable to save a version.';
    }
  };

  const restoreVersion = async (): Promise<void> => {
    if (
      !selectedVersion ||
      !confirm(
        `Restore version ${selectedVersion.versionNumber}? A checkpoint will be created first.`
      )
    ) {
      return;
    }
    actionMessage = '';
    try {
      await auth.api.restoreVersion(diagramId, selectedVersion.id);
      actionMessage =
        'Restore requested. The collaborative document will update when synchronized.';
      await loadVersions();
    } catch (caught) {
      actionMessage =
        caught instanceof ApiError ? caught.message : 'Unable to restore this version.';
    }
  };

  const openExport = async (): Promise<void> => {
    if (isMobile && mobilePanel !== 'preview') {
      mobilePanel = 'preview';
      await tick();
    }
    exportSvgElement = previewElement?.querySelector('#container svg') ?? null;
    exportOpen = true;
  };

  const enterFullscreen = async (): Promise<void> => {
    await previewElement?.requestFullscreen();
  };

  const selectSource = (range: SourceRange): void => {
    editorOpen = true;
    mobilePanel = 'editor';
    updateCodeStore({ editorMode: 'code' });
    selectionRequest = { ...range, id: ++selectionId };
  };

  const updateCollaborativeLayout = (engine: LayoutEngine): void => {
    if (!controller || role === 'viewer') return;
    const config = updateMermaidLayout(controller.config.toString(), engine);
    if (config) controller.setConfigAndVisualLayout(config, undefined);
  };

  const updateVisualLayout = (layout: VisualLayout): void => {
    if (controller && role !== 'viewer') controller.setVisualLayout(layout);
  };

  const initialize = async (): Promise<void> => {
    disableURLSubscription();
    if (window.location.hash) {
      history.replaceState(undefined, '', window.location.pathname + window.location.search);
    }
    await auth.initialize();
    if (routeDestroyed) return;
    if (auth.current.status !== 'authenticated' || !auth.current.user) {
      await goto(`${base}/login?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    try {
      const loadedDiagram = await auth.api.getDiagram(diagramId);
      if (routeDestroyed) return;
      if (loadedDiagram.workspaceId !== workspaceId) {
        error = 'This diagram does not belong to the selected workspace.';
        return;
      }
      diagram = loadedDiagram;
      title = loadedDiagram.title;
      const collaboration = new CollaborativeDocumentController({
        apiBaseUrl: import.meta.env.MERMAID_API_URL ?? '',
        browserOrigin: window.location.origin,
        diagramId,
        getTicket: () => auth.api.createCollaborationTicket(diagramId),
        user: auth.current.user
      });
      controller = collaboration;

      const syncDocument = (): void => {
        currentContent = collaboration.code.toString();
        currentConfig = collaboration.config.toString();
        currentVisualLayout = collaboration.getVisualLayout();
        if (loaded) {
          updateCodeStore({
            code: currentContent,
            mermaid: currentConfig,
            visualLayout: currentVisualLayout
          });
        }
      };
      collaboration.code.observe(syncDocument);
      collaboration.config.observe(syncDocument);
      collaboration.layout.observe(syncDocument);
      const unsubscribe = collaboration.subscribe(() => {
        collaborationStatus = collaboration.status;
        collaborationError = collaboration.error;
        presence = collaboration.presence;
        previewCursors = collaboration.previewCursors;
        role = collaboration.role;
        if (collaboration.synced && !loaded) {
          syncDocument();
          replaceInputState({
            ...defaultState,
            code: currentContent,
            editorMode: 'code',
            mermaid: currentConfig,
            visualLayout: currentVisualLayout
          });
          loaded = true;
          void loadVersions();
        }
      });
      cleanup = () => {
        unsubscribe();
        collaboration.code.unobserve(syncDocument);
        collaboration.config.unobserve(syncDocument);
        collaboration.layout.unobserve(syncDocument);
        collaboration.destroy();
      };
      await collaboration.start();
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : 'Unable to load this diagram.';
    }
  };

  const handleDiagramUpdated = (event: Event): void => {
    const updated = (event as CustomEvent<Diagram>).detail;
    if (updated.id !== diagramId) return;
    diagram = updated;
    title = updated.title;
  };

  onMount(() => {
    window.addEventListener('product-diagram-updated', handleDiagramUpdated);
    void initialize();
    return () => {
      routeDestroyed = true;
      window.removeEventListener('product-diagram-updated', handleDiagramUpdated);
      cleanup();
    };
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<div class="flex h-full min-h-0 flex-col bg-[#f7f6f2]">
  <header
    class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-slate-950 px-3 py-2 text-slate-100 md:px-5">
    <div class="min-w-0">
      <h1 class="truncate text-sm font-semibold md:text-base">{title}</h1>
      <p class="text-[11px] text-slate-400" aria-live="polite">
        {collaborationStatus === 'synced'
          ? role === 'viewer'
            ? 'Live, view only'
            : 'Live and synchronized'
          : collaborationStatus === 'connecting'
            ? 'Connecting...'
            : 'Reconnecting...'}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <div class="hidden -space-x-2 sm:flex" aria-label="People viewing this diagram">
        {#each presence.slice(0, 5) as user (user.userId)}
          <span
            data-testid="presence-user"
            class="grid size-8 place-items-center rounded-full border-2 border-slate-950 text-[10px] font-bold text-white"
            style={`background-color: ${user.color}`}
            title={user.displayName}>{presenceInitials(user.displayName)}</span>
        {/each}
      </div>
      <Button
        class="text-slate-300 hover:bg-white/10 hover:text-white"
        size="sm"
        variant="ghost"
        aria-pressed={historyOpen}
        onclick={() => (historyOpen = !historyOpen)}>
        <HistoryIcon /> <span class="hidden sm:inline">Versions</span>
      </Button>
      <Button
        class="text-slate-300 hover:bg-white/10 hover:text-white"
        size="sm"
        variant="ghost"
        onclick={openExport}>
        <DownloadIcon /> <span class="hidden sm:inline">Export</span>
      </Button>
      {#if role === 'owner'}
        <Button
          class="bg-rose-600 text-white hover:bg-rose-500"
          size="sm"
          onclick={() => (shareOpen = true)}>
          <ShareIcon /> <span class="hidden sm:inline">Share</span>
        </Button>
      {/if}
      <Button
        class="hidden text-slate-300 hover:bg-white/10 hover:text-white md:inline-flex"
        size="sm"
        variant="ghost"
        aria-pressed={editorOpen}
        onclick={() => (editorOpen = !editorOpen)}>
        <CodeIcon />
        {editorOpen ? 'Hide code' : 'Edit code'}
      </Button>
      <div class="flex items-center gap-1 rounded-lg bg-slate-100 p-1 md:hidden">
        <Button
          size="sm"
          variant={mobilePanel === 'editor' ? 'secondary' : 'ghost'}
          aria-pressed={mobilePanel === 'editor'}
          onclick={() => (mobilePanel = 'editor')}><CodeIcon /> Edit</Button>
        <Button
          size="sm"
          variant={mobilePanel === 'preview' ? 'secondary' : 'ghost'}
          aria-pressed={mobilePanel === 'preview'}
          onclick={() => (mobilePanel = 'preview')}><PreviewIcon /> Preview</Button>
      </div>
    </div>
  </header>

  {#if error || collaborationError}
    <div class="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
      {error || collaborationError}
    </div>
  {/if}

  {#if historyOpen}
    <section class="max-h-[45vh] shrink-0 overflow-auto border-b border-slate-200 bg-white p-4">
      <div class="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div>
          {#if role !== 'viewer'}
            <div class="mb-3 flex gap-2">
              <Input placeholder="Version note (optional)" bind:value={versionMessage} />
              <Button onclick={createVersion}>Save</Button>
            </div>
          {/if}
          {#if versionsLoading}
            <p class="text-sm text-slate-500">Loading versions...</p>
          {:else if versions.length === 0}
            <p class="text-sm text-slate-500">No saved versions yet.</p>
          {:else}
            <div class="space-y-1">
              {#each versions as version (version.id)}
                <button
                  class="flex w-full justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100"
                  class:bg-slate-100={selectedVersion?.id === version.id}
                  onclick={() => selectVersion(version)}>
                  <span>v{version.versionNumber} · {version.message || version.type}</span>
                  <time class="text-xs text-slate-500"
                    >{new Date(version.createdAt).toLocaleString()}</time>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        {#if selectedVersion && versionDiff}
          <div class="min-w-0">
            <div class="mb-2 flex items-center justify-between gap-2">
              <h2 class="font-semibold">
                Version {selectedVersion.versionNumber} preview and diff
              </h2>
              {#if role === 'owner'}<Button variant="destructive" onclick={restoreVersion}
                  >Restore</Button
                >{/if}
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <h3 class="mb-1 text-xs font-semibold tracking-wide uppercase">Diagram</h3>
                <pre
                  class="max-h-52 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{#each versionDiff.content as part, index (`content-${index}`)}<span
                      class:text-emerald-300={part.added}
                      class:text-rose-300={part.removed}
                      >{part.added ? '+ ' : part.removed ? '- ' : '  '}{part.value}</span
                    >{/each}</pre>
              </div>
              <div>
                <h3 class="mb-1 text-xs font-semibold tracking-wide uppercase">Config</h3>
                <pre
                  class="max-h-52 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{#each versionDiff.config as part, index (`config-${index}`)}<span
                      class:text-emerald-300={part.added}
                      class:text-rose-300={part.removed}
                      >{part.added ? '+ ' : part.removed ? '- ' : '  '}{part.value}</span
                    >{/each}</pre>
              </div>
            </div>
          </div>
        {/if}
      </div>
      {#if actionMessage}<p class="mt-2 text-sm text-slate-600" aria-live="polite">
          {actionMessage}
        </p>{/if}
    </section>
  {/if}

  {#snippet editorPanel()}
    <section
      data-testid="product-editor"
      class="flex h-full min-h-0 flex-col bg-white"
      aria-label="Diagram editor">
      <div class="flex h-11 shrink-0 items-center gap-1 border-b border-slate-200 bg-slate-50 px-3">
        <Button
          size="sm"
          variant={validatedState.current.editorMode === 'code' ? 'secondary' : 'ghost'}
          aria-pressed={validatedState.current.editorMode === 'code'}
          onclick={() => updateCodeStore({ editorMode: 'code' })}><CodeIcon /> Code</Button>
        <Button
          size="sm"
          variant={validatedState.current.editorMode === 'config' ? 'secondary' : 'ghost'}
          aria-pressed={validatedState.current.editorMode === 'config'}
          onclick={() => updateCodeStore({ editorMode: 'config' })}><SettingsIcon /> Config</Button>
      </div>
      <div class="min-h-0 flex-1">
        {#if controller}
          <Editor
            {isMobile}
            {selectionRequest}
            collaboration={{
              awareness: controller.awareness,
              code: controller.code,
              config: controller.config,
              readOnly: role === 'viewer'
            }} />
        {/if}
      </div>
    </section>
  {/snippet}

  {#snippet previewPanel()}
    <section
      bind:this={previewElement}
      class="relative h-full min-h-0 overflow-hidden bg-[#f8f7f4]"
      aria-label="Diagram preview">
      <View
        onSourceSelect={selectSource}
        {panZoomState}
        shouldShowGrid={validatedState.current.grid}
        editable={role !== 'viewer'}
        onVisualLayoutChange={updateVisualLayout}
        visualLayout={validatedState.current.visualLayout} />
      {#if controller}
        <PreviewCursors
          container={previewElement}
          {controller}
          cursors={previewCursors}
          revision={previewRevision} />
      {/if}
      <div class="absolute top-3 right-3 flex items-start gap-2">
        <LayoutToolbar
          config={currentConfig}
          diagramType={validatedState.current.diagramType}
          disabled={role === 'viewer'}
          onChange={updateCollaborativeLayout} />
        <PanZoomToolbar {panZoomState} compact />
        <Button
          class="border border-slate-200 bg-white shadow-sm hover:bg-slate-100"
          variant="ghost"
          size="icon"
          title="Full screen"
          aria-label="Full screen"
          onclick={enterFullscreen}><FullscreenIcon /></Button>
      </div>
      {#if !editorOpen && !isMobile}
        <Button
          class="absolute top-3 left-3 border border-slate-200 bg-white shadow-sm hover:bg-slate-100"
          variant="ghost"
          size="sm"
          onclick={() => (editorOpen = true)}><CodeIcon /> Edit code</Button>
      {/if}
    </section>
  {/snippet}

  {#if !loaded && !error}
    <div class="grid min-h-0 flex-1 place-items-center" role="status">
      <div class="text-center">
        <div
          class="mx-auto size-7 animate-spin rounded-full border-2 border-slate-300 border-t-rose-500">
        </div>
        <p class="mt-3 text-sm text-slate-500">Joining collaborative document...</p>
      </div>
    </div>
  {:else if loaded && controller}
    {#if isMobile}
      <div class="min-h-0 flex-1">
        {#if mobilePanel === 'editor'}
          {@render editorPanel()}
        {:else}
          {@render previewPanel()}
        {/if}
      </div>
    {:else}
      <div class="min-h-0 flex-1">
        {#if editorOpen}
          <Resizable.PaneGroup direction="horizontal" autoSaveId="productEditor">
            <Resizable.Pane defaultSize={36} minSize={22}>{@render editorPanel()}</Resizable.Pane>
            <Resizable.Handle withHandle />
            <Resizable.Pane minSize={35}>{@render previewPanel()}</Resizable.Pane>
          </Resizable.PaneGroup>
        {:else}
          {@render previewPanel()}
        {/if}
      </div>
    {/if}
  {/if}
</div>

{#if diagram && role === 'owner'}
  <ShareDialog {diagram} bind:open={shareOpen} />
{/if}

<ExportDialog
  code={currentContent}
  config={currentConfig}
  getSvgElement={() => previewElement?.querySelector('#container svg') ?? null}
  bind:open={exportOpen}
  svgElement={exportSvgElement}
  {title} />

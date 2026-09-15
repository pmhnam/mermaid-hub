<script lang="ts">
  import { base } from '$app/paths';
  import Editor from '$lib/components/Editor.svelte';
  import LayoutToolbar from '$lib/components/LayoutToolbar.svelte';
  import PanZoomToolbar from '$lib/components/PanZoomToolbar.svelte';
  import View from '$lib/components/View.svelte';
  import { Button } from '$lib/components/ui/button';
  import { defaultState } from '$lib/constants';
  import { ApiClient, ApiError } from '$lib/product/api';
  import { CollaborativeDocumentController } from '$lib/product/collaboration/CollaborativeDocumentController';
  import PreviewCursors from '$lib/product/collaboration/PreviewCursors.svelte';
  import {
    presenceInitials,
    presenceRevision,
    type RemotePreviewCursor
  } from '$lib/product/collaboration/presence';
  import ExportDialog from '$lib/product/ExportDialog.svelte';
  import {
    isPublicLinkMode,
    publicGuestIdentity,
    publicShareToken
  } from '$lib/product/public-share';
  import type { PublicDiagram } from '$lib/product/types';
  import type { SourceRange, SourceSelectionRequest } from '$lib/types';
  import { PanZoomState } from '$lib/util/panZoom';
  import {
    updateMermaidDocumentLayout,
    type LayoutEngine,
    type VisualLayout
  } from '$lib/visual/layout';
  import { silentlySanitizeConfig } from '$lib/util/sanitize';
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
  import PreviewIcon from '~icons/material-symbols/visibility-outline-rounded';
  import SettingsIcon from '~icons/material-symbols/settings-outline-rounded';

  const api = new ApiClient(import.meta.env.MERMAID_API_URL ?? '');
  const panZoomState = new PanZoomState();
  let diagram = $state<PublicDiagram | null>(null);
  let controller = $state<CollaborativeDocumentController | null>(null);
  let collaborationReady = $state(false);
  let collaborationStatus = $state('connecting');
  let error = $state('');
  let collaborationError = $state('');
  let presence = $state<{ color: string; displayName: string; userId: string }[]>([]);
  let previewCursors = $state<RemotePreviewCursor[]>([]);
  let collaborationRole = $state<'editor' | 'owner' | 'viewer'>('viewer');
  let mobilePanel = $state<'editor' | 'preview'>('editor');
  let width = $state(0);
  let exportOpen = $state(false);
  let exportSvgElement = $state<SVGSVGElement | null>(null);
  let previewElement = $state<HTMLElement | null>(null);
  let currentVisualLayout = $state<VisualLayout | undefined>();
  let selectionRequest = $state<SourceSelectionRequest | undefined>();
  let selectionId = 0;
  let isMobile = $derived(width < 768);
  let editable = $derived(diagram?.mode === 'public_edit' && collaborationRole === 'editor');
  let previewRevision = $derived(
    presenceRevision(validatedState.current.code, validatedState.current.mermaid)
  );
  let routeDestroyed = false;
  let cleanup = (): void => undefined;

  const openExport = async (): Promise<void> => {
    if (isMobile && editable && mobilePanel !== 'preview') {
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
    if (!editable) return;
    mobilePanel = 'editor';
    updateCodeStore({ editorMode: 'code' });
    selectionRequest = { ...range, id: ++selectionId };
  };

  const updateCollaborativeLayout = (engine: LayoutEngine): void => {
    if (!controller || !editable) return;
    const document = updateMermaidDocumentLayout(
      controller.code.toString(),
      controller.config.toString(),
      engine
    );
    if (document) {
      controller.setDocumentAndVisualLayout(document.code, document.config, undefined);
    }
  };

  const updateVisualLayout = (layout: VisualLayout): void => {
    if (controller && editable) controller.setVisualLayout(layout);
  };

  const displayDocument = (
    content: string,
    config: string,
    initial = false,
    visualLayout?: VisualLayout
  ): void => {
    const safeConfig = JSON.stringify(
      silentlySanitizeConfig(config || defaultState.mermaid),
      null,
      2
    );
    if (initial) {
      replaceInputState({
        ...defaultState,
        code: content,
        editorMode: 'code',
        mermaid: safeConfig,
        visualLayout
      });
    } else {
      updateCodeStore({ code: content, mermaid: safeConfig, visualLayout });
    }
  };

  const initialize = async (): Promise<void> => {
    disableURLSubscription();
    try {
      const token = publicShareToken(window.location.hash);
      if (!token) {
        error = 'This share link is missing its access token.';
        return;
      }

      const sharedDiagram = await api.resolvePublicDiagram(token);
      if (routeDestroyed) return;
      if (!isPublicLinkMode(sharedDiagram.mode)) {
        error = 'This share link has an unsupported access mode.';
        return;
      }
      diagram = sharedDiagram;
      displayDocument(sharedDiagram.currentContent, sharedDiagram.currentConfig, true);

      const collaboration = new CollaborativeDocumentController({
        apiBaseUrl: import.meta.env.MERMAID_API_URL ?? '',
        browserOrigin: window.location.origin,
        diagramId: sharedDiagram.id,
        getTicket: () => api.createPublicCollaborationTicket(token),
        user: publicGuestIdentity(sessionStorage, sharedDiagram.id)
      });
      controller = collaboration;

      const syncDocument = (): void => {
        const content = collaboration.code.toString();
        const config = collaboration.config.toString();
        currentVisualLayout = collaboration.getVisualLayout();
        if (collaboration.synced) displayDocument(content, config, false, currentVisualLayout);
      };
      collaboration.code.observe(syncDocument);
      collaboration.config.observe(syncDocument);
      collaboration.layout.observe(syncDocument);
      const unsubscribe = collaboration.subscribe(() => {
        collaborationStatus = collaboration.status;
        collaborationError = collaboration.error;
        collaborationRole = collaboration.role;
        if (diagram) {
          const mode = collaboration.role === 'editor' ? 'public_edit' : 'public_read';
          if (diagram.mode !== mode) diagram = { ...diagram, mode };
        }
        presence = collaboration.presence;
        previewCursors = collaboration.previewCursors;
        if (collaboration.synced) {
          collaborationReady = true;
          syncDocument();
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
      error =
        caught instanceof ApiError && caught.status === 401
          ? 'This share link is invalid, expired, or has been revoked.'
          : caught instanceof Error
            ? caught.message
            : 'Unable to open this shared diagram.';
    }
  };

  onMount(() => {
    void initialize();
    return () => {
      routeDestroyed = true;
      cleanup();
    };
  });
</script>

<svelte:head>
  <title>{diagram?.title ?? 'Shared diagram'} | Mermaid</title>
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex h-dvh min-h-0 flex-col bg-[#f8f7f4] text-slate-950" bind:clientWidth={width}>
  <header
    class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 md:px-5">
    <div class="min-w-0">
      <h1 class="truncate text-sm font-semibold md:text-base">
        {diagram?.title ?? 'Shared diagram'}
      </h1>
      {#if diagram}
        <p class="text-[11px] text-slate-500" aria-live="polite">
          {collaborationStatus === 'synced'
            ? editable
              ? 'Public edit link, live and synchronized'
              : 'Public view link, live and read only'
            : collaborationStatus === 'connecting'
              ? 'Connecting to live updates...'
              : 'Reconnecting to live updates...'}
        </p>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <div class="hidden -space-x-2 sm:flex" aria-label="People viewing this diagram">
        {#each presence.slice(0, 5) as user (user.userId)}
          <span
            class="grid size-8 place-items-center rounded-full border-2 border-white text-[10px] font-bold text-white"
            style={`background-color: ${user.color}`}
            title={user.displayName}>{presenceInitials(user.displayName)}</span>
        {/each}
      </div>
      {#if editable}
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
      {/if}
      {#if diagram}
        <Button size="sm" variant="outline" onclick={openExport}>
          <DownloadIcon /> <span class="hidden sm:inline">Export</span>
        </Button>
      {/if}
      <a
        class="hidden text-xs font-medium text-slate-500 hover:text-slate-900 sm:block"
        href={`${base}/edit`}>
        Mermaid Editor
      </a>
    </div>
  </header>

  {#if collaborationError && diagram}
    <div
      class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
      role="status">
      {collaborationError}. Retrying automatically.
    </div>
  {/if}

  {#if error}
    <main class="grid min-h-0 flex-1 place-items-center p-6">
      <section
        bind:this={previewElement}
        class="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm"
        role="alert">
        <h2 class="font-semibold">Shared diagram unavailable</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">{error}</p>
        <Button class="mt-4" variant="outline" onclick={() => window.location.reload()}
          >Try again</Button>
      </section>
    </main>
  {:else if !diagram}
    <main class="grid min-h-0 flex-1 place-items-center" role="status">
      <div class="text-center">
        <div
          class="mx-auto size-7 animate-spin rounded-full border-2 border-slate-300 border-t-rose-500">
        </div>
        <p class="mt-3 text-sm text-slate-500">Opening shared diagram...</p>
      </div>
    </main>
  {:else if editable}
    <main class="grid min-h-0 flex-1 md:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
      <section
        data-testid="product-editor"
        class={[
          'min-h-0 flex-col border-r border-slate-200 bg-white',
          mobilePanel === 'editor' ? 'flex' : 'hidden',
          'md:flex'
        ]}
        aria-label="Diagram editor">
        <div
          class="flex h-11 shrink-0 items-center gap-1 border-b border-slate-200 bg-slate-50 px-3">
          <Button
            size="sm"
            variant={validatedState.current.editorMode === 'code' ? 'secondary' : 'ghost'}
            aria-pressed={validatedState.current.editorMode === 'code'}
            onclick={() => updateCodeStore({ editorMode: 'code' })}><CodeIcon /> Code</Button>
          <Button
            size="sm"
            variant={validatedState.current.editorMode === 'config' ? 'secondary' : 'ghost'}
            aria-pressed={validatedState.current.editorMode === 'config'}
            onclick={() => updateCodeStore({ editorMode: 'config' })}
            ><SettingsIcon /> Config</Button>
        </div>
        <div class="min-h-0 flex-1">
          {#if collaborationReady && controller}
            <Editor
              {isMobile}
              {selectionRequest}
              collaboration={{
                awareness: controller.awareness,
                code: controller.code,
                config: controller.config,
                readOnly: false
              }} />
          {:else}
            <div class="grid h-full place-items-center text-sm text-slate-500" role="status">
              Joining editable document...
            </div>
          {/if}
        </div>
      </section>
      <section
        bind:this={previewElement}
        class={[
          'relative min-h-0 bg-[#f8f7f4]',
          mobilePanel === 'preview' ? 'block' : 'hidden',
          'md:block'
        ]}
        aria-label="Diagram preview">
        <View
          onSourceSelect={selectSource}
          {panZoomState}
          shouldShowGrid={validatedState.current.grid}
          {editable}
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
            code={validatedState.current.code}
            config={validatedState.current.mermaid}
            diagramType={validatedState.current.diagramType}
            disabled={!editable}
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
      </section>
    </main>
  {:else}
    <main bind:this={previewElement} class="relative min-h-0 flex-1" aria-label="Diagram preview">
      <View {panZoomState} shouldShowGrid={validatedState.current.grid} />
      {#if controller}
        <PreviewCursors
          container={previewElement}
          {controller}
          cursors={previewCursors}
          revision={previewRevision} />
      {/if}
      <div class="absolute top-3 right-3 flex items-start gap-2">
        <PanZoomToolbar {panZoomState} compact />
        <Button
          class="border border-slate-200 bg-white shadow-sm hover:bg-slate-100"
          variant="ghost"
          size="icon"
          title="Full screen"
          aria-label="Full screen"
          onclick={enterFullscreen}><FullscreenIcon /></Button>
      </div>
    </main>
  {/if}
</div>

<ExportDialog
  code={validatedState.current.code}
  config={validatedState.current.mermaid}
  getSvgElement={() => previewElement?.querySelector('#container svg') ?? null}
  bind:open={exportOpen}
  svgElement={exportSvgElement}
  title={diagram?.title ?? 'Shared diagram'} />

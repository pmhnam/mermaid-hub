<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import Editor from '$lib/components/Editor.svelte';
  import View from '$lib/components/View.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { defaultState } from '$lib/constants';
  import { ApiError } from '$lib/product/api';
  import { auth } from '$lib/product/auth.svelte';
  import { CollaborativeDocumentController } from '$lib/product/collaboration/CollaborativeDocumentController';
  import { presenceInitials } from '$lib/product/collaboration/presence';
  import type { Diagram, DiagramVersion, ResourceMember, ResourceRole } from '$lib/product/types';
  import { createVersionDiff } from '$lib/product/version-diff';
  import {
    disableURLSubscription,
    replaceInputState,
    updateCodeStore,
    validatedState
  } from '$lib/util/state.svelte';
  import { onMount } from 'svelte';
  import CodeIcon from '~icons/custom/code';
  import HistoryIcon from '~icons/material-symbols/history-rounded';
  import PreviewIcon from '~icons/material-symbols/visibility-outline-rounded';
  import SettingsIcon from '~icons/material-symbols/settings-outline-rounded';
  import ShareIcon from '~icons/material-symbols/share';

  const { diagramId, workspaceId }: { diagramId: string; workspaceId: string } = $props();
  let title = $state('Loading diagram...');
  let diagram = $state<Diagram | null>(null);
  let loaded = $state(false);
  let error = $state('');
  let collaborationError = $state('');
  let collaborationStatus = $state('connecting');
  let role = $state<ResourceRole>('viewer');
  let controller = $state<CollaborativeDocumentController | null>(null);
  let presence = $state<{ color: string; displayName: string; userId: string }[]>([]);
  let mobilePanel = $state<'editor' | 'preview'>('editor');
  let width = $state(0);
  let isMobile = $derived(width < 768);
  let toolsPanel = $state<'history' | 'share' | null>(null);
  let versions = $state<DiagramVersion[]>([]);
  let selectedVersion = $state<DiagramVersion | null>(null);
  let versionsLoading = $state(false);
  let versionMessage = $state('');
  let memberEmail = $state('');
  let memberRole = $state<'editor' | 'viewer'>('viewer');
  let members = $state<ResourceMember[]>([]);
  let membersLoading = $state(false);
  let pendingMemberId = $state<string | null>(null);
  let actionMessage = $state('');
  let actionError = $state(false);
  let currentContent = $state('');
  let currentConfig = $state('');
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

  const share = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (!diagram || !memberEmail.trim()) return;
    actionMessage = '';
    actionError = false;
    try {
      const input = { email: memberEmail.trim(), role: memberRole };
      if (diagram.folderId) await auth.api.addFolderMember(diagram.folderId, input);
      else await auth.api.addDiagramMember(diagram.id, input);
      memberEmail = '';
      actionMessage = 'Access added.';
      await loadMembers();
    } catch (caught) {
      actionError = true;
      actionMessage = caught instanceof ApiError ? caught.message : 'Unable to add access.';
    }
  };

  const loadMembers = async (): Promise<void> => {
    if (!diagram) return;
    membersLoading = true;
    try {
      members = diagram.folderId
        ? await auth.api.getFolderMembers(diagram.folderId)
        : await auth.api.getDiagramMembers(diagram.id);
    } catch (caught) {
      actionError = true;
      actionMessage = caught instanceof ApiError ? caught.message : 'Unable to load access.';
    } finally {
      membersLoading = false;
    }
  };

  const openShare = (): void => {
    if (toolsPanel === 'share') {
      toolsPanel = null;
      return;
    }
    toolsPanel = 'share';
    actionMessage = '';
    actionError = false;
    void loadMembers();
  };

  const updateMemberRole = async (
    member: ResourceMember,
    nextRole: 'editor' | 'viewer'
  ): Promise<void> => {
    if (!diagram || member.role === nextRole) return;
    pendingMemberId = member.userId;
    actionMessage = '';
    actionError = false;
    try {
      const input = { role: nextRole };
      if (diagram.folderId) {
        await auth.api.updateFolderMember(diagram.folderId, member.userId, input);
      } else {
        await auth.api.updateDiagramMember(diagram.id, member.userId, input);
      }
      actionMessage = `${member.displayName}'s role updated to ${nextRole}.`;
      await loadMembers();
    } catch (caught) {
      actionError = true;
      actionMessage = caught instanceof ApiError ? caught.message : 'Unable to update access.';
      await loadMembers();
    } finally {
      pendingMemberId = null;
    }
  };

  const removeMember = async (member: ResourceMember): Promise<void> => {
    if (!diagram || !confirm(`Remove access for ${member.displayName} (${member.email})?`)) {
      return;
    }
    pendingMemberId = member.userId;
    actionMessage = '';
    actionError = false;
    try {
      if (diagram.folderId) {
        await auth.api.deleteFolderMember(diagram.folderId, member.userId);
      } else {
        await auth.api.deleteDiagramMember(diagram.id, member.userId);
      }
      actionMessage = `Access removed for ${member.displayName}.`;
      await loadMembers();
    } catch (caught) {
      actionError = true;
      actionMessage = caught instanceof ApiError ? caught.message : 'Unable to remove access.';
      await loadMembers();
    } finally {
      pendingMemberId = null;
    }
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
        if (loaded) updateCodeStore({ code: currentContent, mermaid: currentConfig });
      };
      collaboration.code.observe(syncDocument);
      collaboration.config.observe(syncDocument);
      const unsubscribe = collaboration.subscribe(() => {
        collaborationStatus = collaboration.status;
        collaborationError = collaboration.error;
        presence = collaboration.presence;
        role = collaboration.role;
        if (collaboration.synced && !loaded) {
          syncDocument();
          replaceInputState({
            ...defaultState,
            code: currentContent,
            editorMode: 'code',
            mermaid: currentConfig
          });
          loaded = true;
          void loadVersions();
        }
      });
      cleanup = () => {
        unsubscribe();
        collaboration.code.unobserve(syncDocument);
        collaboration.config.unobserve(syncDocument);
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

<div class="flex h-full min-h-0 flex-col" bind:clientWidth={width}>
  <header
    class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 md:px-5">
    <div class="min-w-0">
      <h1 class="truncate text-sm font-semibold md:text-base">{title}</h1>
      <p class="text-[11px] text-slate-500" aria-live="polite">
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
            class="grid size-8 place-items-center rounded-full border-2 border-white text-[10px] font-bold text-white"
            style={`background: ${user.color}`}
            title={user.displayName}>{presenceInitials(user.displayName)}</span>
        {/each}
      </div>
      <Button
        size="sm"
        variant={toolsPanel === 'history' ? 'secondary' : 'ghost'}
        onclick={() => (toolsPanel = toolsPanel === 'history' ? null : 'history')}>
        <HistoryIcon /> <span class="hidden sm:inline">Versions</span>
      </Button>
      {#if role === 'owner'}
        <Button
          size="sm"
          variant={toolsPanel === 'share' ? 'secondary' : 'ghost'}
          onclick={openShare}>
          <ShareIcon /> <span class="hidden sm:inline">Share</span>
        </Button>
      {/if}
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

  {#if toolsPanel === 'history'}
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
  {:else if toolsPanel === 'share' && role === 'owner' && diagram}
    <section
      class="max-h-[45vh] shrink-0 overflow-auto border-b border-slate-200 bg-white p-4"
      aria-labelledby="share-access-heading">
      <h2 id="share-access-heading" class="mx-auto mb-3 max-w-2xl font-semibold">Manage access</h2>
      <form class="mx-auto flex max-w-2xl flex-wrap items-end gap-3" onsubmit={share}>
        <label class="min-w-56 flex-1 text-sm font-medium">
          Registered user email
          <Input class="mt-1" type="email" required bind:value={memberEmail} />
        </label>
        <label class="text-sm font-medium">
          Role
          <select
            class="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-3"
            bind:value={memberRole}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
        </label>
        <Button type="submit">Add access</Button>
      </form>
      <p class="mx-auto mt-2 max-w-2xl text-xs text-slate-500">
        {diagram.folderId
          ? 'Access applies to this folder and its diagrams.'
          : 'Access applies to this root diagram.'}
      </p>
      <div class="mx-auto mt-4 max-w-2xl border-t border-slate-200 pt-3">
        <h3 class="text-sm font-semibold">People with direct access</h3>
        {#if membersLoading && members.length === 0}
          <p class="mt-2 text-sm text-slate-500" role="status">Loading access...</p>
        {:else if members.length === 0}
          <p class="mt-2 text-sm text-slate-500">No direct members yet.</p>
        {:else}
          <ul class="mt-2 divide-y divide-slate-200">
            {#each members as member (member.userId)}
              <li class="flex flex-wrap items-center gap-3 py-3">
                <div class="min-w-48 flex-1">
                  <p class="text-sm font-medium">{member.displayName}</p>
                  <p class="text-xs text-slate-500">{member.email}</p>
                </div>
                <label class="text-xs font-medium" for={`member-role-${member.userId}`}>Role</label>
                <select
                  id={`member-role-${member.userId}`}
                  aria-label={`Role for ${member.displayName}`}
                  class="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={member.role}
                  disabled={pendingMemberId === member.userId}
                  onchange={(event) =>
                    updateMemberRole(member, event.currentTarget.value as 'editor' | 'viewer')}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <Button
                  variant="destructive"
                  disabled={pendingMemberId === member.userId}
                  aria-label={`Remove access for ${member.displayName}`}
                  onclick={() => removeMember(member)}>Remove</Button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if actionMessage}<p
          class={[
            'mx-auto mt-2 max-w-2xl text-sm',
            actionError ? 'text-red-700' : 'text-slate-600'
          ]}
          role={actionError ? 'alert' : 'status'}
          aria-live="polite">
          {actionMessage}
        </p>{/if}
    </section>
  {/if}

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
    <div class="grid min-h-0 flex-1 md:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
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
          <Editor
            {isMobile}
            collaboration={{
              awareness: controller.awareness,
              code: controller.code,
              config: controller.config,
              readOnly: role === 'viewer'
            }} />
        </div>
      </section>
      <section
        class={[
          'relative min-h-0 bg-[#f8f7f4]',
          mobilePanel === 'preview' ? 'block' : 'hidden',
          'md:block'
        ]}
        aria-label="Diagram preview">
        <View shouldShowGrid={validatedState.current.grid} />
      </section>
    </div>
  {/if}
</div>

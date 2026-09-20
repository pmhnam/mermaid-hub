<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import AppearanceToggle from '$lib/components/AppearanceToggle.svelte';
  import SqlImportDialog from '$lib/components/SqlImportDialog.svelte';
  import ImportIcon from '~icons/material-symbols/upload-file-outline-rounded';
  import { Input } from '$lib/components/ui/input';
  import { auth } from '$lib/product/auth.svelte';
  import { ApiError } from '$lib/product/api';
  import {
    folderDescendantIds,
    removeTreeDiagram,
    removeTreeFolder,
    replaceTreeDiagram,
    replaceTreeFolder,
    toTreeRows
  } from '$lib/product/tree';
  import type { WorkspaceTree } from '$lib/product/types';
  import { defaultState } from '$lib/constants';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, type Snippet } from 'svelte';
  import ChevronRight from '~icons/material-symbols/chevron-right-rounded';
  import CollapseIcon from '~icons/material-symbols/keyboard-double-arrow-left-rounded';
  import DiagramIcon from '~icons/material-symbols/insert-chart-outline-rounded';
  import FolderIcon from '~icons/material-symbols/folder-outline-rounded';
  import MenuIcon from '~icons/material-symbols/menu-rounded';
  import MoreIcon from '~icons/material-symbols/more-horiz';
  import PlusIcon from '~icons/material-symbols/add-rounded';
  import SignOutIcon from '~icons/material-symbols/logout-rounded';

  const { children, params }: { children: Snippet; params: { workspaceId: string } } = $props();
  let tree = $state<WorkspaceTree | null>(null);
  let error = $state('');
  let sidebarOpen = $state(false);
  let sidebarCollapsed = $state(false);
  let sqlImportOpen = $state(false);
  const importSchema = async (code: string, title: string) => {
    const diagram = await auth.api.createDiagram(params.workspaceId, {
      currentConfig: '{}',
      currentContent: code,
      title
    });
    await loadTree();
    sidebarOpen = false;
    await goto(`${base}/workspace/${params.workspaceId}/diagram/${diagram.id}`);
  };
  let creation = $state<'diagram' | 'folder' | null>(null);
  let name = $state('');
  let folderId = $state('');
  let creating = $state(false);
  let management = $state<{ id: string; kind: 'diagram' | 'folder' } | null>(null);
  let managementName = $state('');
  let managementParentId = $state('');
  let mutating = $state(false);
  let rows = $derived(tree ? toTreeRows(tree) : []);
  let unavailableFolderTargets = $derived(
    tree && management?.kind === 'folder'
      ? [...folderDescendantIds(tree.folders, management.id)]
      : []
  );

  const loadTree = async (): Promise<void> => {
    tree = await auth.api.getWorkspaceTree(params.workspaceId);
  };

  onMount(async () => {
    await auth.initialize();
    if (auth.current.status !== 'authenticated') {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      await goto(`${base}/login?redirect=${redirect}`);
      return;
    }
    try {
      await loadTree();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        await goto(`${base}/login`);
      } else {
        error = caught instanceof ApiError ? caught.message : 'Unable to load this workspace.';
      }
    }
  });

  const openCreation = (kind: 'diagram' | 'folder'): void => {
    sidebarCollapsed = false;
    creation = kind;
    name = '';
    folderId = '';
    error = '';
  };

  const folderLabel = (folderId: string): string => {
    if (!tree) return '';
    const byId = new Map(tree.folders.map((folder) => [folder.id, folder]));
    const names: string[] = [];
    const visited: string[] = [];
    let folder = byId.get(folderId);
    while (folder && !visited.includes(folder.id)) {
      names.unshift(folder.name);
      visited.push(folder.id);
      folder = folder.parentId ? byId.get(folder.parentId) : undefined;
    }
    return names.join(' / ');
  };

  const openManagement = (kind: 'diagram' | 'folder', id: string): void => {
    if (!tree) return;
    const item =
      kind === 'folder'
        ? tree.folders.find((folder) => folder.id === id)
        : tree.diagrams.find((diagram) => diagram.id === id);
    if (!item) return;
    management = { id, kind };
    managementName = 'name' in item ? item.name : item.title;
    managementParentId = ('parentId' in item ? item.parentId : item.folderId) ?? '';
    creation = null;
    error = '';
  };

  const create = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity() || !creation) return;
    if (!name.trim()) {
      error = `Enter a ${creation === 'folder' ? 'folder name' : 'diagram title'}.`;
      return;
    }
    creating = true;
    error = '';
    try {
      if (creation === 'folder') {
        await auth.api.createFolder(params.workspaceId, {
          name: name.trim(),
          parentId: folderId || undefined
        });
        await loadTree();
      } else {
        const diagram = await auth.api.createDiagram(params.workspaceId, {
          currentConfig: defaultState.mermaid,
          currentContent: defaultState.code,
          folderId: folderId || undefined,
          title: name.trim()
        });
        await loadTree();
        sidebarOpen = false;
        await goto(`${base}/workspace/${params.workspaceId}/diagram/${diagram.id}`);
      }
      creation = null;
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : `Unable to create ${creation}.`;
    } finally {
      creating = false;
    }
  };

  const updateItem = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (!tree || !management || !managementName.trim()) return;
    const currentManagement = management;
    mutating = true;
    error = '';
    try {
      if (currentManagement.kind === 'folder') {
        const updated = await auth.api.updateFolder(currentManagement.id, {
          name: managementName.trim(),
          parentId: managementParentId || null
        });
        tree = replaceTreeFolder(tree, updated);
      } else {
        const updated = await auth.api.updateDiagram(currentManagement.id, {
          folderId: managementParentId || null,
          title: managementName.trim()
        });
        tree = replaceTreeDiagram(tree, updated);
        window.dispatchEvent(new CustomEvent('product-diagram-updated', { detail: updated }));
      }
      management = null;
    } catch (caught) {
      error =
        caught instanceof ApiError ? caught.message : `Unable to update ${currentManagement.kind}.`;
    } finally {
      mutating = false;
    }
  };

  const deleteItem = async (): Promise<void> => {
    if (!tree || !management) return;
    const currentManagement = management;
    const label = managementName.trim();
    if (!confirm(`Delete ${management.kind} "${label}"? This cannot be undone.`)) return;
    mutating = true;
    error = '';
    try {
      if (currentManagement.kind === 'folder') {
        const removed = folderDescendantIds(tree.folders, currentManagement.id);
        const activeDiagram = tree.diagrams.find((diagram) => diagram.id === page.params.diagramId);
        await auth.api.deleteFolder(currentManagement.id);
        tree = removeTreeFolder(tree, currentManagement.id);
        if (activeDiagram?.folderId && removed.has(activeDiagram.folderId)) {
          await goto(`${base}/workspace/${params.workspaceId}`);
        }
      } else {
        await auth.api.deleteDiagram(currentManagement.id);
        tree = removeTreeDiagram(tree, currentManagement.id);
        if (page.params.diagramId === currentManagement.id) {
          await goto(`${base}/workspace/${params.workspaceId}`);
        }
      }
      management = null;
    } catch (caught) {
      error =
        caught instanceof ApiError ? caught.message : `Unable to delete ${currentManagement.kind}.`;
    } finally {
      mutating = false;
    }
  };

  const logout = async (): Promise<void> => {
    await auth.logout();
    await goto(`${base}/login`);
  };
</script>

<svelte:head>
  <title>{tree?.workspace.name ?? 'Workspace'} | Mermaid</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="flex h-dvh overflow-hidden bg-background text-foreground">
  {#if sidebarOpen}
    <button
      class="fixed inset-0 z-20 bg-slate-950/40 md:hidden"
      aria-label="Close workspace navigation"
      onclick={() => (sidebarOpen = false)}></button>
  {/if}

  <aside
    class={[
      'fixed inset-y-0 left-0 z-30 flex w-[19rem] shrink-0 flex-col overflow-x-hidden border-r border-slate-800 bg-slate-950 text-slate-100 transition-[transform,width] md:relative md:translate-x-0',
      sidebarCollapsed ? 'md:w-16' : 'md:w-[19rem]',
      sidebarOpen ? 'translate-x-0' : '-translate-x-full'
    ]}>
    <header class={['border-b border-white/10 py-4', sidebarCollapsed ? 'px-3' : 'px-4']}>
      <div
        class={[
          'flex items-center gap-2',
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        ]}>
        {#if !sidebarCollapsed}<a
            class="truncate font-semibold tracking-tight"
            href={`${base}/edit`}>Mermaid</a
          >{/if}
        <Button
          class={[
            'hidden text-slate-400 hover:bg-white/10 hover:text-white md:inline-flex',
            sidebarCollapsed && 'rotate-180'
          ]}
          variant="ghost"
          size="icon"
          aria-label={sidebarCollapsed
            ? 'Expand workspace navigation'
            : 'Collapse workspace navigation'}
          onclick={() => (sidebarCollapsed = !sidebarCollapsed)}><CollapseIcon /></Button>
      </div>
      {#if !sidebarCollapsed}
        <p class="mt-4 truncate text-lg font-medium">
          {tree?.workspace.name ?? 'Loading workspace…'}
        </p>
        <p class="mt-1 font-mono text-[10px] tracking-[0.18em] text-slate-500 uppercase">
          {tree?.workspace.kind ?? 'Workspace'}
        </p>
      {/if}
    </header>

    <div class={['px-3 py-2', sidebarCollapsed && 'flex justify-center']}>
      <AppearanceToggle iconOnly={sidebarCollapsed} />
    </div>

    <div class={['grid gap-2 px-3 py-4', sidebarCollapsed ? 'grid-cols-1' : 'grid-cols-2']}>
      <Button
        class="border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
        variant="outline"
        size="sm"
        title="Create folder"
        onclick={() => openCreation('folder')}>
        <FolderIcon />
        <span class:sr-only={sidebarCollapsed}>Folder</span>
      </Button>
      <Button
        class="bg-rose-600 text-white hover:bg-rose-500"
        size="sm"
        title="Create diagram"
        onclick={() => openCreation('diagram')}>
        <PlusIcon />
        <span class:sr-only={sidebarCollapsed}>Diagram</span>
      </Button>
    </div>

    <div class="px-3 pb-3">
      <Button
        class="w-full border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
        size="sm"
        variant="outline"
        aria-label="Import SQL"
        title="Import SQL schema"
        onclick={() => (sqlImportOpen = true)}
        ><ImportIcon /><span class:sr-only={sidebarCollapsed}>Import SQL</span></Button>
    </div>

    {#if creation && !sidebarCollapsed}
      <form
        class="mx-4 mb-4 space-y-3 rounded-lg border border-white/10 bg-white/5 p-3"
        onsubmit={create}>
        <label for="new-item-name" class="block text-xs font-medium text-slate-300">
          {creation === 'folder' ? 'Folder name' : 'Diagram title'}
        </label>
        <Input
          id="new-item-name"
          class="border-white/15 bg-slate-900 text-white"
          maxlength={creation === 'folder' ? 120 : 160}
          required
          autofocus
          bind:value={name} />
        {#if tree?.folders.length}
          <label for="new-item-folder" class="block text-xs font-medium text-slate-300">
            {creation === 'folder' ? 'Parent folder' : 'Folder'}
          </label>
          <select
            id="new-item-folder"
            class="h-9 w-full rounded-md border border-white/15 bg-slate-900 px-2 text-sm"
            bind:value={folderId}>
            <option value="">Workspace root</option>
            {#each tree.folders as folder (folder.id)}
              <option value={folder.id}>{folderLabel(folder.id)}</option>
            {/each}
          </select>
        {/if}
        <div class="flex justify-end gap-2">
          <Button class="text-slate-300" variant="ghost" size="sm" onclick={() => (creation = null)}
            >Cancel</Button>
          <Button
            class="bg-white text-slate-950 hover:bg-slate-200"
            size="sm"
            type="submit"
            disabled={creating}>Create</Button>
        </div>
      </form>
    {/if}

    {#if management && tree && !sidebarCollapsed}
      <form
        class="mx-4 mb-4 space-y-3 rounded-lg border border-white/10 bg-white/5 p-3"
        aria-label={`Manage ${management.kind}`}
        onsubmit={updateItem}>
        <label for="manage-item-name" class="block text-xs font-medium text-slate-300">
          {management.kind === 'folder' ? 'Folder name' : 'Diagram title'}
        </label>
        <Input
          id="manage-item-name"
          class="border-white/15 bg-slate-900 text-white"
          required
          bind:value={managementName} />
        <label for="manage-item-parent" class="block text-xs font-medium text-slate-300">
          {management.kind === 'folder' ? 'Parent folder' : 'Folder'}
        </label>
        <select
          id="manage-item-parent"
          class="h-9 w-full rounded-md border border-white/15 bg-slate-900 px-2 text-sm"
          bind:value={managementParentId}>
          <option value="">Workspace root</option>
          {#each tree.folders as folder (folder.id)}
            {#if management.kind === 'diagram' || !unavailableFolderTargets.includes(folder.id)}
              <option value={folder.id}>{folderLabel(folder.id)}</option>
            {/if}
          {/each}
        </select>
        <div class="flex justify-between gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={mutating}
            onclick={deleteItem}>
            Delete
          </Button>
          <div class="flex gap-2">
            <Button
              class="text-slate-300"
              type="button"
              variant="ghost"
              size="sm"
              onclick={() => (management = null)}>Cancel</Button>
            <Button class="bg-white text-slate-950" size="sm" type="submit" disabled={mutating}>
              Save
            </Button>
          </div>
        </div>
      </form>
    {/if}

    <nav
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-4"
      aria-label="Workspace diagrams">
      {#if !tree && !error}
        <p class="px-2 py-4 text-sm text-slate-500" role="status">Loading documents…</p>
      {:else if rows.length === 0}
        <p class="px-2 py-4 text-sm leading-6 text-slate-500">
          No diagrams yet. Create one to begin.
        </p>
      {:else}
        {#each rows as row (row.folder?.id ?? row.diagram?.id)}
          {#if row.folder}
            <div
              class={[
                'flex h-9 items-center rounded-md text-sm text-slate-400 hover:bg-white/5',
                sidebarCollapsed ? 'justify-center' : 'gap-2 pr-1'
              ]}
              title={row.folder.name}
              style:padding-left={sidebarCollapsed ? undefined : `${0.5 + row.depth * 0.8}rem`}>
              {#if !sidebarCollapsed}<ChevronRight class="size-4" />{/if}
              <FolderIcon class="size-4" />
              {#if !sidebarCollapsed}
                <span class="min-w-0 flex-1 truncate">{row.folder.name}</span>
                <button
                  class="grid size-7 shrink-0 place-items-center rounded hover:bg-white/10 hover:text-white"
                  aria-label={`Manage folder ${row.folder.name}`}
                  onclick={() => row.folder && openManagement('folder', row.folder.id)}
                  ><MoreIcon /></button>
              {/if}
            </div>
          {:else if row.diagram}
            <div
              class={[
                'flex h-9 items-center rounded-md hover:bg-white/10',
                !sidebarCollapsed && 'pr-1',
                page.url.pathname.endsWith(`/diagram/${row.diagram.id}`) && 'bg-white/10'
              ]}
              style:padding-left={sidebarCollapsed ? undefined : `${0.5 + row.depth * 0.8}rem`}>
              <a
                class={[
                  'flex h-full min-w-0 flex-1 items-center text-sm text-slate-200',
                  sidebarCollapsed ? 'justify-center' : 'gap-2'
                ]}
                aria-label={row.diagram.title}
                title={row.diagram.title}
                href={`${base}/workspace/${params.workspaceId}/diagram/${row.diagram.id}`}
                onclick={() => (sidebarOpen = false)}>
                <DiagramIcon class="size-4 shrink-0 text-rose-400" />
                {#if !sidebarCollapsed}<span class="truncate">{row.diagram.title}</span>{/if}
              </a>
              {#if !sidebarCollapsed}
                <button
                  class="grid size-7 shrink-0 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white"
                  aria-label={`Manage diagram ${row.diagram.title}`}
                  onclick={() => row.diagram && openManagement('diagram', row.diagram.id)}
                  ><MoreIcon /></button>
              {/if}
            </div>
          {/if}
        {/each}
      {/if}
    </nav>

    <footer
      class={[
        'flex items-center border-t border-white/10 py-4',
        sidebarCollapsed ? 'justify-center px-3' : 'justify-between gap-3 px-4'
      ]}>
      {#if !sidebarCollapsed}
        <div class="min-w-0">
          <p class="truncate text-sm">{auth.current.user?.displayName ?? ''}</p>
          <p class="truncate text-xs text-slate-500">{auth.current.user?.email ?? ''}</p>
        </div>
      {/if}
      <Button
        class="text-slate-400 hover:bg-white/10 hover:text-white"
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        onclick={logout}><SignOutIcon /></Button>
    </footer>
  </aside>

  <main class="flex min-w-0 flex-1 flex-col">
    <div
      class="flex h-14 shrink-0 items-center border-b bg-background/95 px-3 backdrop-blur md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open workspace navigation"
        onclick={() => (sidebarOpen = true)}><MenuIcon /></Button>
      <span class="ml-2 truncate font-medium">{tree?.workspace.name ?? 'Workspace'}</span>
    </div>
    {#if error}
      <div class="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
        {error}
      </div>
    {/if}
    <div class="min-h-0 flex-1">
      {#if auth.current.status === 'authenticated'}
        {@render children()}
      {:else}
        <div class="grid h-full place-items-center text-sm text-slate-500" role="status">
          Checking your session…
        </div>
      {/if}
    </div>
  </main>
</div>
<SqlImportDialog bind:open={sqlImportOpen} onImport={importSchema} />

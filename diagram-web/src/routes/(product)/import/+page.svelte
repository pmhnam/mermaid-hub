<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { auth } from '$lib/product/auth.svelte';
  import { ApiError } from '$lib/product/api';
  import type { State } from '$lib/types';
  import type { Workspace } from '$lib/product/types';
  import { deserializeState } from '$lib/util/serde';
  import { sanitizeConfig } from '$lib/util/state.svelte';
  import { onMount } from 'svelte';

  let workspaces = $state<Workspace[]>([]);
  let selectedWorkspaceId = $state('');
  let title = $state('Imported diagram');
  let importedState = $state<State | null>(null);
  let loading = $state(true);
  let importing = $state(false);
  let error = $state('');

  const importUrl = (): string =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

  onMount(async () => {
    if (auth.current.status !== 'authenticated') {
      await auth.initialize();
    }
    if (auth.current.status !== 'authenticated') {
      await goto(`${base}/login?redirect=${encodeURIComponent(importUrl())}`);
      return;
    }

    try {
      const serialized = window.location.hash.slice(1);
      if (!serialized) throw new Error('The diagram state is missing from this link.');
      const nextState = deserializeState(serialized);
      nextState.mermaid = sanitizeConfig(nextState.mermaid);
      importedState = nextState;
      workspaces = await auth.api.getWorkspaces();
      selectedWorkspaceId = workspaces[0]?.id ?? '';
      if (workspaces.length === 0) error = 'Your account does not have a workspace yet.';
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : 'Unable to import this diagram.';
    } finally {
      loading = false;
    }
  });

  const save = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (!importedState || !selectedWorkspaceId || !title.trim()) return;
    importing = true;
    error = '';
    try {
      const diagram = await auth.api.createDiagram(selectedWorkspaceId, {
        currentConfig: importedState.mermaid,
        currentContent: importedState.code,
        title: title.trim()
      });
      await goto(`${base}/workspace/${selectedWorkspaceId}/diagram/${diagram.id}`);
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : 'Unable to save this diagram.';
    } finally {
      importing = false;
    }
  };
</script>

<svelte:head>
  <title>Save diagram | Mermaid Workspace</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-white">
  <section class="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
    <a class="text-lg font-semibold tracking-tight text-rose-300" href={`${base}/edit`}>Mermaid</a>
    <p class="mt-10 font-mono text-xs tracking-[0.24em] text-rose-300 uppercase">Workspace</p>
    <h1 class="mt-3 text-3xl font-semibold tracking-tight">Save this diagram</h1>
    <p class="mt-3 leading-7 text-slate-300">
      Keep the current diagram in your workspace so you can edit and share it with your team.
    </p>

    {#if loading}
      <p class="mt-8 text-sm text-slate-400">Preparing your diagram...</p>
    {:else if importedState}
      <form class="mt-8 flex flex-col gap-5" onsubmit={save}>
        <label class="flex flex-col gap-2 text-sm font-medium" for="diagram-title">
          Diagram name
          <Input id="diagram-title" bind:value={title} required minlength={1} />
        </label>
        <label class="flex flex-col gap-2 text-sm font-medium" for="workspace">
          Workspace
          <select
            id="workspace"
            bind:value={selectedWorkspaceId}
            required
            class="h-10 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white">
            {#each workspaces as workspace (workspace.id)}
              <option value={workspace.id}>{workspace.name}</option>
            {/each}
          </select>
        </label>
        <Button type="submit" variant="accent" disabled={importing || !selectedWorkspaceId}>
          {importing ? 'Saving...' : 'Save to workspace'}
        </Button>
      </form>
    {/if}

    {#if error}
      <p class="mt-6 rounded-md border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-200">
        {error}
      </p>
    {/if}

    <a class="mt-8 inline-block text-sm text-slate-400 hover:text-white" href={`${base}/edit`}>
      Return to Live Editor
    </a>
  </section>
</div>

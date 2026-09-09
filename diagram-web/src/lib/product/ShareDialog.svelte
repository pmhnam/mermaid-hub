<script lang="ts">
  import { base } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { ApiError } from '$lib/product/api';
  import { auth } from '$lib/product/auth.svelte';
  import type { Diagram, PublicLink, PublicLinkMode, ResourceMember } from '$lib/product/types';
  import CopyIcon from '~icons/material-symbols/content-copy-outline-rounded';
  import RefreshIcon from '~icons/material-symbols/refresh-rounded';

  interface Props {
    diagram: Diagram;
    open: boolean;
  }

  let { diagram, open = $bindable() }: Props = $props();
  let memberEmail = $state('');
  let memberRole = $state<'editor' | 'viewer'>('viewer');
  let members = $state<ResourceMember[]>([]);
  let membersLoading = $state(false);
  let pendingMemberId = $state<string | null>(null);
  let publicLink = $state<PublicLink | null>(null);
  let publicMode = $state<PublicLinkMode>('public_read');
  let publicLoading = $state(false);
  let initializedFor = $state('');
  let message = $state('');
  let messageIsError = $state(false);
  let publicUrl = $derived(
    publicLink && typeof window !== 'undefined'
      ? `${window.location.origin}${base}/share#${publicLink.shareToken}`
      : ''
  );

  const setMessage = (value: string, isError = false): void => {
    message = value;
    messageIsError = isError;
  };

  const loadMembers = async (): Promise<void> => {
    membersLoading = true;
    try {
      members = diagram.folderId
        ? await auth.api.getFolderMembers(diagram.folderId)
        : await auth.api.getDiagramMembers(diagram.id);
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Unable to load access.', true);
    } finally {
      membersLoading = false;
    }
  };

  const loadPublicLink = async (): Promise<void> => {
    publicLoading = true;
    try {
      publicLink = await auth.api.getPublicLink(diagram.id);
      publicMode = publicLink.mode;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) publicLink = null;
      else {
        setMessage(
          caught instanceof ApiError ? caught.message : 'Unable to load public link.',
          true
        );
      }
    } finally {
      publicLoading = false;
    }
  };

  $effect(() => {
    if (!open) {
      initializedFor = '';
      return;
    }
    if (initializedFor === diagram.id) return;
    initializedFor = diagram.id;
    setMessage('');
    void Promise.all([loadMembers(), loadPublicLink()]);
  });

  const addMember = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (!memberEmail.trim()) return;
    setMessage('');
    try {
      const input = { email: memberEmail.trim(), role: memberRole };
      if (diagram.folderId) await auth.api.addFolderMember(diagram.folderId, input);
      else await auth.api.addDiagramMember(diagram.id, input);
      memberEmail = '';
      setMessage('Access added.');
      await loadMembers();
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Unable to add access.', true);
    }
  };

  const updateMemberRole = async (
    member: ResourceMember,
    nextRole: 'editor' | 'viewer'
  ): Promise<void> => {
    if (member.role === nextRole) return;
    pendingMemberId = member.userId;
    setMessage('');
    try {
      const input = { role: nextRole };
      if (diagram.folderId)
        await auth.api.updateFolderMember(diagram.folderId, member.userId, input);
      else await auth.api.updateDiagramMember(diagram.id, member.userId, input);
      setMessage(`${member.displayName}'s role updated to ${nextRole}.`);
      await loadMembers();
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Unable to update access.', true);
      await loadMembers();
    } finally {
      pendingMemberId = null;
    }
  };

  const removeMember = async (member: ResourceMember): Promise<void> => {
    if (!confirm(`Remove access for ${member.displayName} (${member.email})?`)) return;
    pendingMemberId = member.userId;
    setMessage('');
    try {
      if (diagram.folderId) await auth.api.deleteFolderMember(diagram.folderId, member.userId);
      else await auth.api.deleteDiagramMember(diagram.id, member.userId);
      setMessage(`Access removed for ${member.displayName}.`);
      await loadMembers();
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Unable to remove access.', true);
    } finally {
      pendingMemberId = null;
    }
  };

  const savePublicLink = async (mode: PublicLinkMode): Promise<void> => {
    publicLoading = true;
    setMessage('');
    try {
      publicLink = await auth.api.upsertPublicLink(diagram.id, mode);
      publicMode = publicLink.mode;
      setMessage(
        publicLink.createdAt === publicLink.updatedAt
          ? 'Public link created.'
          : 'Public link updated.'
      );
    } catch (caught) {
      if (publicLink) publicMode = publicLink.mode;
      setMessage(
        caught instanceof ApiError ? caught.message : 'Unable to update public link.',
        true
      );
    } finally {
      publicLoading = false;
    }
  };

  const rotatePublicLink = async (): Promise<void> => {
    if (!confirm('Replace this public link? The current link will stop working immediately.'))
      return;
    publicLoading = true;
    setMessage('');
    try {
      publicLink = await auth.api.rotatePublicLink(diagram.id);
      setMessage('Public link replaced.');
    } catch (caught) {
      setMessage(
        caught instanceof ApiError ? caught.message : 'Unable to replace public link.',
        true
      );
    } finally {
      publicLoading = false;
    }
  };

  const revokePublicLink = async (): Promise<void> => {
    if (!confirm('Turn off public access? Anyone using this link will be disconnected.')) return;
    publicLoading = true;
    setMessage('');
    try {
      await auth.api.revokePublicLink(diagram.id);
      publicLink = null;
      setMessage('Public access turned off.');
    } catch (caught) {
      setMessage(
        caught instanceof ApiError ? caught.message : 'Unable to turn off public access.',
        true
      );
    } finally {
      publicLoading = false;
    }
  };

  const copyPublicLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage('Public link copied.');
    } catch {
      setMessage('Unable to copy automatically. Select and copy the link instead.', true);
    }
  };
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title class="text-xl">Share diagram</Dialog.Title>
      <Dialog.Description>Invite workspace members or publish a revocable link.</Dialog.Description>
    </Dialog.Header>

    <section
      class="rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-labelledby="public-link-heading">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="public-link-heading" class="font-semibold">Public link</h2>
          <p class="mt-1 text-sm text-slate-500">
            Anyone with the link can access this diagram without signing in.
          </p>
        </div>
        {#if publicLink}
          <Button
            variant="destructive"
            size="sm"
            disabled={publicLoading}
            onclick={revokePublicLink}>Turn off</Button>
        {:else}
          <Button size="sm" disabled={publicLoading} onclick={() => savePublicLink(publicMode)}
            >Create link</Button>
        {/if}
      </div>

      <fieldset class="mt-4 grid gap-2 sm:grid-cols-2" disabled={publicLoading}>
        <legend class="sr-only">Public link permission</legend>
        {#each [{ description: 'View live updates and export files.', label: 'Can view', value: 'public_read' }, { description: 'Edit code and config in real time.', label: 'Can edit', value: 'public_edit' }] as option (option.value)}
          <label
            class="flex cursor-pointer gap-3 rounded-lg border border-slate-200 bg-white p-3 has-checked:border-rose-500 has-checked:ring-1 has-checked:ring-rose-500">
            <input
              class="mt-1"
              type="radio"
              name="public-link-mode"
              value={option.value}
              checked={publicMode === option.value}
              onchange={() => {
                publicMode = option.value as PublicLinkMode;
                if (publicLink) void savePublicLink(publicMode);
              }} />
            <span
              ><span class="block text-sm font-semibold">{option.label}</span><span
                class="block text-xs text-slate-500">{option.description}</span
              ></span>
          </label>
        {/each}
      </fieldset>

      {#if publicLink}
        <div class="mt-4 flex gap-2">
          <Input
            aria-label="Public diagram link"
            class="font-mono text-xs"
            readonly
            value={publicUrl}
            onclick={(event) => event.currentTarget.select()} />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy public link"
            onclick={copyPublicLink}><CopyIcon /></Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Replace public link"
            disabled={publicLoading}
            onclick={rotatePublicLink}><RefreshIcon /></Button>
        </div>
        <p class="mt-2 text-xs text-slate-500">
          The access token stays in the URL fragment and is not sent in page requests.
        </p>
      {/if}
    </section>

    <section class="border-t border-slate-200 pt-4" aria-labelledby="member-access-heading">
      <h2 id="member-access-heading" class="font-semibold">Workspace access</h2>
      <form class="mt-3 flex flex-wrap items-end gap-3" onsubmit={addMember}>
        <label class="min-w-56 flex-1 text-sm font-medium"
          >Registered user email<Input
            class="mt-1"
            type="email"
            required
            bind:value={memberEmail} /></label>
        <label class="text-sm font-medium"
          >Role<select
            class="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-3"
            bind:value={memberRole}
            ><option value="viewer">Viewer</option><option value="editor">Editor</option></select
          ></label>
        <Button type="submit">Add access</Button>
      </form>
      <p class="mt-2 text-xs text-slate-500">
        {diagram.folderId
          ? 'Access applies to this folder and its diagrams.'
          : 'Access applies to this root diagram.'}
      </p>

      <div class="mt-4 border-t border-slate-200 pt-3">
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
                    updateMemberRole(member, event.currentTarget.value as 'editor' | 'viewer')}
                  ><option value="viewer">Viewer</option><option value="editor">Editor</option
                  ></select>
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
    </section>

    {#if message}<p
        class={['text-sm', messageIsError ? 'text-red-700' : 'text-slate-600']}
        role={messageIsError ? 'alert' : 'status'}
        aria-live="polite">
        {message}
      </p>{/if}
  </Dialog.Content>
</Dialog.Root>

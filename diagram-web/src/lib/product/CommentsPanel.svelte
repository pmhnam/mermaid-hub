<script lang="ts">
  import * as Dialog from '$/components/ui/dialog';
  import { Button } from '$/components/ui/button';
  import { auth } from './auth.svelte';
  import type { DiagramComment } from './types';
  let {
    diagramId,
    open = $bindable(),
    target = $bindable(),
    owner
  }: { diagramId: string; open: boolean; target?: string; owner: boolean } = $props();
  let comments = $state<DiagramComment[]>([]);
  let body = $state('');
  let error = $state('');
  let busy = $state(false);
  let loaded = $state(false);
  let showResolved = $state(false);
  let generation = 0;
  const load = async () => {
    const current = generation;
    try {
      const result = await auth.api.getComments(diagramId);
      if (current === generation) {
        comments = result;
        loaded = true;
      }
    } catch (caught) {
      if (current === generation)
        error = caught instanceof Error ? caught.message : 'Unable to load comments';
    }
  };
  $effect(() => {
    if (!open) return;
    generation++;
    error = '';
    loaded = false;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      clearInterval(timer);
      generation++;
    };
  });
  const mutate = async (action: () => Promise<unknown>) => {
    busy = true;
    error = '';
    try {
      await action();
      await load();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Unable to save comment';
    } finally {
      busy = false;
    }
  };
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[85dvh] flex-col sm:max-w-xl">
    <Dialog.Header
      ><Dialog.Title>Comments</Dialog.Title><Dialog.Description
        >Discuss this diagram with people who have workspace access.</Dialog.Description
      ></Dialog.Header>
    <div class="flex items-center justify-between text-xs">
      <label><input type="checkbox" bind:checked={showResolved} /> Show resolved</label><button
        class="rounded border px-2 py-1"
        onclick={load}>Refresh</button>
    </div>
    <div class="min-h-20 flex-1 space-y-3 overflow-auto">
      {#if !loaded && !error}<p class="text-sm text-muted-foreground" role="status">
          Loading comments…
        </p>{/if}
      {#each comments.filter((comment) => showResolved || !comment.resolved) as comment (comment.id)}
        <article class="rounded-lg border bg-muted/30 p-3">
          <div class="flex justify-between gap-3 text-xs">
            <strong>{comment.authorName}</strong><time class="text-muted-foreground"
              >{new Date(comment.createdAt).toLocaleString()}</time>
          </div>
          {#if comment.target}<button
              class="mt-2 max-w-full truncate text-xs text-sky-700 underline dark:text-sky-300"
              onclick={() => {
                open = false;
                window.dispatchEvent(
                  new CustomEvent('mermaid-locate-node', { detail: comment.target })
                );
              }}>{comment.target}</button
            >{/if}
          <p class="my-2 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
          {#if comment.resolved}<span class="text-xs text-muted-foreground">Resolved</span>{/if}
          {#if owner || comment.authorId === auth.current.user?.id}<div class="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onclick={() =>
                  mutate(() => auth.api.resolveComment(diagramId, comment.id, !comment.resolved))}
                >{comment.resolved ? 'Reopen' : 'Resolve'}</Button
              ><Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onclick={() => mutate(() => auth.api.deleteComment(diagramId, comment.id))}
                >Delete comment</Button>
            </div>{/if}
        </article>
      {:else}{#if loaded}<p class="py-6 text-center text-sm text-muted-foreground">
            No {showResolved ? '' : 'open '}comments yet.
          </p>{/if}{/each}
      {#if comments.length === 100}<p class="text-xs text-muted-foreground">
          Showing the latest 100 comments.
        </p>{/if}
    </div>
    <form
      class="space-y-2 border-t pt-3"
      onsubmit={(event) => {
        event.preventDefault();
        void mutate(async () => {
          await auth.api.addComment(diagramId, body.trim(), target);
          body = '';
        });
      }}>
      {#if target}<p class="text-xs text-muted-foreground">
          On {target}<button
            type="button"
            class="ml-2"
            aria-label="Remove comment target"
            onclick={() => (target = undefined)}>×</button>
        </p>{/if}
      <textarea
        aria-label="Comment"
        disabled={busy}
        class="h-24 w-full rounded-lg border bg-background p-3 text-sm"
        bind:value={body}
        maxlength="4000"
        required
        placeholder="Leave feedback…"></textarea>
      <Button type="submit" disabled={busy || !body.trim()}>Post comment</Button>
    </form>
    {#if error}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{error}</p>{/if}
  </Dialog.Content>
</Dialog.Root>

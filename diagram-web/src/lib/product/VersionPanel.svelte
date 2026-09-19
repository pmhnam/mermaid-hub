<script lang="ts">
  import * as Dialog from '$/components/ui/dialog';
  import { Button } from '$/components/ui/button';
  import { Input } from '$/components/ui/input';
  import EmbedView from '$/components/EmbedView.svelte';
  import { PanZoomState } from '$/util/panZoom';
  import { createVersionDiff } from './version-diff';
  import type { DiagramVersion } from './types';
  let {
    open = $bindable(),
    versions,
    selected,
    loading,
    message = $bindable(),
    feedback,
    canSave,
    canRestore,
    diff,
    onSelect,
    onSave,
    onRestore
  }: {
    open: boolean;
    versions: DiagramVersion[];
    selected: DiagramVersion | null;
    loading: boolean;
    message: string;
    feedback: string;
    canSave: boolean;
    canRestore: boolean;
    diff: ReturnType<typeof createVersionDiff> | null;
    onSelect: (version: DiagramVersion) => void;
    onSave: () => void;
    onRestore: () => void;
  } = $props();
  const camera = new PanZoomState();
  let tab = $state<'preview' | 'changes'>('changes');
  const configuration = $derived.by(() => {
    try {
      return JSON.parse(selected?.config || '{}');
    } catch {
      return {};
    }
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="flex h-[85dvh] max-h-[900px] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
    <Dialog.Header class="border-b px-5 py-4"
      ><Dialog.Title>Version history</Dialog.Title><Dialog.Description
        >Review saved checkpoints, compare changes and restore a previous version.</Dialog.Description
      ></Dialog.Header>
    {#if canSave}<form
        class="flex shrink-0 gap-2 border-b bg-muted/40 p-3"
        onsubmit={(event) => {
          event.preventDefault();
          onSave();
        }}>
        <Input
          aria-label="Version note"
          placeholder="Version note (optional)"
          bind:value={message} /><Button type="submit">Save</Button>
      </form>{/if}
    <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[16rem_1fr]">
      <nav
        class="max-h-36 overflow-auto border-b p-2 md:max-h-none md:border-r md:border-b-0"
        aria-label="Saved versions">
        {#if loading}<p class="p-3 text-sm text-muted-foreground" role="status">
            Loading versions…
          </p>
        {:else if !versions.length}<div class="p-4 text-sm text-muted-foreground">
            No checkpoints yet. Save a version to mark an important change.
          </div>
        {:else}{#each versions as version (version.id)}<button
              class="mb-1 block w-full rounded-lg border border-transparent p-3 text-left hover:bg-muted"
              class:bg-muted={selected?.id === version.id}
              aria-current={selected?.id === version.id ? 'true' : undefined}
              onclick={() => onSelect(version)}
              ><span class="block text-sm font-medium"
                >v{version.versionNumber} · {version.message || version.type}</span
              ><time class="mt-1 block text-xs text-muted-foreground"
                >{new Date(version.createdAt).toLocaleString()}</time
              ></button
            >{/each}{/if}
      </nav>
      <section class="flex min-h-0 min-w-0 flex-col">
        {#if selected && diff}
          <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 class="text-sm font-semibold">Version {selected.versionNumber} preview and diff</h2>
            {#if canRestore}<Button variant="outline" size="sm" onclick={onRestore}>Restore</Button
              >{/if}
          </div>
          <div class="flex gap-2 border-b px-4 py-2">
            <Button
              size="sm"
              variant={tab === 'changes' ? 'secondary' : 'ghost'}
              onclick={() => (tab = 'changes')}>Changes</Button
            ><Button
              size="sm"
              variant={tab === 'preview' ? 'secondary' : 'ghost'}
              onclick={() => (tab = 'preview')}>Diagram preview</Button>
          </div>
          {#if tab === 'preview'}<div class="min-h-0 flex-1 bg-background">
              <EmbedView code={selected.content} config={configuration} panZoomState={camera} />
            </div>
          {:else}<div class="min-h-0 flex-1 space-y-4 overflow-auto p-4">
              {#each [{ title: 'Diagram source', parts: diff.content }, { title: 'Configuration', parts: diff.config }] as section (section.title)}<div>
                  <h3
                    class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {section.title}
                  </h3>
                  <pre
                    class="overflow-auto rounded-lg border bg-muted/30 p-3 text-xs leading-6">{#each section.parts as part, index (index)}<span
                        class={part.added
                          ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                          : part.removed
                            ? 'bg-rose-500/15 text-rose-800 dark:text-rose-300'
                            : 'text-muted-foreground'}
                        >{part.added ? '+ ' : part.removed ? '− ' : '  '}{part.value}</span
                      >{/each}</pre>
                </div>{/each}
            </div>{/if}
        {:else}<div
            class="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">
            Select a version to inspect its diagram and changes.
          </div>{/if}
      </section>
    </div>
    {#if feedback}<p class="shrink-0 border-t bg-muted/40 px-4 py-3 text-sm" role="status">
        {feedback}
      </p>{/if}
  </Dialog.Content>
</Dialog.Root>

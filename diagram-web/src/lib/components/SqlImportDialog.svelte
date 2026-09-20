<script lang="ts">
  import * as Dialog from '$/components/ui/dialog';
  import { Button } from '$/components/ui/button';
  import { importSql } from '$/sql/mermaidSql';
  import type { SqlDialect } from '$/sql/types';
  import { parse } from '$/util/mermaid';
  import { tick } from 'svelte';
  let {
    open = $bindable(false),
    onImport,
    replacesCurrent = false
  }: {
    open: boolean;
    onImport: (code: string, title: string) => Promise<void> | void;
    replacesCurrent?: boolean;
  } = $props();
  let dialect = $state<SqlDialect>('postgresql');
  let sql = $state('');
  let title = $state('Database schema');
  let error = $state('');
  let busy = $state(false);
  let result = $state<ReturnType<typeof importSql>>();
  let previewInput = '';
  let previewDialect: SqlDialect = 'postgresql';
  const valid = $derived(Boolean(result) && sql === previewInput && dialect === previewDialect);
  const readFile = async (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    error = '';
    result = undefined;
    if (file.size > 2_000_000) {
      error = 'Import a schema-only SQL file smaller than 2 MB.';
      return;
    }
    try {
      sql = await file.text();
      title = file.name.replace(/\.sql$/i, '').slice(0, 160) || 'Database schema';
    } catch {
      error = 'Unable to read this file.';
    }
  };
  const preview = async () => {
    busy = true;
    error = '';
    result = undefined;
    const source = sql,
      database = dialect;
    await tick();
    try {
      const next = importSql(source, database);
      await parse(next.code);
      result = next;
      previewInput = source;
      previewDialect = database;
    } catch (caught) {
      const offset =
        caught &&
        typeof caught === 'object' &&
        'offset' in caught &&
        typeof caught.offset === 'number'
          ? caught.offset
          : undefined;
      error =
        (caught instanceof Error ? caught.message : 'Unable to parse the SQL schema.') +
        (offset === undefined ? '' : ` (line ${source.slice(0, offset).split('\n').length})`);
    } finally {
      busy = false;
    }
  };
  const apply = async () => {
    if (!valid || !result || !title.trim()) return;
    busy = true;
    error = '';
    try {
      await onImport(result.code, title.trim());
      open = false;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Unable to import schema.';
    } finally {
      busy = false;
    }
  };
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-3xl">
    <Dialog.Header
      ><Dialog.Title>Import SQL schema</Dialog.Title><Dialog.Description
        >Paste CREATE TABLE DDL or choose a .sql file. Parsing runs locally in your browser; SQL is
        never executed.</Dialog.Description
      ></Dialog.Header>
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-sm"
        >Source database<select
          aria-label="Source database"
          class="mt-1 h-9 w-full rounded border bg-background px-2"
          bind:value={dialect}
          disabled={busy}
          ><option value="postgresql">PostgreSQL</option><option value="mysql"
            >MySQL / MariaDB</option
          ></select
        ></label>
      <label class="text-sm"
        >Diagram name<input
          class="mt-1 h-9 w-full rounded border bg-background px-2"
          maxlength="160"
          bind:value={title}
          disabled={busy} /></label>
    </div>
    <label class="text-sm"
      >SQL file<input
        aria-label="SQL file"
        class="mt-1 block w-full rounded border p-2 text-sm file:mr-3"
        type="file"
        accept=".sql,text/plain,application/sql"
        onchange={readFile}
        disabled={busy} /></label>
    <label class="text-sm"
      >SQL DDL<textarea
        aria-label="SQL DDL"
        class="mt-1 h-48 w-full rounded border bg-background p-3 font-mono text-xs"
        bind:value={sql}
        disabled={busy}
        spellcheck="false"
        placeholder="CREATE TABLE products (id bigint PRIMARY KEY, name varchar(255) NOT NULL);"
      ></textarea
      ></label>
    <div class="flex items-center gap-3">
      <Button disabled={busy || !sql.trim()} onclick={preview}
        >{busy ? 'Processing…' : 'Preview schema'}</Button
      ><span class="text-xs text-muted-foreground"
        >PostgreSQL schema-only dumps and MySQL/MariaDB table DDL · 2 MB max</span>
    </div>
    {#if result && valid}
      <section class="space-y-2 rounded-lg border bg-muted/30 p-3" aria-label="SQL import preview">
        <p class="text-sm font-medium">
          {result.tables} tables · {result.columns} columns · {result.relationships} foreign keys
        </p>
        <pre class="max-h-48 overflow-auto text-xs">{result.code.split(
            '\n%% sql-schema-v1:'
          )[0]}</pre>
        {#if result.warnings.length}<details open>
            <summary class="text-sm font-medium"
              >Conversion notes ({result.warnings.length})</summary>
            <ul class="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">
              {#each result.warnings as warning (warning)}<li>{warning}</li>{/each}
            </ul>
          </details>{/if}
        <p class="text-xs text-muted-foreground">
          SQL metadata is stored in a Mermaid comment for round-trip export. Keep that comment to
          retain defaults, indexes and FK column mappings.
        </p>
      </section>
    {/if}
    {#if replacesCurrent}<p class="text-xs text-muted-foreground">
        Import replaces the current diagram and resets manual positions.
      </p>{/if}
    {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
    <Dialog.Footer
      ><Button variant="outline" disabled={busy} onclick={() => (open = false)}>Cancel</Button
      ><Button disabled={busy || !valid || !title.trim()} onclick={apply}
        >{replacesCurrent ? 'Replace with ER diagram' : 'Create ER diagram'}</Button
      ></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

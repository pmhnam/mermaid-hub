<script lang="ts">
  import { Button, buttonVariants } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import {
    copyPngExport,
    downloadDiagramExport,
    exportDiagram,
    serializeDiagramSvg,
    type DiagramExportBackground,
    type DiagramExportFormat
  } from '$lib/product/export';
  import DownloadIcon from '~icons/material-symbols/download';
  import CopyIcon from '~icons/material-symbols/content-copy-outline-rounded';
  import { exportErSql, importedSqlDialect } from '$/sql/mermaidSql';
  import type { SqlDialect } from '$/sql/types';
  import { createExportFilename } from '$/product/export';

  interface Props {
    code: string;
    config: string;
    getSvgElement?: () => SVGSVGElement | null;
    open: boolean;
    svgElement: SVGSVGElement | null;
    title: string;
  }

  let { code, config, getSvgElement, open = $bindable(), svgElement, title }: Props = $props();
  let format = $state<DiagramExportFormat>('png');
  let backgroundType = $state<DiagramExportBackground['type']>('white');
  let customColor = $state('#f4efe6');
  let action = $state<'copy' | 'download' | null>(null);
  let error = $state('');
  let copied = $state(false);
  let currentSvgElement = $state<SVGSVGElement | null>(null);
  let sqlDialect = $state<SqlDialect>('postgresql');
  let sqlPreview = $state('');
  let sqlWarnings = $state<string[]>([]);
  let sqlError = $state('');
  let rememberedCode = '';
  $effect(() => {
    if (!open || code === rememberedCode) return;
    rememberedCode = code;
    try {
      sqlDialect = importedSqlDialect(code) ?? 'postgresql';
    } catch {
      /* Show the error when SQL export is selected. */
    }
  });
  $effect(() => {
    if (!open || format !== 'sql') return;
    copied = false;
    sqlError = '';
    sqlPreview = '';
    sqlWarnings = [];
    try {
      const result = exportErSql(code, sqlDialect);
      sqlPreview = result.sql;
      sqlWarnings = result.warnings;
    } catch (caught) {
      sqlError = caught instanceof Error ? caught.message : 'Unable to export SQL.';
    }
  });

  const background = $derived<DiagramExportBackground>(
    backgroundType === 'custom' ? { color: customColor, type: 'custom' } : { type: backgroundType }
  );
  const effectiveBackground = $derived<DiagramExportBackground>(
    format === 'pdf' ? { type: 'white' } : background
  );
  const previewSource = $derived(
    currentSvgElement
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          serializeDiagramSvg(currentSvgElement, effectiveBackground)
        )}`
      : ''
  );

  $effect(() => {
    if (!open) return;
    const refreshSvg = () => {
      const latest = getSvgElement?.() ?? svgElement;
      if (latest !== currentSvgElement) currentSvgElement = latest;
    };
    refreshSvg();
    const timer = setInterval(refreshSvg, 250);
    return () => clearInterval(timer);
  });

  const createExport = async (requestedFormat: DiagramExportFormat) => {
    const latestSvgElement = getSvgElement?.() ?? currentSvgElement ?? svgElement;
    if (!latestSvgElement && requestedFormat !== 'mmd') {
      throw new Error('The diagram preview is not ready to export.');
    }
    currentSvgElement = latestSvgElement;
    return exportDiagram({
      background,
      code,
      config,
      format: requestedFormat,
      svgElement: latestSvgElement as SVGSVGElement,
      title
    });
  };

  const download = async (): Promise<void> => {
    error = '';
    action = 'download';
    try {
      if (format === 'sql') {
        const result = exportErSql(code, sqlDialect);
        downloadDiagramExport({
          blob: new Blob([result.sql], { type: 'application/sql' }),
          filename: createExportFilename(title, 'sql')
        });
      } else downloadDiagramExport(await createExport(format));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The diagram could not be exported.';
    } finally {
      action = null;
    }
  };

  const copyPng = async (): Promise<void> => {
    error = '';
    copied = false;
    action = 'copy';
    try {
      await copyPngExport(createExport('png'));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The PNG could not be copied.';
    } finally {
      action = null;
    }
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      error = '';
      copied = false;
      currentSvgElement = null;
    }
  };
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title class="text-xl">Export diagram</Dialog.Title>
      <Dialog.Description>
        Download the current synchronized diagram and configuration.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_15rem]">
      <div class="space-y-5">
        <fieldset>
          <legend class="mb-2 text-sm font-semibold">Format</legend>
          <div class="grid grid-cols-5 gap-2">
            {#each ['png', 'svg', 'pdf', 'mmd', 'sql'] as value (value)}
              <label
                class="cursor-pointer rounded-md border border-input px-3 py-2 text-center text-sm font-medium has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground">
                <input
                  class="sr-only"
                  type="radio"
                  name="export-format"
                  bind:group={format}
                  {value} />
                {value.toUpperCase()}
              </label>
            {/each}
          </div>
        </fieldset>

        {#if format === 'sql'}
          <label class="block text-sm font-medium"
            >Target database<select
              aria-label="Target database"
              class="mt-2 h-9 w-full rounded border bg-background px-2"
              bind:value={sqlDialect}
              ><option value="postgresql">PostgreSQL</option><option value="mysql"
                >MySQL / MariaDB</option
              ></select
            ></label>
          <p class="mt-2 text-xs text-muted-foreground">
            Exports CREATE TABLE, constraints and indexes. This is a schema snapshot, not an
            incremental migration.
          </p>
        {:else}
          <fieldset disabled={format === 'mmd' || format === 'pdf'} class="disabled:opacity-50">
            <legend class="mb-2 text-sm font-semibold">Background</legend>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {#each ['white', 'black', 'transparent', 'custom'] as value (value)}
                <label
                  class="flex cursor-pointer items-center gap-2 rounded-md border border-input p-2 text-sm font-medium has-checked:border-primary has-checked:bg-primary/10 has-checked:ring-1 has-checked:ring-primary">
                  <input
                    class="accent-primary"
                    type="radio"
                    name="export-background"
                    bind:group={backgroundType}
                    {value} />
                  <span class="capitalize">{value}</span>
                </label>
              {/each}
            </div>
            {#if backgroundType === 'custom'}
              <label class="mt-3 flex items-center gap-3 text-sm font-medium">
                Custom color
                <Input class="h-9 w-20 p-1" type="color" bind:value={customColor} />
                <span class="font-mono text-xs text-muted-foreground">{customColor}</span>
              </label>
            {/if}
            {#if format === 'pdf'}
              <p class="mt-2 text-xs text-muted-foreground">
                PDF exports always use a white background.
              </p>
            {/if}
          </fieldset>
        {/if}
      </div>

      {#if format !== 'sql'}<section aria-labelledby="export-preview-heading">
          <h2 id="export-preview-heading" class="mb-2 text-sm font-semibold">Preview</h2>
          <div
            class="grid h-52 place-items-center overflow-hidden rounded-lg border border-input bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] p-3">
            {#if previewSource}
              <img
                class="max-h-full max-w-full"
                src={previewSource}
                alt={`Export preview of ${title}`} />
            {:else}
              <p class="px-4 text-center text-sm text-muted-foreground">
                Diagram preview unavailable
              </p>
            {/if}
          </div>
        </section>{/if}
    </div>
    {#if format === 'sql'}
      {#if sqlError}<p role="alert" class="text-sm text-destructive">{sqlError}</p>{/if}
      {#if sqlPreview}<label class="text-sm font-medium"
          >SQL preview<textarea
            aria-label="SQL preview"
            class="mt-2 h-64 w-full rounded border bg-background p-3 font-mono text-xs"
            readonly
            value={sqlPreview}></textarea
          ></label
        >{/if}
      {#if sqlWarnings.length}<details open>
          <summary class="text-sm font-medium">Conversion notes ({sqlWarnings.length})</summary>
          <ul
            class="mt-2 max-h-40 list-inside list-disc space-y-1 overflow-auto text-xs text-muted-foreground">
            {#each sqlWarnings as warning (warning)}<li>{warning}</li>{/each}
          </ul>
        </details>{/if}
    {/if}

    {#if error}
      <p class="text-sm text-destructive" role="alert">{error}</p>
    {/if}

    <Dialog.Footer>
      <Dialog.Close class={buttonVariants({ variant: 'outline' })} disabled={action !== null}>
        Cancel
      </Dialog.Close>
      {#if format === 'png'}
        <Button
          variant="outline"
          onclick={copyPng}
          disabled={action !== null || !currentSvgElement}>
          <CopyIcon />
          {action === 'copy' ? 'Copying...' : copied ? 'Copied PNG' : 'Copy PNG'}
        </Button>
      {/if}
      {#if format === 'sql'}<Button
          variant="outline"
          disabled={!sqlPreview || Boolean(sqlError)}
          onclick={async () => {
            try {
              await navigator.clipboard.writeText(sqlPreview);
              copied = true;
            } catch {
              error = 'Unable to copy. Select the SQL preview and copy it manually.';
            }
          }}>{copied ? 'Copied SQL' : 'Copy SQL'}</Button
        >{/if}
      <Button
        onclick={download}
        disabled={action !== null ||
          (format === 'sql'
            ? !sqlPreview || Boolean(sqlError)
            : !currentSvgElement && format !== 'mmd')}>
        <DownloadIcon />
        {action === 'download' ? 'Preparing export...' : `Download ${format.toUpperCase()}`}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

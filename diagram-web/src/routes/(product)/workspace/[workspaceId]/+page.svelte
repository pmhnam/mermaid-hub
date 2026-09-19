<script lang="ts">
  import { base } from '$app/paths';
</script>

<div class="flex h-full items-center justify-center overflow-auto p-6">
  <div class="max-w-lg border-l-4 border-rose-500 pl-6">
    <p class="font-mono text-xs tracking-[0.2em] text-slate-500 uppercase">Workspace</p>
    <h1 class="mt-3 text-3xl font-semibold tracking-tight">
      Choose a diagram or create a new one.
    </h1>
    <p class="mt-4 leading-7 text-muted-foreground">
      Documents in this workspace are saved to your account instead of encoded into a sharing URL.
    </p>
    <a
      class="mt-6 inline-block text-sm font-semibold text-rose-600 hover:underline"
      href={`${base}/edit`}>
      Open the public Live Editor
    </a>
  </div>
</div>

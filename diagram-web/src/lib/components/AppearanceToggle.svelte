<script lang="ts">
  import { setMode, userPrefersMode } from 'mode-watcher';
  let { compact = false }: { compact?: boolean } = $props();
</script>

<label class="inline-flex items-center gap-2 text-xs text-muted-foreground" title="Appearance">
  <span class:sr-only={compact}>Appearance</span>
  <select
    aria-label="Appearance"
    class="h-8 rounded-md border border-input bg-background px-2 text-foreground"
    value={userPrefersMode.current}
    onchange={(event) => setMode(event.currentTarget.value as 'light' | 'dark' | 'system')}>
    <option value="system">System</option><option value="light">Light</option><option value="dark"
      >Dark</option>
  </select>
</label>

<script lang="ts">
  import { resolve } from '$app/paths';
  import { Button, buttonVariants } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { auth } from '$lib/product/auth.svelte';
  import { onMount } from 'svelte';
  import AccountIcon from '~icons/material-symbols/account-circle-outline';

  let open = $state(false);

  onMount(() => {
    void auth.initialize();
  });

  const signOut = async (): Promise<void> => {
    try {
      await auth.logout();
    } catch {
      // The local session is cleared even if the server cannot be reached.
    } finally {
      open = false;
    }
  };
</script>

{#if auth.current.status === 'authenticated'}
  <Popover.Root bind:open>
    <Popover.Trigger
      class={buttonVariants({ size: 'sm', variant: 'outline' })}
      aria-label={`Account: ${auth.current.user.displayName}`}
      title={auth.current.user.displayName}>
      <AccountIcon class="size-5" />
      <span class="hidden max-w-32 truncate sm:inline">{auth.current.user.displayName}</span>
    </Popover.Trigger>
    <Popover.Content align="end" class="w-60 p-2">
      <div class="border-b px-2 py-2">
        <p class="truncate text-sm font-medium">{auth.current.user.displayName}</p>
        <p class="truncate text-xs text-muted-foreground">{auth.current.user.email}</p>
      </div>
      <a class="block rounded-md px-2 py-2 text-sm hover:bg-muted" href={resolve('/login', {})}>
        Open workspace
      </a>
      <button
        type="button"
        class="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
        onclick={signOut}>
        Sign out
      </button>
    </Popover.Content>
  </Popover.Root>
{:else if auth.current.status === 'anonymous'}
  <Button
    variant="outline"
    size="sm"
    class="px-2 sm:px-3"
    href={resolve('/login', {})}
    aria-label="Sign in">
    <AccountIcon class="size-5 sm:hidden" />
    <span class="hidden sm:inline">Sign in</span>
  </Button>
{:else}
  <span class="text-xs text-muted-foreground" aria-label="Checking sign-in status">...</span>
{/if}

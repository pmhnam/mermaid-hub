<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { auth } from '$lib/product/auth.svelte';
  import { ApiError } from '$lib/product/api';
  import { base, resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';

  const { mode }: { mode: 'login' | 'register' } = $props();
  const isRegister = $derived(mode === 'register');
  let displayName = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let submitting = $state(false);

  type ProductDestination =
    | { diagramId?: string; kind: 'workspace'; workspaceId: string }
    | { kind: 'import'; state: string };

  const productDestination = (value: string | null): ProductDestination | null => {
    if (!value) return null;
    const destination = new URL(value, window.location.origin);
    if (destination.origin !== window.location.origin) return null;
    const pathWithoutBase = destination.pathname.slice(base.length);
    const pathname = pathWithoutBase.startsWith('/') ? pathWithoutBase : `/${pathWithoutBase}`;
    const diagramMatch = /^\/workspace\/([^/]+)\/diagram\/([^/]+)$/.exec(pathname);
    if (diagramMatch) {
      return { diagramId: diagramMatch[2], kind: 'workspace', workspaceId: diagramMatch[1] };
    }
    const workspaceMatch = /^\/workspace\/([^/]+)$/.exec(pathname);
    if (workspaceMatch) return { kind: 'workspace', workspaceId: workspaceMatch[1] };
    if (pathname === '/import') return { kind: 'import', state: destination.hash.slice(1) };
    return null;
  };

  const continueToProduct = async (): Promise<void> => {
    const redirect = productDestination(page.url.searchParams.get('redirect'));
    if (redirect?.kind === 'import') {
      await goto(`${base}/import${redirect.state ? `#${redirect.state}` : ''}`);
      return;
    }
    if (redirect?.kind === 'workspace') {
      await goto(
        redirect.diagramId
          ? resolve('/workspace/[workspaceId]/diagram/[diagramId]', {
              diagramId: redirect.diagramId,
              workspaceId: redirect.workspaceId
            })
          : resolve('/workspace/[workspaceId]', { workspaceId: redirect.workspaceId })
      );
      return;
    }
    const workspaces = await auth.api.getWorkspaces();
    if (workspaces[0]) await goto(`${base}/workspace/${workspaces[0].id}`);
    else error = 'Your account does not have a workspace yet.';
  };

  onMount(async () => {
    await auth.initialize();
    if (auth.current.status === 'authenticated') await continueToProduct();
  });

  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    if (isRegister && !displayName.trim()) {
      error = 'Enter a display name.';
      return;
    }
    error = '';
    submitting = true;
    try {
      const credentials = { email: email.trim().toLowerCase(), password };
      if (isRegister) {
        await auth.register({ ...credentials, displayName: displayName.trim() });
      } else {
        await auth.login(credentials);
      }
      await continueToProduct();
    } catch (caught) {
      error =
        caught instanceof ApiError ? caught.message : 'Unable to reach the service. Try again.';
    } finally {
      submitting = false;
    }
  };
</script>

<svelte:head>
  <title>{isRegister ? 'Create account' : 'Sign in'} | Mermaid Workspace</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="relative grid min-h-dvh overflow-auto bg-slate-950 lg:grid-cols-[1.1fr_0.9fr]">
  <section
    class="relative hidden min-h-dvh overflow-hidden border-r border-white/10 bg-[radial-gradient(circle_at_15%_20%,rgba(244,63,94,0.24),transparent_32%),radial-gradient(circle_at_80%_70%,rgba(56,189,248,0.18),transparent_38%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
    <a class="text-lg font-semibold tracking-tight" href={`${base}/edit`}>Mermaid</a>
    <div class="max-w-xl">
      <p class="mb-5 font-mono text-xs tracking-[0.28em] text-rose-300 uppercase">
        Workspace edition
      </p>
      <h1 class="text-5xl leading-[1.05] font-semibold tracking-[-0.045em]">
        Diagrams that stay<br />with your team.
      </h1>
      <p class="mt-6 max-w-md text-base leading-7 text-slate-300">
        Organize Mermaid documents, keep changes persisted, and move from a blank canvas to a shared
        system map.
      </p>
    </div>
    <p class="text-sm text-slate-400">
      The open Mermaid editor remains available without an account.
    </p>
  </section>

  <main class="flex min-h-dvh items-center justify-center bg-slate-50 px-5 py-12 text-slate-950">
    <div class="w-full max-w-md">
      <a class="mb-10 inline-block text-lg font-semibold lg:hidden" href={`${base}/edit`}
        >Mermaid</a>
      <p class="font-mono text-xs tracking-[0.22em] text-rose-600 uppercase">
        {isRegister ? 'Start a workspace' : 'Welcome back'}
      </p>
      <h2 class="mt-3 text-3xl font-semibold tracking-tight">
        {isRegister ? 'Create your account' : 'Sign in to your workspace'}
      </h2>
      <p class="mt-3 text-sm leading-6 text-slate-600">
        {isRegister
          ? 'Your personal workspace is created automatically.'
          : 'Continue editing your saved Mermaid diagrams.'}
      </p>

      <form class="mt-8 space-y-5" onsubmit={submit} novalidate>
        {#if isRegister}
          <div class="space-y-2">
            <label for="display-name" class="text-sm font-medium">Display name</label>
            <Input
              id="display-name"
              name="displayName"
              autocomplete="name"
              minlength={1}
              maxlength={100}
              required
              bind:value={displayName} />
          </div>
        {/if}
        <div class="space-y-2">
          <label for="email" class="text-sm font-medium">Email address</label>
          <Input
            id="email"
            name="email"
            type="email"
            autocomplete="email"
            maxlength={320}
            required
            bind:value={email} />
        </div>
        <div class="space-y-2">
          <div class="flex items-baseline justify-between gap-4">
            <label for="password" class="text-sm font-medium">Password</label>
            {#if isRegister}<span class="text-xs text-slate-500">12 characters minimum</span>{/if}
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autocomplete={isRegister ? 'new-password' : 'current-password'}
            minlength={isRegister ? 12 : undefined}
            maxlength={128}
            required
            bind:value={password} />
        </div>

        {#if error}
          <p
            class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert">
            {error}
          </p>
        {/if}

        <Button
          class="h-11 w-full bg-slate-950 text-white hover:bg-slate-800"
          type="submit"
          disabled={submitting}>
          {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p class="mt-6 text-center text-sm text-slate-600">
        {isRegister ? 'Already have an account?' : 'New to Mermaid Workspace?'}
        <a
          class="font-semibold text-rose-600 underline-offset-4 hover:underline"
          href={`${base}/${isRegister ? 'login' : 'register'}`}
          >{isRegister ? 'Sign in' : 'Create an account'}</a>
      </p>
    </div>
  </main>
</div>

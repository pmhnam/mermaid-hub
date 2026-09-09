import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig, loadEnv } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';

/**
 * HMR creates state inconsistencies, so we always reload the page.
 * @type {import('vite').PluginOption} PluginOption
 */
const alwaysFullReload = {
  name: 'always-full-reload',
  handleHotUpdate({ server }) {
    server.ws.send({ type: 'full-reload' });
    return [];
  }
};

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'MERMAID_');
  const apiProxyTarget =
    process.env.MERMAID_API_PROXY_URL ||
    environment.MERMAID_API_PROXY_URL ||
    'http://localhost:3001';

  return {
    plugins: [
      tailwindcss(),
      sveltekit(),
      Icons({
        compiler: 'svelte',
        customCollections: {
          custom: FileSystemIconLoader('./static/icons')
        }
      }),
      alwaysFullReload,
      devtoolsJson()
    ],
    envPrefix: 'MERMAID_',
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api': { target: apiProxyTarget },
        '/ws': { target: apiProxyTarget, ws: true }
      }
    },
    preview: { port: 3000, host: true },
    // Vitest otherwise resolves Svelte's server build, where $effect is a no-op.
    resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
    test: {
      environment: 'jsdom',
      // in-source testing
      includeSource: ['src/**/*.{js,ts,svelte}'],
      // Ignore E2E tests
      exclude: [
        'tests/**/*',
        '**/node_modules/**',
        '**/dist/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*'
      ],
      setupFiles: ['./src/tests/setup.ts'],
      coverage: {
        exclude: ['src/mocks', '.svelte-kit', 'src/**/*.test.ts'],
        reporter: ['text', 'json', 'html', 'lcov']
      }
    }
  };
});

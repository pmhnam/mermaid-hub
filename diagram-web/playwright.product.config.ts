import { defineConfig, devices } from '@playwright/test';

const backendEnvironment = {
  COLLABORATION_SAVE_DEBOUNCE_MS: '2000',
  DATABASE_URL: 'postgresql://diagram:diagram@localhost:5432/diagram',
  JWT_ACCESS_SECRET: 'integration-test-secret-at-least-32-characters',
  PUBLIC_LINK_SECRET: 'public-link-integration-secret-at-least-32-characters',
  PORT: '3001'
};

export default defineConfig({
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  projects: [{ name: 'product-chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  retries: process.env.CI ? 1 : 0,
  testDir: './tests/product',
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    viewport: { height: 900, width: 1440 }
  },
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../diagram-api',
      env: backendEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      url: 'http://127.0.0.1:3001/api/health'
    },
    {
      command: `corepack pnpm exec vite ${process.env.CI ? 'preview' : 'dev'} --host 127.0.0.1`,
      env: { MERMAID_API_PROXY_URL: 'http://127.0.0.1:3001' },
      reuseExistingServer: false,
      timeout: 120_000,
      url: 'http://127.0.0.1:3000/register'
    }
  ],
  workers: 1
});

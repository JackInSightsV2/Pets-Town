import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'chatgpt.spec.ts', fullyParallel: false, workers: 1,
  timeout: 30_000, expect: { timeout: 8000 }, reporter: 'list',
  use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 1000 }, screenshot: 'only-on-failure' },
});

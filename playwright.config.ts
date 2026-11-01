import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testIgnore: 'chatgpt.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { launchOptions: { executablePath: process.env.CHROME_PATH }, baseURL: 'http://127.0.0.1:5417', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: 'npm run build && npx tsx tests/serve-e2e.ts',
    url: 'http://127.0.0.1:5417/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

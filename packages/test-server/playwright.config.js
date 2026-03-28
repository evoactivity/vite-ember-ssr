import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.browser.js',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4210',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'PORT=4210 node index.js',
    port: 4210,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

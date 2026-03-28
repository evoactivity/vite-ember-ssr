import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testServerDir = resolve(__dirname, '../test-server');
const ssgDistDir = resolve(__dirname, '../test-app-ssg/dist');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'ssr',
      testMatch: 'browser.browser.js',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4210',
      },
    },
    {
      name: 'ssg',
      testMatch: 'ssg.browser.js',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4211',
      },
    },
    {
      name: 'combined',
      testMatch: 'combined.browser.js',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4212',
      },
    },
  ],
  webServer: [
    {
      command: `PORT=4210 node ${resolve(testServerDir, 'index.js')}`,
      port: 4210,
      reuseExistingServer: false,
      timeout: 30_000,
      cwd: testServerDir,
    },
    {
      command: `pnpm dlx http-server "${ssgDistDir}" -p 4211 -c-1 --silent`,
      port: 4211,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `PORT=4212 node ${resolve(testServerDir, 'combined-server.js')}`,
      port: 4212,
      reuseExistingServer: false,
      timeout: 30_000,
      cwd: testServerDir,
    },
  ],
});

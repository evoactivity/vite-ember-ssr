/**
 * Global setup for vitest — builds the test-app SSR bundle
 * before any tests run. This ensures tests always run against
 * a fresh build.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppRoot = resolve(__dirname, '../../test-app');
const viteEmberSsrRoot = resolve(__dirname, '../../vite-ember-ssr');

export async function setup() {
  console.log('\n  Building vite-ember-ssr library...');
  execSync('pnpm build', { cwd: viteEmberSsrRoot, stdio: 'pipe' });

  console.log('  Building test-app (client + server)...');
  execSync('pnpm build:all', { cwd: testAppRoot, stdio: 'pipe' });

  console.log('  Build complete.\n');
}

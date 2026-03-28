/**
 * Global setup for vitest — builds the library, test-app SSR bundle,
 * and test-app-ssg static site before any tests run.
 * This ensures tests always run against a fresh build.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const viteEmberSsrRoot = resolve(__dirname, '..');
const testAppRoot = resolve(__dirname, '../../test-app');
const testAppSsgRoot = resolve(__dirname, '../../test-app-ssg');

export async function setup() {
  console.log('\n  Building vite-ember-ssr library...');
  execSync('pnpm build', { cwd: viteEmberSsrRoot, stdio: 'pipe' });

  console.log('  Building test-app (client + server)...');
  execSync('pnpm build:all', { cwd: testAppRoot, stdio: 'pipe' });

  console.log('  Building test-app-ssg (static site generation)...');
  execSync('pnpm build', { cwd: testAppSsgRoot, stdio: 'inherit' });

  console.log('  Build complete.\n');
}

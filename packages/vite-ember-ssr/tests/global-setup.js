/**
 * Global setup for vitest — builds the library, test-app SSR bundle,
 * test-app-ssg static site, test-app-combined (SSR + SSG),
 * test-app-lazy-ssg (SSG with lazy routes), and
 * test-app-lazy-ssr (SSR with lazy routes) before any tests run.
 * This ensures tests always run against a fresh build.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const viteEmberSsrRoot = resolve(__dirname, '..');
const testAppRoot = resolve(__dirname, '../../test-app');
const testAppSsgRoot = resolve(__dirname, '../../test-app-ssg');
const testAppCombinedRoot = resolve(__dirname, '../../test-app-combined');
const testAppLazySsgRoot = resolve(__dirname, '../../test-app-lazy-ssg');
const testAppLazySsrRoot = resolve(__dirname, '../../test-app-lazy-ssr');

export async function setup() {
  console.log('\n  Building vite-ember-ssr library...');
  execSync('pnpm build', { cwd: viteEmberSsrRoot, stdio: 'pipe' });

  console.log('  Building test-app (client + server)...');
  execSync('pnpm build:all', { cwd: testAppRoot, stdio: 'pipe' });

  console.log('  Building test-app-ssg (static site generation)...');
  execSync('pnpm build', { cwd: testAppSsgRoot, stdio: 'inherit' });

  console.log('  Building test-app-combined (SSR + SSG)...');
  execSync('pnpm build:all', { cwd: testAppCombinedRoot, stdio: 'inherit' });

  console.log('  Building test-app-lazy-ssg (SSG with lazy routes)...');
  execSync('pnpm build', { cwd: testAppLazySsgRoot, stdio: 'inherit' });

  console.log('  Building test-app-lazy-ssr (SSR with lazy routes)...');
  execSync('pnpm build:all', { cwd: testAppLazySsrRoot, stdio: 'inherit' });

  console.log('  Build complete.\n');
}

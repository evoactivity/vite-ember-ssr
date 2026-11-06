/**
 * Dev-mode SSR integration tests.
 *
 * Spins up a real Vite dev server pointed at test-apps/test-app and exercises
 * `createEmberApp` with the `dev: { ssrLoadModule }` option. This verifies
 * that the in-process rendering path in src/dev.ts works end-to-end.
 *
 * The dev path is a separate code path from the worker (fresh Window per
 * request, ssrLoadModule re-imports on every render). These tests focus on
 * the dev-specific behaviour, not on re-validating Ember rendering output
 * (which ssr.test.js already covers).
 *
 * NOTE: This test calls process.chdir() to the test-app root because
 * @embroider/vite reads process.cwd() when resolving plugins. Vitest runs
 * each test file in its own worker so this does not affect other test files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createEmberApp, assembleHTML } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppRoot = resolve(__dirname, '../../test-apps/test-app');
const ssrEntryPath = resolve(testAppRoot, 'app/app-ssr.ts');

let vite;
let emberApp;
let originalCwd;

beforeAll(async () => {
  originalCwd = process.cwd();
  process.chdir(testAppRoot);

  const { createServer } = await import('vite');

  vite = await createServer({
    root: testAppRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  emberApp = await createEmberApp(ssrEntryPath, {
    dev: { ssrLoadModule: vite.ssrLoadModule.bind(vite) },
  });

  // Eagerly load the SSR entry through Vite so dep optimization finishes
  // before any tests run. Without this, the first ssrLoadModule call races
  // with esbuild's initial dep-optimization build and can fail with
  // "The build was canceled / Unexpected end of JSON input".
  await vite.ssrLoadModule(ssrEntryPath);
}, 120_000);

afterAll(async () => {
  await emberApp?.destroy();
  // vite.close() can hang if esbuild's dep optimizer was interrupted,
  // race with a timeout so a stalled close doesn't fail the whole suite.
  await Promise.race([
    vite?.close(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (originalCwd) process.chdir(originalCwd);
}, 30_000);

async function renderRoute(url, options = {}) {
  const rawTemplate = await readFile(
    resolve(testAppRoot, 'index.html'),
    'utf-8',
  );
  const template = await vite.transformIndexHtml(url, rawTemplate);
  const rendered = await emberApp.renderRoute(url, options);
  const html = assembleHTML(template, rendered);
  return { html, rendered };
}

// ─── Dev path smoke ──────────────────────────────────────────────────

describe('Dev SSR', () => {
  it('renders a route via ssrLoadModule', async () => {
    const { html, rendered } = await renderRoute('/');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();
    expect(html).toContain('data-route="index"');
  }, 30_000);

  it('answers the code that the app set with setStatusCode(), for one render only', async () => {
    const missing = await renderRoute('/missing');
    const next = await renderRoute('/');

    expect(missing.rendered.statusCode).toBe(404);
    expect(next.rendered.statusCode).toBe(200);
  }, 30_000);

  it('answers 404 for a URL that no route matches', async () => {
    const { rendered } = await renderRoute('/does-not-exist');

    expect(rendered.statusCode).toBe(404);
  }, 30_000);

  it('emits the same rehydration shape as the production worker', async () => {
    const { html, rendered } = await renderRoute('/');

    expect(html).not.toContain('id="ssr-body-start"');
    expect(html).not.toContain('id="ssr-body-end"');
    expect(html).toContain(
      '<script>window.__vite_ember_ssr_rehydrate__=true</script>',
    );
    expect(rendered.body).toContain('<!--%+b:');
  }, 30_000);

  it('isolates each request despite re-loading the SSR module', async () => {
    // Dev creates a fresh Window per request and re-imports the SSR entry.
    // Verify state does not bleed across renders.
    const index = await renderRoute('/');
    const about = await renderRoute('/about');
    const contact = await renderRoute('/contact');

    expect(index.html).toContain('data-route="index"');
    expect(about.html).toContain('data-route="about"');
    expect(contact.html).toContain('data-route="contact"');

    expect(index.html).not.toContain('data-route="about"');
    expect(about.html).not.toContain('data-route="contact"');

    // Counter starts at 0 on every render
    expect(index.html).toContain('data-count="0"');
    expect(about.html).toContain('data-count="0"');
  }, 60_000);
});

// ─── Dev-path fetch + shoebox ────────────────────────────────────────

describe('Dev SSR fetch and shoebox', () => {
  it('renders a route that fetches data', async () => {
    const { html, rendered } = await renderRoute('/pokemon-fetch');

    expect(rendered.statusCode).toBe(200);
    expect(html).toContain('data-pokemon="bulbasaur"');
  }, 30_000);

  it('captures fetch responses into the shoebox when enabled', async () => {
    const { html } = await renderRoute('/pokemon-fetch', { shoebox: true });

    const scriptMatch = html.match(
      /<script type="application\/json" id="vite-ember-ssr-shoebox">([\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();

    const entries = JSON.parse(scriptMatch[1]);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toHaveProperty('url');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('body');
    }
  }, 30_000);

  it('omits the shoebox when disabled', async () => {
    const { html } = await renderRoute('/pokemon-fetch', { shoebox: false });

    expect(html).not.toContain('id="vite-ember-ssr-shoebox"');
  }, 30_000);
});

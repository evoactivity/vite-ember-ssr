/**
 * Dev-mode SSR integration tests.
 *
 * Spins up a real Vite dev server pointed at packages/test-app and exercises
 * `createEmberApp` with the `dev: { ssrLoadModule }` option. This verifies
 * that the in-process rendering path in src/dev.ts works end-to-end.
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
const testAppRoot = resolve(__dirname, '../../test-app');
const ssrEntryPath = resolve(testAppRoot, 'app/app-ssr.ts');

let vite;
let emberApp;
let originalCwd;

beforeAll(async () => {
  // @embroider/vite resolves modules relative to cwd — must be the Ember app root.
  originalCwd = process.cwd();
  process.chdir(testAppRoot);

  const { createServer } = await import('vite');

  vite = await createServer({
    root: testAppRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    // Silence Vite's output during tests
    logLevel: 'silent',
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
  // vite.close() can hang if esbuild's dep optimizer was interrupted
  // (e.g. "build canceled" when the test process exits). Use a race
  // with a timeout so a stalled close doesn't fail the whole suite.
  await Promise.race([
    vite?.close(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (originalCwd) process.chdir(originalCwd);
}, 30_000);

/**
 * Helper: render a route via the dev-mode path and return assembled HTML.
 */
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

// ─── Route rendering ──────────────────────────────────────────────────

describe('Dev SSR routing', () => {
  it('renders the index route at /', async () => {
    const { html, rendered } = await renderRoute('/');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    expect(html).toContain('data-route="index"');
    expect(html).toContain('Welcome to vite-ember-ssr');
    expect(html).toContain('Server-side rendered Ember application.');
  }, 30_000);

  it('renders the about route at /about', async () => {
    const { html, rendered } = await renderRoute('/about');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    expect(html).toContain('data-route="about"');
    expect(html).toContain('<h1>About</h1>');
    expect(html).not.toContain('data-route="index"');
  }, 30_000);

  it('renders the contact route at /contact', async () => {
    const { html, rendered } = await renderRoute('/contact');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    expect(html).toContain('data-route="contact"');
    expect(html).toContain('<h1>Contact</h1>');
    expect(html).toContain('test@example.com');
  }, 30_000);
});

// ─── HTML structure ───────────────────────────────────────────────────

describe('Dev SSR HTML structure', () => {
  it('replaces SSR markers in the template', async () => {
    const { html } = await renderRoute('/');

    expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
    expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
  }, 30_000);

  it('includes SSR boundary markers in body', async () => {
    const { html } = await renderRoute('/');

    expect(html).toContain('id="ssr-body-start"');
    expect(html).toContain('id="ssr-body-end"');
  }, 30_000);

  it('omits SSR boundary markers when rehydrate is true', async () => {
    const { html } = await renderRoute('/', { rehydrate: true });

    expect(html).not.toContain('id="ssr-body-start"');
    expect(html).not.toContain('id="ssr-body-end"');
  }, 30_000);

  it('includes rehydrate flag script when rehydrate is true', async () => {
    const { html } = await renderRoute('/', { rehydrate: true });

    expect(html).toContain(
      '<script>window.__vite_ember_ssr_rehydrate__=true</script>',
    );
  }, 30_000);

  it('includes Glimmer serialization comments when rehydrate is true', async () => {
    const { rendered } = await renderRoute('/', { rehydrate: true });

    expect(rendered.body).toContain('<!--%+b:');
    expect(rendered.body).toContain('<!--%-b:');
  }, 30_000);
});

// ─── Isolation ────────────────────────────────────────────────────────

describe('Dev SSR isolation between requests', () => {
  it('renders different routes without cross-contamination', async () => {
    const index = await renderRoute('/');
    const about = await renderRoute('/about');
    const contact = await renderRoute('/contact');

    expect(index.html).toContain('data-route="index"');
    expect(about.html).toContain('data-route="about"');
    expect(contact.html).toContain('data-route="contact"');

    expect(index.html).not.toContain('data-route="about"');
    expect(about.html).not.toContain('data-route="contact"');
    expect(contact.html).not.toContain('data-route="index"');
  }, 60_000);

  it('each dev SSR request gets fresh counter state', async () => {
    const index = await renderRoute('/');
    const about = await renderRoute('/about');

    expect(index.html).toContain('data-count="0"');
    expect(about.html).toContain('data-count="0"');
  }, 60_000);
});

// ─── Shoebox in dev mode ──────────────────────────────────────────────

describe('Dev SSR shoebox (fetch capture)', () => {
  it('includes a shoebox script tag for routes that fetch data', async () => {
    const { html } = await renderRoute('/pokemon-fetch', { shoebox: true });

    expect(html).toContain('id="vite-ember-ssr-shoebox"');
    expect(html).toContain('type="application/json"');
  }, 30_000);

  it('contains valid JSON with captured fetch entries', async () => {
    const { html } = await renderRoute('/pokemon-fetch', { shoebox: true });

    const scriptMatch = html.match(
      /<script type="application\/json" id="vite-ember-ssr-shoebox">([\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();

    const entries = JSON.parse(scriptMatch[1]);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry).toHaveProperty('url');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('body');
    }
  }, 30_000);

  it('does NOT include a shoebox when shoebox option is false', async () => {
    const { html } = await renderRoute('/pokemon-fetch', { shoebox: false });

    expect(html).not.toContain('id="vite-ember-ssr-shoebox"');
  }, 30_000);

  it('does NOT include a shoebox for routes that do not fetch data', async () => {
    const { html } = await renderRoute('/', { shoebox: true });

    expect(html).not.toContain('id="vite-ember-ssr-shoebox"');
  }, 30_000);
});

// ─── Fetch in dev mode ────────────────────────────────────────────────

describe('Dev SSR with fetch in route model hooks', () => {
  it('renders the pokemon list with fetched data', async () => {
    const { html, rendered } = await renderRoute('/pokemon-fetch');

    expect(rendered.statusCode).toBe(200);
    expect(html).toContain('data-route="pokemon-fetch"');
    expect(html).toContain('<h1>Pokémon (Fetch)</h1>');
    expect(html).toContain('data-pokemon="bulbasaur"');
  }, 30_000);

  it('renders a pokemon detail page with fetched data', async () => {
    const { html, rendered } = await renderRoute('/pokemon-fetch/pikachu');

    expect(rendered.statusCode).toBe(200);
    expect(html).toContain('data-route="pokemon-fetch.show"');
    expect(html).toContain('data-pokemon-name="pikachu"');
    expect(html).toContain('data-type="electric"');
  }, 30_000);
});

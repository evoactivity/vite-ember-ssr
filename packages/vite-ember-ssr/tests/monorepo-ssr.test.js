/**
 * Tests for the monorepo SSR build output.
 *
 * This test app uses `emberSsr()` and depends on `monorepo-lib`
 * (a sibling workspace package) that re-exports `tracked` from
 * `@glimmer/tracking`. The vite config sets
 * `ssr: { external: ['monorepo-lib'] }` to force Vite to externalize
 * the sibling package — simulating what happens with real node_modules
 * packages (like tracked-built-ins) that Vite externalizes by default.
 *
 * Without the fix, when the SSR bundle is loaded at runtime, the
 * external monorepo-lib imports @glimmer/tracking, and pnpm's strict
 * node_modules layout can't resolve it.
 *
 * These tests verify that the fix for issue #4 works for SSR builds —
 * the plugin now uses ssr.noExternal: [/./] to bundle everything,
 * avoiding runtime resolution failures under pnpm's strict layout.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderEmberApp, assembleHTML } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppDist = resolve(__dirname, '../../test-app-monorepo-ssr/dist');

let template;

// Async createApp factory — lazily imports the SSR bundle inside
// withBrowserGlobals where window exists.
const serverEntryPath = resolve(testAppDist, 'server/app-ssr.mjs');
const createApp = async () => {
  const appModule = await import(serverEntryPath);
  return appModule.createSsrApp();
};

beforeAll(async () => {
  template = await readFile(resolve(testAppDist, 'client/index.html'), 'utf-8');
});

/**
 * Helper: render a route and return the assembled HTML string.
 */
async function renderRoute(url) {
  const rendered = await renderEmberApp({
    url,
    createApp,
  });
  const html = assembleHTML(template, rendered);
  return { html, rendered };
}

/**
 * Helper: check if a file exists.
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── File structure ──────────────────────────────────────────────────

describe('Monorepo SSR output file structure', () => {
  it('generates client index.html', async () => {
    const exists = await fileExists(resolve(testAppDist, 'client/index.html'));
    expect(exists).toBe(true);
  });

  it('generates SSR bundle', async () => {
    const exists = await fileExists(resolve(testAppDist, 'server/app-ssr.mjs'));
    expect(exists).toBe(true);
  });

  it('generates server package.json for ESM', async () => {
    const pkgPath = resolve(testAppDist, 'server/package.json');
    const exists = await fileExists(pkgPath);
    expect(exists).toBe(true);

    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    expect(pkg.type).toBe('module');
  });

  it('generates client CSS', async () => {
    const clientDir = resolve(testAppDist, 'client/assets');
    const exists = await fileExists(clientDir);
    expect(exists).toBe(true);
  });
});

// ─── SSR bundle imports (the core of issue #4) ──────────────────────

describe('Monorepo SSR bundle import', () => {
  it('can import the SSR bundle without resolution errors', async () => {
    // This is the core test: if monorepo-lib were left external,
    // this import would fail with:
    //   Cannot find package '@glimmer/tracking' imported from monorepo-lib/src/index.js
    const appModule = await import(serverEntryPath);
    expect(typeof appModule.createSsrApp).toBe('function');
  });

  it('renders the index route with MonorepoStatus component', async () => {
    const { html, rendered } = await renderRoute('/');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // Index-specific content
    expect(html).toContain('data-route="index"');
    expect(html).toContain('Monorepo SSR Test');

    // MonorepoStatus component — imports tracked from monorepo-lib
    expect(html).toContain('data-component="monorepo-status"');
    expect(html).toContain('data-label="monorepo-import-works"');
    expect(html).toContain('monorepo-import-works');
  });

  it('renders the about route with MonorepoStatus component', async () => {
    const { html, rendered } = await renderRoute('/about');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // About-specific content
    expect(html).toContain('data-route="about"');
    expect(html).toContain('About');

    // MonorepoStatus component on about page too
    expect(html).toContain('data-component="monorepo-status"');
    expect(html).toContain('data-label="monorepo-import-works"');
  });
});

// ─── HTML structure ──────────────────────────────────────────────────

describe('Monorepo SSR HTML structure', () => {
  it('replaces SSR markers in the template', async () => {
    const { html } = await renderRoute('/');

    expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
    expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
  });

  it('includes SSR boundary markers in body', async () => {
    const { html } = await renderRoute('/');

    expect(html).toContain('id="ssr-body-start"');
    expect(html).toContain('id="ssr-body-end"');
  });

  it('includes the client JS bundle', async () => {
    const { html } = await renderRoute('/');

    expect(html).toMatch(/src="\/assets\/main-[a-zA-Z0-9_-]+\.js"/);
  });

  it('sets the page title via ember-page-title', async () => {
    const { rendered } = await renderRoute('/');

    expect(rendered.head).toContain('<title>MonorepoTestApp</title>');
  });
});

// ─── Route isolation ─────────────────────────────────────────────────

describe('Monorepo SSR route isolation', () => {
  it('renders different content for sequential requests', async () => {
    const index = await renderRoute('/');
    const about = await renderRoute('/about');

    // Each has its own data-route
    expect(index.html).toContain('data-route="index"');
    expect(about.html).toContain('data-route="about"');

    // No cross-contamination
    expect(index.html).not.toContain('data-route="about"');
    expect(about.html).not.toContain('data-route="index"');
  });
});

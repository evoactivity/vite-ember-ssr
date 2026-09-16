/**
 * Lazy SSR tests.
 *
 * The unique behaviour of lazy SSR (vs. plain SSR) is:
 * - The app uses @embroider/router with route bundles registered on
 *   window._embroiderRouteBundles_, so lazy routes must resolve and render
 *   inside the worker.
 * - The plugin emits a CSS manifest that maps Ember route names to the CSS
 *   files Vite extracted from their lazy chunks.
 * - The renderer reads the active route from the router service and
 *   injects the matching <link> tags into <head>.
 *
 * These tests focus on those concerns. Generic SSR HTML shape is already
 * covered by ssr.test.js.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createEmberApp,
  assembleHTML,
  loadCssManifest,
} from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppDist = resolve(
  __dirname,
  '../../test-apps/test-app-lazy-ssr/dist',
);

let template;
let cssManifest;
let app;

const ssrBundlePath = resolve(testAppDist, 'server/app-ssr.mjs');

beforeAll(async () => {
  template = await readFile(resolve(testAppDist, 'client/index.html'), 'utf-8');
  cssManifest = await loadCssManifest(resolve(testAppDist, 'client'));
  app = await createEmberApp(ssrBundlePath);
});

afterAll(async () => {
  await app.destroy();
});

async function renderRoute(url, options = {}) {
  const rendered = await app.renderRoute(url, { cssManifest, ...options });
  const html = assembleHTML(template, rendered);
  return { html, rendered };
}

// ─── Lazy route resolution ───────────────────────────────────────────

describe('Lazy SSR route resolution', () => {
  it('renders an eager route', async () => {
    const { html, rendered } = await renderRoute('/');

    expect(rendered.statusCode).toBe(200);
    expect(html).toContain('data-route="index"');
  });

  it('renders a lazy-loaded route', async () => {
    const { html, rendered } = await renderRoute('/about');

    expect(rendered.statusCode).toBe(200);
    expect(html).toContain('data-route="about"');
    // AboutInfo is a component imported by the lazy about template
    expect(html).toContain('data-component="about-info"');
  });

  it('renders a second lazy-loaded route on the same worker', async () => {
    // Confirms _embroiderRouteBundles_ remains populated across renders.
    const { html, rendered } = await renderRoute('/contact');

    expect(rendered.statusCode).toBe(200);
    expect(html).toContain('data-route="contact"');
    expect(html).toContain('data-component="shared-badge"');
  });
});

// ─── CSS manifest contents ───────────────────────────────────────────

describe('Lazy SSR CSS manifest', () => {
  it('loads a manifest from disk', () => {
    expect(cssManifest).toBeDefined();
    expect(typeof cssManifest).toBe('object');
  });

  it('omits eager routes from the manifest', () => {
    expect(cssManifest).not.toHaveProperty('app/templates/index.gts');
  });

  it('lists the about route with its own + transitive CSS plus shared CSS', () => {
    // about.gts has: direct about.css + about-info.css (transitive) + shared-badge.css (shared)
    // Vite merges about.css + about-info.css into one chunk, shared-badge.css is separate.
    expect(cssManifest['app/templates/about.gts']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/assets\/about-[a-zA-Z0-9_-]+\.css$/),
        expect.stringMatching(/\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css$/),
      ]),
    );
    expect(cssManifest['app/templates/about.gts'].length).toBe(2);
  });

  it('lists the contact route with only the shared component CSS', () => {
    // contact.gts only imports SharedBadge (no direct CSS import)
    expect(cssManifest['app/templates/contact.gts'].length).toBe(1);
    expect(cssManifest['app/templates/contact.gts'][0]).toMatch(
      /\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css$/,
    );
  });

  it('deduplicates the shared component CSS across routes', () => {
    const aboutShared = cssManifest['app/templates/about.gts'].find((p) =>
      p.includes('shared-badge'),
    );
    const contactShared = cssManifest['app/templates/contact.gts'].find((p) =>
      p.includes('shared-badge'),
    );
    expect(aboutShared).toBe(contactShared);
  });
});

// ─── CSS link injection at render time ───────────────────────────────

describe('Lazy SSR CSS link injection', () => {
  it('injects <link> tags for the active lazy route into <head>', async () => {
    const { rendered } = await renderRoute('/about');

    expect(rendered.head).toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(rendered.head).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('injects only the shared CSS for routes that depend solely on shared components', async () => {
    const { html } = await renderRoute('/contact');

    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('does not inject lazy CSS on eager routes', async () => {
    const { html } = await renderRoute('/');

    // Main bundle CSS is already in the template, no lazy CSS expected here.
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('places injected CSS links before the page title', async () => {
    const { rendered } = await renderRoute('/about');

    const cssLinkPos = rendered.head.search(/<link rel="stylesheet"/);
    const titlePos = rendered.head.search(/<title>/);

    expect(cssLinkPos).toBeGreaterThanOrEqual(0);
    if (titlePos >= 0) {
      expect(cssLinkPos).toBeLessThan(titlePos);
    }
  });

  it('renders without injection when the manifest is omitted', async () => {
    const rendered = await app.renderRoute('/about');
    const html = assembleHTML(template, rendered);

    expect(rendered.statusCode).toBe(200);
    expect(html).toContain('data-route="about"');
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
  });
});

// ─── Transitive CSS bundling ─────────────────────────────────────────

describe('Lazy SSR transitive CSS', () => {
  it('the route CSS bundle includes both direct and transitive imports', async () => {
    // about.css is imported directly by about.gts
    // about-info.css is imported by about-info.gts (a component used by about.gts)
    // Vite merges them into a single CSS asset for the dynamic entry chunk.
    const aboutCssPath = cssManifest['app/templates/about.gts'].find((p) =>
      p.includes('/about-'),
    );
    expect(aboutCssPath).toBeDefined();

    const cssContent = await readFile(
      resolve(testAppDist, 'client', aboutCssPath.slice(1)),
      'utf-8',
    );

    // From about.css (CSS minifier may convert 'red' to shorthand)
    expect(cssContent).toMatch(/background:red|background:#f00/);
    // From about-info.css (transitive via component import)
    expect(cssContent).toContain('.about-info');
  });
});

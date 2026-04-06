/**
 * Tests for SSG builds in a pnpm monorepo where the Ember app imports
 * a sibling workspace package that transitively imports @glimmer/tracking.
 *
 * This reproduces the scenario described in:
 * https://github.com/evoactivity/vite-ember-ssr/issues/4
 *
 * The sibling package (monorepo-lib) re-exports `tracked` from
 * @glimmer/tracking (provided by ember-source). The test app's vite config
 * forces monorepo-lib external via `ssr.external: ['monorepo-lib']`,
 * simulating what happens with real node_modules packages (like
 * tracked-built-ins) that Vite externalizes by default.
 *
 * When the external package imports @glimmer/tracking at runtime during
 * the SSG child build, pnpm's strict node_modules layout can't resolve
 * it — reproducing the failure from issue #4.
 *
 * These tests are currently skipped because the build fails without a fix.
 * Remove the .skip once issue #4 is resolved.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ssgDist = resolve(__dirname, '../../test-app-monorepo-ssg/dist');

/**
 * Helper: read a prerendered HTML file from the SSG dist output.
 */
async function readSsgHtml(route) {
  const filePath =
    route === 'index'
      ? resolve(ssgDist, 'index.html')
      : resolve(ssgDist, route, 'index.html');
  return readFile(filePath, 'utf-8');
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

describe.skip('Monorepo SSG output file structure', () => {
  it('generates index.html at the root', async () => {
    const exists = await fileExists(resolve(ssgDist, 'index.html'));
    expect(exists).toBe(true);
  });

  it('generates about/index.html', async () => {
    const exists = await fileExists(resolve(ssgDist, 'about/index.html'));
    expect(exists).toBe(true);
  });

  it('includes static assets directory', async () => {
    const exists = await fileExists(resolve(ssgDist, 'assets'));
    expect(exists).toBe(true);
  });

  it('cleans up the .ssg-tmp directory after build', async () => {
    const exists = await fileExists(resolve(ssgDist, '../.ssg-tmp'));
    expect(exists).toBe(false);
  });
});

// ─── HTML structure ──────────────────────────────────────────────────

describe.skip('Monorepo SSG HTML structure', () => {
  it('replaces SSR markers in all pages', async () => {
    for (const route of ['index', 'about']) {
      const html = await readSsgHtml(route);
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
    }
  });

  it('includes the client JS bundle in all pages', async () => {
    for (const route of ['index', 'about']) {
      const html = await readSsgHtml(route);
      expect(html).toMatch(/src="\/assets\/main-[a-zA-Z0-9_-]+\.js"/);
    }
  });

  it('includes the CSS bundle in all pages', async () => {
    for (const route of ['index', 'about']) {
      const html = await readSsgHtml(route);
      expect(html).toMatch(/href="\/assets\/main-[a-zA-Z0-9_-]+\.css"/);
    }
  });

  it('sets the page title', async () => {
    const html = await readSsgHtml('index');
    expect(html).toContain('<title>MonorepoTestApp</title>');
  });
});

// ─── Sibling package import (the core of issue #4) ───────────────────

describe.skip('Monorepo SSG sibling package import', () => {
  it('renders the MonorepoStatus component that imports from sibling package', async () => {
    const html = await readSsgHtml('index');

    expect(html).toContain('data-component="monorepo-status"');
    expect(html).toContain('data-label="monorepo-import-works"');
    expect(html).toContain('monorepo-import-works');
  });

  it('renders the component on the about page too', async () => {
    const html = await readSsgHtml('about');

    expect(html).toContain('data-component="monorepo-status"');
    expect(html).toContain('data-label="monorepo-import-works"');
  });

  it('the sibling package @glimmer/tracking import works (tracked decorator applied)', async () => {
    // If @glimmer/tracking failed to resolve, the SSG build would have
    // crashed and no HTML files would exist. The fact that we can read
    // the rendered output with the correct tracked state proves the
    // transitive import resolved successfully.
    const html = await readSsgHtml('index');
    expect(html).toContain('data-label="monorepo-import-works"');
  });
});

// ─── Index route ─────────────────────────────────────────────────────

describe.skip('Monorepo SSG index route', () => {
  it('contains index-specific content', async () => {
    const html = await readSsgHtml('index');

    expect(html).toContain('data-route="index"');
    expect(html).toContain('Monorepo SSG Test');
    expect(html).toContain('sibling workspace packages');
  });

  it('renders navigation with correct links', async () => {
    const html = await readSsgHtml('index');

    expect(html).toContain('data-component="navigation"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about"');
  });

  it('marks the Home link as active', async () => {
    const html = await readSsgHtml('index');

    const homeLink = html.match(/<a[^>]+href="\/"[^>]*>/);
    expect(homeLink?.[0]).toContain('active');
  });

  it('does not contain about route content', async () => {
    const html = await readSsgHtml('index');

    expect(html).not.toContain('data-route="about"');
  });
});

// ─── About route ─────────────────────────────────────────────────────

describe.skip('Monorepo SSG about route', () => {
  it('contains about-specific content', async () => {
    const html = await readSsgHtml('about');

    expect(html).toContain('data-route="about"');
    expect(html).toContain('<h1>About</h1>');
  });

  it('marks the About link as active', async () => {
    const html = await readSsgHtml('about');

    const aboutLink = html.match(/<a[^>]+href="\/about"[^>]*>/);
    expect(aboutLink?.[0]).toContain('active');
  });

  it('does not contain index route content', async () => {
    const html = await readSsgHtml('about');

    expect(html).not.toContain('data-route="index"');
  });
});

// ─── Route isolation ─────────────────────────────────────────────────

describe.skip('Monorepo SSG route isolation', () => {
  it('each page contains only its own data-route attribute', async () => {
    const index = await readSsgHtml('index');
    const about = await readSsgHtml('about');

    expect(index).toContain('data-route="index"');
    expect(index).not.toContain('data-route="about"');

    expect(about).toContain('data-route="about"');
    expect(about).not.toContain('data-route="index"');
  });
});

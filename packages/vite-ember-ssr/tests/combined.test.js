import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const combinedDist = resolve(__dirname, '../../test-app-combined/dist');
const clientDir = resolve(combinedDist, 'client');
const serverDir = resolve(combinedDist, 'server');

/**
 * Helper: read a prerendered HTML file from dist/client/.
 */
async function readPrerenderedHtml(route) {
  const filePath =
    route === 'index'
      ? resolve(clientDir, 'index.html')
      : resolve(clientDir, route, 'index.html');
  return readFile(filePath, 'utf-8');
}

/**
 * Helper: check if a file or directory exists.
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── Build output structure ──────────────────────────────────────────

describe('Combined SSR+SSG build output structure', () => {
  it('places client assets in dist/client/', async () => {
    const exists = await fileExists(resolve(clientDir, 'assets'));
    expect(exists).toBe(true);
  });

  it('places SSR server bundle in dist/server/', async () => {
    const exists = await fileExists(resolve(serverDir, 'app-ssr.mjs'));
    expect(exists).toBe(true);
  });

  it('writes package.json with type:module in dist/server/', async () => {
    const pkgPath = resolve(serverDir, 'package.json');
    const exists = await fileExists(pkgPath);
    expect(exists).toBe(true);

    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    expect(pkg.type).toBe('module');
  });

  it('cleans up the .ssg-tmp directory after build', async () => {
    const exists = await fileExists(resolve(combinedDist, '../.ssg-tmp'));
    expect(exists).toBe(false);
  });

  it('preserves the original index.html as _template.html', async () => {
    const exists = await fileExists(resolve(clientDir, '_template.html'));
    expect(exists).toBe(true);
  });

  it('_template.html contains SSR markers for dynamic rendering', async () => {
    const template = await readFile(
      resolve(clientDir, '_template.html'),
      'utf-8',
    );
    expect(template).toContain('<!-- VITE_EMBER_SSR_HEAD -->');
    expect(template).toContain('<!-- VITE_EMBER_SSR_BODY -->');
  });

  it('_template.html includes client JS and CSS bundles', async () => {
    const template = await readFile(
      resolve(clientDir, '_template.html'),
      'utf-8',
    );
    expect(template).toMatch(/src="\/assets\/main-[a-zA-Z0-9_-]+\.js"/);
    expect(template).toMatch(/href="\/assets\/main-[a-zA-Z0-9_-]+\.css"/);
  });
});

// ─── Prerendered file existence ──────────────────────────────────────

describe('Combined mode: prerendered files exist in dist/client/', () => {
  it('generates index.html at dist/client/', async () => {
    const exists = await fileExists(resolve(clientDir, 'index.html'));
    expect(exists).toBe(true);
  });

  it('generates about/index.html', async () => {
    const exists = await fileExists(resolve(clientDir, 'about/index.html'));
    expect(exists).toBe(true);
  });

  it('generates contact/index.html', async () => {
    const exists = await fileExists(resolve(clientDir, 'contact/index.html'));
    expect(exists).toBe(true);
  });

  it('does NOT generate static files for non-prerendered routes', async () => {
    // pokemon-fetch and pokemon-warp-drive were not in the SSG routes list
    const pokemonFetchExists = await fileExists(
      resolve(clientDir, 'pokemon-fetch/index.html'),
    );
    const pokemonWarpDriveExists = await fileExists(
      resolve(clientDir, 'pokemon-warp-drive/index.html'),
    );
    expect(pokemonFetchExists).toBe(false);
    expect(pokemonWarpDriveExists).toBe(false);
  });
});

// ─── Prerendered HTML content ────────────────────────────────────────

describe('Combined mode: prerendered HTML content', () => {
  it('replaces SSR markers in prerendered pages', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readPrerenderedHtml(route);
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
    }
  });

  it('includes SSR boundary markers in prerendered pages', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readPrerenderedHtml(route);
      expect(html).toContain('id="ssr-body-start"');
      expect(html).toContain('id="ssr-body-end"');
    }
  });

  it('does NOT include rehydrate flag script (cleanup mode)', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readPrerenderedHtml(route);
      expect(html).not.toContain('__vite_ember_ssr_rehydrate__');
    }
  });

  it('includes client JS and CSS bundles', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readPrerenderedHtml(route);
      expect(html).toMatch(/src="\/assets\/main-[a-zA-Z0-9_-]+\.js"/);
      expect(html).toMatch(/href="\/assets\/main-[a-zA-Z0-9_-]+\.css"/);
    }
  });

  it('sets the page title', async () => {
    const html = await readPrerenderedHtml('index');
    expect(html).toContain('<title>TestApp</title>');
  });
});

// ─── Index route ─────────────────────────────────────────────────────

describe('Combined mode: index route content', () => {
  it('contains index-specific content', async () => {
    const html = await readPrerenderedHtml('index');
    expect(html).toContain('data-route="index"');
    expect(html).toContain('Welcome to vite-ember-ssr');
  });

  it('renders CounterDisplay and ItemList components', async () => {
    const html = await readPrerenderedHtml('index');
    expect(html).toContain('data-component="counter-display"');
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-component="item-list"');
    expect(html).toContain('data-item-count="5"');
  });

  it('renders navigation links', async () => {
    const html = await readPrerenderedHtml('index');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/pokemon-fetch"');
  });

  it('does not contain other route content', async () => {
    const html = await readPrerenderedHtml('index');
    expect(html).not.toContain('data-route="about"');
    expect(html).not.toContain('data-route="contact"');
  });
});

// ─── About route ─────────────────────────────────────────────────────

describe('Combined mode: about route content', () => {
  it('contains about-specific content', async () => {
    const html = await readPrerenderedHtml('about');
    expect(html).toContain('data-route="about"');
    expect(html).toContain('<h1>About</h1>');
  });

  it('renders CounterDisplay but not ItemList', async () => {
    const html = await readPrerenderedHtml('about');
    expect(html).toContain('data-component="counter-display"');
    expect(html).not.toContain('data-component="item-list"');
  });

  it('does not contain other route content', async () => {
    const html = await readPrerenderedHtml('about');
    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('data-route="contact"');
  });
});

// ─── Contact route ───────────────────────────────────────────────────

describe('Combined mode: contact route content', () => {
  it('contains contact-specific content', async () => {
    const html = await readPrerenderedHtml('contact');
    expect(html).toContain('data-route="contact"');
    expect(html).toContain('<h1>Contact</h1>');
    expect(html).toContain('test@example.com');
    expect(html).toContain('GitHub: vite-ember-ssr');
  });

  it('does not contain other route content', async () => {
    const html = await readPrerenderedHtml('contact');
    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('data-route="about"');
  });
});

// ─── Route isolation ─────────────────────────────────────────────────

describe('Combined mode: route isolation', () => {
  it('each prerendered page contains only its own data-route attribute', async () => {
    const index = await readPrerenderedHtml('index');
    const about = await readPrerenderedHtml('about');
    const contact = await readPrerenderedHtml('contact');

    expect(index).toContain('data-route="index"');
    expect(index).not.toContain('data-route="about"');
    expect(index).not.toContain('data-route="contact"');

    expect(about).toContain('data-route="about"');
    expect(about).not.toContain('data-route="index"');
    expect(about).not.toContain('data-route="contact"');

    expect(contact).toContain('data-route="contact"');
    expect(contact).not.toContain('data-route="index"');
    expect(contact).not.toContain('data-route="about"');
  });
});

// ─── SSR server bundle validation ────────────────────────────────────

describe('Combined mode: SSR server bundle', () => {
  it('exports a createSsrApp function', async () => {
    const bundlePath = resolve(serverDir, 'app-ssr.mjs');
    const { pathToFileURL } = await import('node:url');
    const ssrModule = await import(pathToFileURL(bundlePath).href);
    expect(typeof ssrModule.createSsrApp).toBe('function');
  });

  it('can dynamically render a non-prerendered route', async () => {
    const { render } = await import('vite-ember-ssr/server');
    const bundlePath = resolve(serverDir, 'app-ssr.mjs');

    // Read the preserved SSR template — emberSsg copies index.html to
    // _template.html before overwriting it with prerendered content.
    const template = await readFile(
      resolve(clientDir, '_template.html'),
      'utf-8',
    );

    const result = await render({
      url: '/pokemon-fetch',
      template,
      ssrBundlePath: bundlePath,
      shoebox: true,
    });

    expect(result.statusCode).toBe(200);
    expect(result.html).toContain('data-route="pokemon-fetch"');
    expect(result.html).toContain('data-component="pokemon-list"');
    expect(result.html).toContain('data-pokemon="bulbasaur"');
  });

  it('renders the about route dynamically (matching prerendered output)', async () => {
    const { render } = await import('vite-ember-ssr/server');
    const bundlePath = resolve(serverDir, 'app-ssr.mjs');

    const template = await readFile(
      resolve(clientDir, '_template.html'),
      'utf-8',
    );

    const result = await render({
      url: '/about',
      template,
      ssrBundlePath: bundlePath,
      shoebox: true,
    });

    expect(result.statusCode).toBe(200);
    expect(result.html).toContain('data-route="about"');
    expect(result.html).toContain('<h1>About</h1>');
  });
});

// ─── No shoebox on static routes (no data fetching) ──────────────────

describe('Combined mode: shoebox behavior', () => {
  it('does NOT include shoebox on routes that do not fetch data', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readPrerenderedHtml(route);
      expect(html).not.toContain('id="vite-ember-ssr-shoebox"');
    }
  });
});

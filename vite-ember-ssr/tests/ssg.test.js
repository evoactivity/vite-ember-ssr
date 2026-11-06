import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ssgDist = resolve(__dirname, '../../test-apps/test-app-ssg/dist');

async function readSsgHtml(route) {
  const filePath =
    route === 'index'
      ? resolve(ssgDist, 'index.html')
      : resolve(ssgDist, route, 'index.html');
  return readFile(filePath, 'utf-8');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── Output structure ────────────────────────────────────────────────

describe('SSG output structure', () => {
  it('writes index route to dist/index.html', async () => {
    expect(await fileExists(resolve(ssgDist, 'index.html'))).toBe(true);
  });

  it('writes non-index routes to <route>/index.html', async () => {
    // 'about' → about/index.html, 'pokemon-fetch' → pokemon-fetch/index.html
    expect(await fileExists(resolve(ssgDist, 'about/index.html'))).toBe(true);
    expect(await fileExists(resolve(ssgDist, 'pokemon-fetch/index.html'))).toBe(
      true,
    );
  });

  it('emits the client assets directory', async () => {
    expect(await fileExists(resolve(ssgDist, 'assets'))).toBe(true);
  });

  it('cleans up the .ssg-tmp directory after build', async () => {
    expect(await fileExists(resolve(ssgDist, '../.ssg-tmp'))).toBe(false);
  });
});

// ─── HTML structure ──────────────────────────────────────────────────

describe('SSG HTML structure', () => {
  it('replaces SSR markers in prerendered pages', async () => {
    for (const route of ['index', 'about', 'contact', 'pokemon-fetch']) {
      const html = await readSsgHtml(route);
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
    }
  });

  it('omits SSR boundary markers', async () => {
    const html = await readSsgHtml('index');
    expect(html).not.toContain('id="ssr-body-start"');
    expect(html).not.toContain('id="ssr-body-end"');
  });

  it('places the rehydrate flag in <head>', async () => {
    const html = await readSsgHtml('index');
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
    expect(headMatch).not.toBeNull();
    expect(headMatch[1]).toContain(
      '<script>window.__vite_ember_ssr_rehydrate__=true</script>',
    );
  });

  it('emits Glimmer serialization comments', async () => {
    const html = await readSsgHtml('index');
    expect(html).toContain('<!--%+b:');
    expect(html).toContain('<!--%-b:');
  });

  it('all pages reference the same client JS and CSS bundles', async () => {
    const htmls = await Promise.all(
      ['index', 'about', 'contact', 'pokemon-fetch'].map(readSsgHtml),
    );

    const jsBundle = htmls[0].match(
      /src="(\/assets\/main-[a-zA-Z0-9_-]+\.js)"/,
    )?.[1];
    const cssBundle = htmls[0].match(
      /href="(\/assets\/main-[a-zA-Z0-9_-]+\.css)"/,
    )?.[1];

    expect(jsBundle).toBeDefined();
    expect(cssBundle).toBeDefined();

    for (const html of htmls.slice(1)) {
      expect(html).toContain(jsBundle);
      expect(html).toContain(cssBundle);
    }
  });
});

// ─── Per-render isolation across the prerender batch ─────────────────

describe('SSG isolates each prerender despite shared worker', () => {
  it('each page has only its own data-route attribute', async () => {
    const routes = ['index', 'about', 'contact', 'pokemon-fetch'];
    const htmls = Object.fromEntries(
      await Promise.all(routes.map(async (r) => [r, await readSsgHtml(r)])),
    );

    for (const route of routes) {
      expect(htmls[route]).toContain(`data-route="${route}"`);
      for (const other of routes) {
        if (other === route) continue;
        expect(htmls[route]).not.toContain(`data-route="${other}"`);
      }
    }
  });

  it('each page gets fresh container state', async () => {
    // CounterDisplay's tracked count should be 0 on every prerender
    const index = await readSsgHtml('index');
    const about = await readSsgHtml('about');

    expect(index).toContain('data-count="0"');
    expect(about).toContain('data-count="0"');
  });
});

// ─── Fetch in route models is captured into the prerendered HTML ─────

describe('SSG with fetch in route model hooks', () => {
  it('renders fetched data into the prerendered HTML', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    expect(html).toContain('data-pokemon="bulbasaur"');
    expect(html).toContain('href="/pokemon-fetch/bulbasaur"');
  });
});

// ─── Shoebox in SSG ──────────────────────────────────────────────────

describe('SSG shoebox', () => {
  it('serializes a shoebox into the prerendered HTML for fetch routes', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    expect(html).toContain('id="vite-ember-ssr-shoebox"');

    const scriptMatch = html.match(
      /<script type="application\/json" id="vite-ember-ssr-shoebox">([\s\S]*?)<\/script>/,
    );
    const entries = JSON.parse(scriptMatch[1]);
    expect(entries.length).toBeGreaterThan(0);

    const listEntry = entries.find((e) =>
      e.url.includes('pokeapi.co/api/v2/pokemon'),
    );
    expect(listEntry).toBeDefined();
    expect(listEntry.status).toBe(200);
  });

  it('omits the shoebox on routes that do not fetch', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readSsgHtml(route);
      expect(html).not.toContain('id="vite-ember-ssr-shoebox"');
    }
  });
});

// ─── transformHtml ───────────────────────────────────────────────────

describe('SSG transformHtml', () => {
  it('runs on each prerendered page, with the route', async () => {
    expect(await readSsgHtml('index')).toContain(
      '<meta name="prerendered-route" content="index">',
    );
    expect(await readSsgHtml('about')).toContain(
      '<meta name="prerendered-route" content="about">',
    );
  });
});

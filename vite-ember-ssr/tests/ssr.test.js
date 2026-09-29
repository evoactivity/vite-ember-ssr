import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createEmberApp, assembleHTML } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppDist = resolve(__dirname, '../../test-apps/test-app/dist');

let template;
let app;

const ssrBundlePath = resolve(testAppDist, 'server/app-ssr.mjs');

beforeAll(async () => {
  template = await readFile(resolve(testAppDist, 'client/index.html'), 'utf-8');
  app = await createEmberApp(ssrBundlePath);
});

afterAll(async () => {
  await app.destroy();
});

async function renderRoute(url, options = {}) {
  const rendered = await app.renderRoute(url, options);
  const html = assembleHTML(template, rendered);
  return { html, rendered };
}

// ─── HTML structure ──────────────────────────────────────────────────

describe('SSR HTML structure', () => {
  it('replaces SSR markers in the template', async () => {
    const { html } = await renderRoute('/');

    expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
    expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
  });

  it('omits SSR boundary markers', async () => {
    const { html } = await renderRoute('/');

    expect(html).not.toContain('id="ssr-body-start"');
    expect(html).not.toContain('id="ssr-body-end"');
  });

  it('includes rehydrate flag script', async () => {
    const { html } = await renderRoute('/');

    expect(html).toContain(
      '<script>window.__vite_ember_ssr_rehydrate__=true</script>',
    );
  });

  it('includes Glimmer serialization comments', async () => {
    const { rendered } = await renderRoute('/');

    // Glimmer's SerializeBuilder writes block boundary comments like <!--%+b:0%-->
    expect(rendered.body).toContain('<!--%+b:');
    expect(rendered.body).toContain('<!--%-b:');
  });

  it('extracts the page title into <head>', async () => {
    const { rendered } = await renderRoute('/');

    expect(rendered.head).toContain('<title>TestApp</title>');
  });
});

// ─── Render side effects ─────────────────────────────────────────────

describe('SSR render side effects', () => {
  it('runs Ember modifiers during SSR', async () => {
    const { html } = await renderRoute('/about');

    // The doThing modifier sets textContent to this string
    expect(html).toContain('This div was modified by an Ember modifier!');
    expect(html).not.toMatch(/<div[^>]*>hi<\/div>/);
  });

  it('marks the active route link via the router service', async () => {
    const { html: indexHtml } = await renderRoute('/');
    const { html: aboutHtml } = await renderRoute('/about');

    const homeLink = indexHtml.match(/<a[^>]+href="\/"[^>]*>/);
    expect(homeLink?.[0]).toContain('active');

    const aboutLink = aboutHtml.match(/<a[^>]+href="\/about"[^>]*>/);
    expect(aboutLink?.[0]).toContain('active');
  });
});

// ─── Per-render isolation (worker reuse) ─────────────────────────────

describe('SSR isolates each request despite shared worker', () => {
  it('renders different content for sequential requests', async () => {
    const index = await renderRoute('/');
    const about = await renderRoute('/about');
    const contact = await renderRoute('/contact');

    expect(index.html).toContain('data-route="index"');
    expect(about.html).toContain('data-route="about"');
    expect(contact.html).toContain('data-route="contact"');

    expect(index.html).not.toContain('data-route="about"');
    expect(about.html).not.toContain('data-route="contact"');
    expect(contact.html).not.toContain('data-route="index"');
  });

  it('each request gets fresh container state', async () => {
    // CounterDisplay's tracked count starts at 0. If the container
    // singleton bled between requests, an incremented value could leak.
    const index = await renderRoute('/');
    const about = await renderRoute('/about');

    expect(index.html).toContain('data-count="0"');
    expect(about.html).toContain('data-count="0"');
  });
});

// ─── Fetch in route model hooks ──────────────────────────────────────

describe('SSR with fetch in route model hooks', () => {
  it('renders a list route with fetched data', async () => {
    const { html, rendered } = await renderRoute('/pokemon-fetch');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();
    expect(html).toContain('data-route="pokemon-fetch"');
    expect(html).toContain('data-pokemon="bulbasaur"');
    expect(html).toContain('href="/pokemon-fetch/bulbasaur"');
  }, 15_000);

  it('renders a detail route with dynamic params and parent model', async () => {
    const { html, rendered } = await renderRoute('/pokemon-fetch/pikachu');

    expect(rendered.statusCode).toBe(200);
    // Detail content
    expect(html).toContain('data-pokemon-name="pikachu"');
    expect(html).toContain('data-type="electric"');
    // Parent route also rendered
    expect(html).toContain('data-component="pokemon-list"');
  }, 15_000);

  it('renders different params correctly across sequential renders', async () => {
    const pikachu = await renderRoute('/pokemon-fetch/pikachu');
    const charmander = await renderRoute('/pokemon-fetch/charmander');

    expect(pikachu.html).toContain('data-pokemon-name="pikachu"');
    expect(charmander.html).toContain('data-pokemon-name="charmander"');

    expect(pikachu.html).not.toContain('data-pokemon-name="charmander"');
    expect(charmander.html).not.toContain('data-pokemon-name="pikachu"');
  }, 15_000);

  it('renders a WarpDrive-backed route with awaited request data', async () => {
    const { html, rendered } = await renderRoute('/pokemon-warp-drive');

    expect(rendered.statusCode).toBe(200);
    expect(html).toContain('data-pokemon="bulbasaur"');
    expect(html).not.toContain('data-loading');
  }, 15_000);
});

// ─── Shoebox: server-side fetch capture ──────────────────────────────

describe('SSR shoebox (fetch capture)', () => {
  it('serializes captured fetch responses into a head script tag', async () => {
    const { html } = await renderRoute('/pokemon-fetch', { shoebox: true });

    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
    expect(headMatch).not.toBeNull();
    expect(headMatch[1]).toContain('id="vite-ember-ssr-shoebox"');
    expect(headMatch[1]).toContain('type="application/json"');
  }, 15_000);

  it('captures entries with the expected shape', async () => {
    const { html } = await renderRoute('/pokemon-fetch', { shoebox: true });

    const scriptMatch = html.match(
      /<script type="application\/json" id="vite-ember-ssr-shoebox">([\s\S]*?)<\/script>/,
    );
    const entries = JSON.parse(scriptMatch[1]);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry).toHaveProperty('url');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('statusText');
      expect(entry).toHaveProperty('headers');
      expect(entry).toHaveProperty('body');
    }
  }, 15_000);

  it('captures parent and child route fetches for detail pages', async () => {
    const { html } = await renderRoute('/pokemon-fetch/pikachu', {
      shoebox: true,
    });

    const scriptMatch = html.match(
      /<script type="application\/json" id="vite-ember-ssr-shoebox">([\s\S]*?)<\/script>/,
    );
    const entries = JSON.parse(scriptMatch[1]);

    const listEntry = entries.find(
      (e) =>
        e.url.includes('pokemon?limit=') || e.url.includes('pokemon?limit%3D'),
    );
    const detailEntry = entries.find((e) => e.url.includes('pokemon/pikachu'));

    expect(listEntry).toBeDefined();
    expect(detailEntry).toBeDefined();

    const detailBody = JSON.parse(detailEntry.body);
    expect(detailBody.name).toBe('pikachu');
  }, 15_000);

  it('captures WarpDrive route fetches', async () => {
    const { html } = await renderRoute('/pokemon-warp-drive', {
      shoebox: true,
    });

    const scriptMatch = html.match(
      /<script type="application\/json" id="vite-ember-ssr-shoebox">([\s\S]*?)<\/script>/,
    );
    const entries = JSON.parse(scriptMatch[1]);

    const pokeEntry = entries.find((e) => e.url.includes('pokeapi.co'));
    expect(pokeEntry).toBeDefined();
    expect(pokeEntry.status).toBe(200);
  }, 15_000);

  it('omits the shoebox when disabled or unused', async () => {
    // No fetch, shoebox enabled: nothing to serialize
    const { html: noFetch } = await renderRoute('/', { shoebox: true });
    expect(noFetch).not.toContain('id="vite-ember-ssr-shoebox"');

    // Fetch route, shoebox disabled: not serialized even though fetch ran
    const { html: disabled } = await renderRoute('/pokemon-fetch', {
      shoebox: false,
    });
    expect(disabled).not.toContain('id="vite-ember-ssr-shoebox"');
  }, 15_000);
});

// ─── settled() drains test waiters before DOM capture ────────────────

describe('SSR awaits settled() when the SSR bundle exports it', () => {
  it('captures post-settled state for routes that register @ember/test-waiters', async () => {
    // The waiter-test route renders a component that, in its constructor,
    // registers a waiter and schedules a setTimeout that updates tracked
    // state and ends the waiter 50ms later. Without `settled()` after
    // `app.visit()`, the renderer would capture `data-waiter-result=""`.
    // With it, the waiter blocks DOM capture until the timeout fires.
    const { html } = await renderRoute('/waiter-test');

    expect(html).toContain('data-component="waiter-check"');
    expect(html).toContain('data-waiter-result="ok"');
  });
});

// ─── Body attributes ─────────────────────────────────────────────────

describe('body attributes', () => {
  it('returns bodyAttrs as an empty object when no attributes are set', async () => {
    const { rendered } = await renderRoute('/');

    expect(rendered.bodyAttrs).toBeDefined();
    expect(typeof rendered.bodyAttrs).toBe('object');
  });

  it('assembleHTML drops stylesheet links that the template already has', () => {
    const tmpl =
      '<html><head><link rel="stylesheet" crossorigin href="/assets/entry-abc.css"><!-- VITE_EMBER_SSR_HEAD --></head><body><!-- VITE_EMBER_SSR_BODY --></body></html>';
    const rendered = {
      head: '<link rel="stylesheet" href="/assets/entry-abc.css"><link rel="stylesheet" href="/assets/route-def.css"><title>Test</title>',
      body: '<div>content</div>',
    };
    const html = assembleHTML(tmpl, rendered);

    expect(html.match(/entry-abc\.css/g)).toHaveLength(1);
    expect(html).toContain(
      '<link rel="stylesheet" href="/assets/route-def.css">',
    );
    expect(html).toContain('<title>Test</title>');
  });

  it('assembleHTML applies bodyAttrs to the <body> tag', () => {
    const tmpl =
      '<html><head><!-- VITE_EMBER_SSR_HEAD --></head><body><!-- VITE_EMBER_SSR_BODY --></body></html>';
    const rendered = {
      head: '<title>Test</title>',
      body: '<div>content</div>',
      bodyAttrs: { 'data-theme': 'dark', class: 'ember-application' },
    };
    const html = assembleHTML(tmpl, rendered);

    expect(html).toContain(
      '<body data-theme="dark" class="ember-application">',
    );
    expect(html).toContain('<div>content</div>');
    expect(html).toContain('<title>Test</title>');
  });

  it('assembleHTML preserves existing body attributes', () => {
    const tmpl =
      '<html><head><!-- VITE_EMBER_SSR_HEAD --></head><body id="app"><!-- VITE_EMBER_SSR_BODY --></body></html>';
    const rendered = {
      head: '',
      body: '<div>content</div>',
      bodyAttrs: { 'data-theme': 'light' },
    };
    const html = assembleHTML(tmpl, rendered);

    expect(html).toContain('id="app"');
    expect(html).toContain('data-theme="light"');
  });

  it('assembleHTML handles empty bodyAttrs gracefully', () => {
    const tmpl =
      '<html><head><!-- VITE_EMBER_SSR_HEAD --></head><body><!-- VITE_EMBER_SSR_BODY --></body></html>';
    const rendered = { head: '', body: '<div>hi</div>', bodyAttrs: {} };
    const html = assembleHTML(tmpl, rendered);

    expect(html).toContain('<body>');
    expect(html).not.toContain('<body >');
  });

  it('assembleHTML escapes attribute values', () => {
    const tmpl =
      '<html><head><!-- VITE_EMBER_SSR_HEAD --></head><body><!-- VITE_EMBER_SSR_BODY --></body></html>';
    const rendered = {
      head: '',
      body: '',
      bodyAttrs: { 'data-info': 'he said "hello"' },
    };
    const html = assembleHTML(tmpl, rendered);

    expect(html).toContain('data-info="he said &quot;hello&quot;"');
  });

  it('bodyAttrs do not bleed between renders', async () => {
    const first = await renderRoute('/');
    const second = await renderRoute('/about');

    expect(first.rendered.bodyAttrs).toBeDefined();
    expect(second.rendered.bodyAttrs).toBeDefined();
  });
});

// ─── Worker reuse ────────────────────────────────────────────────────

describe('head isolation across renders', () => {
  it("doesn't carry one render's head into the next", async () => {
    // One worker, so every render shares a Window. With the default pool size
    // a machine with enough cores gives each render its own worker and hides
    // the leak.
    const single = await createEmberApp(ssrBundlePath, { workers: 1 });

    try {
      for (const route of ['index', 'about', 'index', 'about']) {
        const { head } = await single.renderRoute(
          route === 'index' ? '/' : `/${route}`,
        );

        expect(head.match(/<script glmr=/g) ?? []).toHaveLength(1);
        expect(head.match(/name="route-head"/g) ?? []).toHaveLength(1);
        expect(head).toContain(`content="${route}"`);
      }
    } finally {
      await single.destroy();
    }
  });
});

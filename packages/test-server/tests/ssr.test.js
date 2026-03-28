import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderEmberApp, assembleHTML } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppDist = resolve(__dirname, '../../test-app/dist');

let createSsrApp;
let template;

beforeAll(async () => {
  const serverEntryPath = resolve(testAppDist, 'server/app-ssr.mjs');
  const appModule = await import(serverEntryPath);
  createSsrApp = appModule.createSsrApp;

  template = await readFile(resolve(testAppDist, 'client/index.html'), 'utf-8');
});

/**
 * Helper: render a route and return the assembled HTML string.
 */
async function renderRoute(url) {
  const rendered = await renderEmberApp({ url, createApp: createSsrApp });
  const html = assembleHTML(template, rendered);
  return { html, rendered };
}

// ─── Route rendering ─────────────────────────────────────────────────

describe('SSR routing', () => {
  it('renders the index route at /', async () => {
    const { html, rendered } = await renderRoute('/');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // Index-specific content
    expect(html).toContain('data-route="index"');
    expect(html).toContain('Welcome to vite-ember-ssr');
    expect(html).toContain('Server-side rendered Ember application.');
    expect(html).toContain('test-logo');

    // Navigation (now uses LinkTo)
    expect(html).toContain('data-component="navigation"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/contact"');
  });

  it('renders the about route at /about', async () => {
    const { html, rendered } = await renderRoute('/about');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // About-specific content
    expect(html).toContain('data-route="about"');
    expect(html).toContain('<h1>About</h1>');
    expect(html).toContain('HappyDOM');

    // Should NOT contain index-only content
    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('Welcome to vite-ember-ssr');
  });

  it('renders the contact route at /contact', async () => {
    const { html, rendered } = await renderRoute('/contact');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // Contact-specific content
    expect(html).toContain('data-route="contact"');
    expect(html).toContain('<h1>Contact</h1>');
    expect(html).toContain('test@example.com');
    expect(html).toContain('GitHub: vite-ember-ssr');

    // Should NOT contain other route content
    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('data-route="about"');
  });
});

// ─── HTML structure ──────────────────────────────────────────────────

describe('SSR HTML structure', () => {
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

    expect(rendered.head).toContain('<title>TestApp</title>');
  });
});

// ─── Components in SSR ───────────────────────────────────────────────

describe('SSR component rendering', () => {
  it('renders the CounterDisplay component with initial state', async () => {
    const { html } = await renderRoute('/');

    // Component is present
    expect(html).toContain('data-component="counter-display"');

    // Initial counter state
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-label="zero"');
    expect(html).toContain('data-status="zero"');
    expect(html).toContain('The count is zero.');

    // Action buttons are rendered
    expect(html).toContain('data-action="increment"');
    expect(html).toContain('data-action="decrement"');
    expect(html).toContain('data-action="reset"');
  });

  it('renders the ItemList component with all items', async () => {
    const { html } = await renderRoute('/');

    // Component is present
    expect(html).toContain('data-component="item-list"');

    // Default filter is "all"
    expect(html).toContain('data-filter="all"');
    expect(html).toContain('data-item-count="5"');
    expect(html).toContain('Showing 5 of 5 items');

    // All items rendered
    expect(html).toContain('data-item-id="1"');
    expect(html).toContain('Vite');
    expect(html).toContain('data-item-id="2"');
    expect(html).toContain('Ember');
    expect(html).toContain('data-item-id="3"');
    expect(html).toContain('HappyDOM');
    expect(html).toContain('data-item-id="4"');
    expect(html).toContain('Glimmer');
    expect(html).toContain('data-item-id="5"');
    expect(html).toContain('TypeScript');

    // Category filter buttons
    expect(html).toContain('data-category="all"');
    expect(html).toContain('data-category="framework"');
    expect(html).toContain('data-category="language"');
    expect(html).toContain('data-category="tooling"');
  });

  it('renders CounterDisplay on the about route too', async () => {
    const { html } = await renderRoute('/about');

    expect(html).toContain('data-component="counter-display"');
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-status="zero"');
  });

  it('does not render ItemList on the about route', async () => {
    const { html } = await renderRoute('/about');

    expect(html).not.toContain('data-component="item-list"');
  });

  it('does not render interactive components on the contact route', async () => {
    const { html } = await renderRoute('/contact');

    expect(html).not.toContain('data-component="counter-display"');
    expect(html).not.toContain('data-component="item-list"');
  });
});

// ─── LinkTo rendering ────────────────────────────────────────────────

describe('SSR LinkTo rendering', () => {
  it('renders LinkTo as <a> tags with correct hrefs', async () => {
    const { html } = await renderRoute('/');

    // LinkTo renders as anchor elements
    expect(html).toMatch(/<a[^>]+href="\/"[^>]*>Home<\/a>/);
    expect(html).toMatch(/<a[^>]+href="\/about"[^>]*>About<\/a>/);
    expect(html).toMatch(/<a[^>]+href="\/contact"[^>]*>Contact<\/a>/);
  });

  it('marks the active route link', async () => {
    const { html: indexHtml } = await renderRoute('/');
    const { html: aboutHtml } = await renderRoute('/about');

    // On index, the Home link should have "active" class
    const homeLink = indexHtml.match(/<a[^>]+href="\/"[^>]*>/);
    expect(homeLink?.[0]).toContain('active');

    // On about, the About link should have "active" class
    const aboutLink = aboutHtml.match(/<a[^>]+href="\/about"[^>]*>/);
    expect(aboutLink?.[0]).toContain('active');
  });
});

// ─── Isolation ───────────────────────────────────────────────────────

describe('SSR renders each route independently', () => {
  it('renders different content for sequential requests', async () => {
    const index = await renderRoute('/');
    const about = await renderRoute('/about');
    const contact = await renderRoute('/contact');

    // Each has its own data-route
    expect(index.html).toContain('data-route="index"');
    expect(about.html).toContain('data-route="about"');
    expect(contact.html).toContain('data-route="contact"');

    // No cross-contamination
    expect(index.html).not.toContain('data-route="about"');
    expect(about.html).not.toContain('data-route="contact"');
    expect(contact.html).not.toContain('data-route="index"');
  });

  it('each SSR request gets fresh counter state', async () => {
    // Both index and about have CounterDisplay, both should show 0
    const index = await renderRoute('/');
    const about = await renderRoute('/about');

    // Counter starts at 0 on every SSR request (no state leakage)
    expect(index.html).toContain('data-count="0"');
    expect(about.html).toContain('data-count="0"');
  });
});

// ─── Fetch in route model hooks ──────────────────────────────────────

describe('SSR with fetch in route model hooks', () => {
  it('renders the pokemon list at /pokemon-fetch with fetched data', async () => {
    const { html, rendered } = await renderRoute('/pokemon-fetch');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // Route layout
    expect(html).toContain('data-route="pokemon-fetch"');
    expect(html).toContain('<h1>Pokémon (Fetch)</h1>');
    expect(html).toContain('data-component="pokemon-list"');

    // Should have 12 pokemon from the API
    expect(html).toContain('data-pokemon="bulbasaur"');
    expect(html).toContain('data-pokemon="ivysaur"');
    expect(html).toContain('data-pokemon="charmander"');
    expect(html).toContain('data-pokemon="squirtle"');

    // Each pokemon should have a link to its detail page
    expect(html).toContain('href="/pokemon-fetch/bulbasaur"');
    expect(html).toContain('href="/pokemon-fetch/charmander"');
  }, 15_000);

  it('renders a pokemon detail page with fetched data', async () => {
    const { html, rendered } = await renderRoute('/pokemon-fetch/pikachu');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // Detail view
    expect(html).toContain('data-route="pokemon-fetch.show"');
    expect(html).toContain('data-pokemon-name="pikachu"');
    expect(html).toContain('<h2>pikachu</h2>');

    // Sprite image
    expect(html).toContain('data-sprite');
    expect(html).toContain('src="https://raw.githubusercontent.com/PokeAPI/sprites/');

    // Stats from the API
    expect(html).toContain('data-field="id"');
    expect(html).toContain('25');  // pikachu's id
    expect(html).toContain('data-type="electric"');
    expect(html).toContain('data-ability="static"');

    // Base stats
    expect(html).toContain('data-stat="hp"');
    expect(html).toContain('data-stat="speed"');
  }, 15_000);

  it('renders the parent pokemon list alongside the detail view', async () => {
    const { html } = await renderRoute('/pokemon-fetch/pikachu');

    // Parent route (pokemon list) should also be rendered
    expect(html).toContain('data-component="pokemon-list"');
    expect(html).toContain('data-pokemon="bulbasaur"');

    // And the child detail
    expect(html).toContain('data-pokemon-name="pikachu"');
  }, 15_000);

  it('renders different pokemon detail pages correctly', async () => {
    const pikachu = await renderRoute('/pokemon-fetch/pikachu');
    const charmander = await renderRoute('/pokemon-fetch/charmander');

    // Different pokemon
    expect(pikachu.html).toContain('data-pokemon-name="pikachu"');
    expect(pikachu.html).toContain('data-type="electric"');

    expect(charmander.html).toContain('data-pokemon-name="charmander"');
    expect(charmander.html).toContain('data-type="fire"');

    // No cross-contamination
    expect(pikachu.html).not.toContain('data-pokemon-name="charmander"');
    expect(charmander.html).not.toContain('data-pokemon-name="pikachu"');
  }, 15_000);

  it('does not show pokemon data on non-pokemon routes', async () => {
    const { html } = await renderRoute('/');

    expect(html).not.toContain('data-route="pokemon-fetch"');
    expect(html).not.toContain('data-component="pokemon-list"');
  });
});

// ─── WarpDrive pokemon route (SSR renders loading state) ─────────────

describe('SSR with WarpDrive pokemon route', () => {
  it('renders the pokemon-warp-drive route with loading state', async () => {
    const { html, rendered } = await renderRoute('/pokemon-warp-drive');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // Route layout present
    expect(html).toContain('data-route="pokemon-warp-drive"');
    expect(html).toContain('<h1>Pokémon (WarpDrive)</h1>');

    // <Request> component shows loading block during SSR
    // (request is in-flight, not yet resolved)
    expect(html).toContain('data-loading');
    expect(html).toContain('Loading Pokémon...');
  });

  it('renders the pokemon-warp-drive show route with loading state', async () => {
    const { html, rendered } = await renderRoute('/pokemon-warp-drive/pikachu');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // Parent route present
    expect(html).toContain('data-route="pokemon-warp-drive"');

    // Detail shows loading state during SSR
    expect(html).toContain('Loading');
  });
});

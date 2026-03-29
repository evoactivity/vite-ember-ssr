import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderEmberApp, assembleHTML } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppDist = resolve(__dirname, '../../test-app-lazy-ssr/dist');

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
async function renderRoute(url, options = {}) {
  const rendered = await renderEmberApp({
    url,
    createApp: createSsrApp,
    ...options,
  });
  const html = assembleHTML(template, rendered);
  return { html, rendered };
}

// ─── Route rendering ─────────────────────────────────────────────────

describe('Lazy SSR routing', () => {
  it('renders the index route at / (eager)', async () => {
    const { html, rendered } = await renderRoute('/');

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();

    // Index-specific content
    expect(html).toContain('data-route="index"');
    expect(html).toContain('Welcome to vite-ember-ssr');
    expect(html).toContain('Server-side rendered Ember application.');

    // Navigation
    expect(html).toContain('data-component="navigation"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/contact"');
  });

  it('renders the about route at /about (lazy)', async () => {
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

  it('renders the contact route at /contact (lazy)', async () => {
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

describe('Lazy SSR HTML structure', () => {
  it('replaces SSR markers in the template', async () => {
    const { html } = await renderRoute('/');

    expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
    expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
  });

  it('includes SSR boundary markers in body (cleanup mode)', async () => {
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

// ─── Components in lazy SSR ──────────────────────────────────────────

describe('Lazy SSR component rendering', () => {
  it('renders the CounterDisplay component on index', async () => {
    const { html } = await renderRoute('/');

    expect(html).toContain('data-component="counter-display"');
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-label="zero"');
    expect(html).toContain('data-status="zero"');
    expect(html).toContain('The count is zero.');
  });

  it('renders the ItemList component on index', async () => {
    const { html } = await renderRoute('/');

    expect(html).toContain('data-component="item-list"');
    expect(html).toContain('data-filter="all"');
    expect(html).toContain('data-item-count="5"');
    expect(html).toContain('Vite');
    expect(html).toContain('Ember');
    expect(html).toContain('HappyDOM');
    expect(html).toContain('Glimmer');
    expect(html).toContain('TypeScript');
  });

  it('renders CounterDisplay on the about route (lazy)', async () => {
    const { html } = await renderRoute('/about');

    expect(html).toContain('data-component="counter-display"');
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-status="zero"');
  });

  it('does not render ItemList on the about route', async () => {
    const { html } = await renderRoute('/about');

    expect(html).not.toContain('data-component="item-list"');
  });

  it('does not render interactive components on the contact route (lazy)', async () => {
    const { html } = await renderRoute('/contact');

    expect(html).not.toContain('data-component="counter-display"');
    expect(html).not.toContain('data-component="item-list"');
  });
});

// ─── LinkTo rendering ────────────────────────────────────────────────

describe('Lazy SSR LinkTo rendering', () => {
  it('renders LinkTo as <a> tags with correct hrefs', async () => {
    const { html } = await renderRoute('/');

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

describe('Lazy SSR renders each route independently', () => {
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
    const index = await renderRoute('/');
    const about = await renderRoute('/about');

    expect(index.html).toContain('data-count="0"');
    expect(about.html).toContain('data-count="0"');
  });
});

// ─── No shoebox (not using shoebox option) ───────────────────────────

describe('Lazy SSR no shoebox', () => {
  it('does NOT include a shoebox when shoebox option is omitted', async () => {
    const { html } = await renderRoute('/');
    expect(html).not.toContain('id="vite-ember-ssr-shoebox"');
  });

  it('does NOT include a shoebox on lazy routes', async () => {
    const { html: about } = await renderRoute('/about');
    const { html: contact } = await renderRoute('/contact');

    expect(about).not.toContain('id="vite-ember-ssr-shoebox"');
    expect(contact).not.toContain('id="vite-ember-ssr-shoebox"');
  });
});

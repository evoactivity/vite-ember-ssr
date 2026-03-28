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

    // Application layout (nav)
    expect(html).toContain('<nav>');
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

    // Should NOT contain index content
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
});

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  renderEmberApp,
  assembleHTML,
  loadCssManifest,
} from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppDist = resolve(__dirname, '../../test-app-lazy-ssr/dist');

let template;
let cssManifest;

const ssrBundlePath = resolve(testAppDist, 'server/app-ssr.mjs');

beforeAll(async () => {
  template = await readFile(resolve(testAppDist, 'client/index.html'), 'utf-8');
  cssManifest = await loadCssManifest(resolve(testAppDist, 'client'));
});

/**
 * Helper: render a route and return the assembled HTML string.
 */
async function renderRoute(url, options = {}) {
  const rendered = await renderEmberApp({
    url,
    ssrBundlePath,
    cssManifest,
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
    expect(html).toMatch(/<h1>About\s/);
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
    expect(html).toMatch(/<h1>Contact\s/);
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

  it('renders AboutInfo component on the about route (lazy, has own CSS)', async () => {
    const { html } = await renderRoute('/about');

    expect(html).toContain('data-component="about-info"');
    expect(html).toContain('About Info Component');
  });

  it('does not render AboutInfo on the index route', async () => {
    const { html } = await renderRoute('/');

    expect(html).not.toContain('data-component="about-info"');
  });

  it('does not render AboutInfo on the contact route', async () => {
    const { html } = await renderRoute('/contact');

    expect(html).not.toContain('data-component="about-info"');
  });

  it('does not render ItemList on the about route', async () => {
    const { html } = await renderRoute('/about');

    expect(html).not.toContain('data-component="item-list"');
  });

  it('does not render interactive components on the contact route (lazy)', async () => {
    const { html } = await renderRoute('/contact');

    expect(html).not.toContain('data-component="counter-display"');
    expect(html).not.toContain('data-component="item-list"');
    expect(html).not.toContain('data-component="about-info"');
  });

  it('renders SharedBadge on both about and contact routes', async () => {
    const { html: about } = await renderRoute('/about');
    const { html: contact } = await renderRoute('/contact');

    expect(about).toContain('data-component="shared-badge"');
    expect(contact).toContain('data-component="shared-badge"');
  });

  it('does not render SharedBadge on the index route (eager)', async () => {
    const { html } = await renderRoute('/');

    expect(html).not.toContain('data-component="shared-badge"');
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

// ─── CSS manifest ────────────────────────────────────────────────────

describe('Lazy SSR CSS manifest', () => {
  it('loads the css-manifest.json from the client dist', () => {
    expect(cssManifest).toBeDefined();
    expect(typeof cssManifest).toBe('object');
  });

  it('manifest contains the about route with CSS files', () => {
    expect(cssManifest).toHaveProperty('about');
    expect(cssManifest.about).toBeInstanceOf(Array);
    expect(cssManifest.about.length).toBeGreaterThan(0);
  });

  it('manifest contains the contact route with shared component CSS', () => {
    // contact.gts imports SharedBadge which has its own CSS
    expect(cssManifest).toHaveProperty('contact');
    expect(cssManifest.contact).toBeInstanceOf(Array);
    expect(cssManifest.contact.length).toBeGreaterThan(0);
  });

  it('manifest does not contain the index route (eager, not dynamic)', () => {
    expect(cssManifest).not.toHaveProperty('index');
  });

  it('about route has both its own CSS and shared component CSS', () => {
    // about.gts has: direct about.css + about-info.css (transitive) + shared-badge.css (shared)
    // Vite merges about.css + about-info.css into one chunk, shared-badge.css is separate
    expect(cssManifest.about.length).toBe(2);
    expect(cssManifest.about).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/assets\/about-[a-zA-Z0-9_-]+\.css$/),
        expect.stringMatching(/\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css$/),
      ]),
    );
  });

  it('contact route has only shared component CSS', () => {
    // contact.gts only imports SharedBadge (no direct CSS import)
    expect(cssManifest.contact.length).toBe(1);
    expect(cssManifest.contact[0]).toMatch(
      /\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css$/,
    );
  });

  it('shared component CSS path is the same in both routes', () => {
    // The shared-badge CSS should be deduplicated into a single file
    const aboutSharedCss = cssManifest.about.find((p) =>
      p.includes('shared-badge'),
    );
    const contactSharedCss = cssManifest.contact.find((p) =>
      p.includes('shared-badge'),
    );
    expect(aboutSharedCss).toBeDefined();
    expect(contactSharedCss).toBeDefined();
    expect(aboutSharedCss).toBe(contactSharedCss);
  });
});

// ─── Lazy CSS injection ──────────────────────────────────────────────

describe('Lazy SSR CSS link injection', () => {
  it('injects <link> tags for the about route CSS', async () => {
    const { html } = await renderRoute('/about');

    // About has both its own CSS and shared-badge CSS
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('injects <link> tag for shared component CSS on the contact route', async () => {
    const { html } = await renderRoute('/contact');

    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
    // Contact should NOT have the about-specific CSS
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('does NOT inject lazy CSS <link> on the index route (eager)', async () => {
    const { html } = await renderRoute('/');

    // The main CSS bundle is already linked by Vite in the template.
    // No lazy route CSS should appear here.
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('CSS link tags appear in the <head> section', async () => {
    const { rendered } = await renderRoute('/about');

    expect(rendered.head).toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(rendered.head).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('CSS links are injected before other head content', async () => {
    const { rendered } = await renderRoute('/about');

    // CSS links should come first in the head (before title, etc.)
    const cssLinkPos = rendered.head.search(/<link rel="stylesheet"/);
    const titlePos = rendered.head.search(/<title>/);

    expect(cssLinkPos).toBeGreaterThanOrEqual(0);
    if (titlePos >= 0) {
      expect(cssLinkPos).toBeLessThan(titlePos);
    }
  });

  it('works correctly without a CSS manifest (graceful no-op)', async () => {
    // Render without passing cssManifest
    const rendered = await renderEmberApp({
      url: '/about',
      ssrBundlePath,
    });
    const html = assembleHTML(template, rendered);

    // Should still render successfully, just without CSS links
    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();
    expect(html).toContain('data-route="about"');
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
  });
});

// ─── Transitive CSS (component → CSS) ───────────────────────────────

describe('Lazy SSR transitive CSS injection (route → component → CSS)', () => {
  it('the about-specific CSS bundle includes component CSS (about-info.css)', async () => {
    // The about route's own CSS file should contain styles from both:
    // - about.css (direct import in about.gts)
    // - about-info.css (transitive: about.gts → about-info.gts → about-info.css)
    // Vite merges them into a single CSS asset for the dynamic entry chunk.
    const aboutCssPath = cssManifest.about.find((p) => p.includes('/about-'));
    expect(aboutCssPath).toBeDefined();

    const cssContent = await readFile(
      resolve(testAppDist, 'client', aboutCssPath.slice(1)),
      'utf-8',
    );

    // From about.css (CSS minifier converts 'red' to shorthand)
    expect(cssContent).toMatch(/background:red|background:#f00/);
    // From about-info.css (transitive via component import)
    expect(cssContent).toContain('.about-info');
    expect(cssContent).toContain('.about-info__title');
  });

  it('shared-badge CSS is in a separate file (shared across routes)', async () => {
    const sharedCssPath = cssManifest.about.find((p) =>
      p.includes('shared-badge'),
    );
    expect(sharedCssPath).toBeDefined();

    const cssContent = await readFile(
      resolve(testAppDist, 'client', sharedCssPath.slice(1)),
      'utf-8',
    );

    expect(cssContent).toContain('.shared-badge');
  });
});

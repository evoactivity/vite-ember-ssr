import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const lazyDist = resolve(__dirname, '../../test-app-lazy-ssg/dist');

let cssManifest;

/**
 * Helper: read a prerendered HTML file from the lazy SSG dist output.
 */
async function readLazyHtml(route) {
  const filePath =
    route === 'index'
      ? resolve(lazyDist, 'index.html')
      : resolve(lazyDist, route, 'index.html');
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

beforeAll(async () => {
  const raw = await readFile(resolve(lazyDist, 'css-manifest.json'), 'utf-8');
  cssManifest = JSON.parse(raw);
});

// ─── File structure ──────────────────────────────────────────────────

describe('Lazy SSG output file structure', () => {
  it('generates index.html at the root (eager route)', async () => {
    const exists = await fileExists(resolve(lazyDist, 'index.html'));
    expect(exists).toBe(true);
  });

  it('generates about/index.html (lazy route)', async () => {
    const exists = await fileExists(resolve(lazyDist, 'about/index.html'));
    expect(exists).toBe(true);
  });

  it('generates contact/index.html (lazy route)', async () => {
    const exists = await fileExists(resolve(lazyDist, 'contact/index.html'));
    expect(exists).toBe(true);
  });

  it('includes static assets directory', async () => {
    const exists = await fileExists(resolve(lazyDist, 'assets'));
    expect(exists).toBe(true);
  });

  it('cleans up the .ssg-tmp directory after build', async () => {
    const exists = await fileExists(resolve(lazyDist, '../.ssg-tmp'));
    expect(exists).toBe(false);
  });
});

// ─── HTML structure ──────────────────────────────────────────────────

describe('Lazy SSG HTML structure', () => {
  it('replaces SSR markers in all pages', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readLazyHtml(route);
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
    }
  });

  it('includes SSR boundary markers in cleanup mode', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readLazyHtml(route);
      expect(html).toContain('id="ssr-body-start"');
      expect(html).toContain('id="ssr-body-end"');
    }
  });

  it('includes the client JS bundle in all pages', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readLazyHtml(route);
      expect(html).toMatch(/src="\/assets\/main-[a-zA-Z0-9_-]+\.js"/);
    }
  });

  it('includes the CSS bundle in all pages', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readLazyHtml(route);
      expect(html).toMatch(/href="\/assets\/main-[a-zA-Z0-9_-]+\.css"/);
    }
  });

  it('all pages reference the same JS and CSS bundles', async () => {
    const htmls = await Promise.all(
      ['index', 'about', 'contact'].map(readLazyHtml),
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

  it('sets the page title', async () => {
    const html = await readLazyHtml('index');
    expect(html).toContain('<title>TestApp</title>');
  });
});

// ─── Index route (eager) ─────────────────────────────────────────────

describe('Lazy SSG index route (eager)', () => {
  it('contains index-specific content', async () => {
    const html = await readLazyHtml('index');

    expect(html).toContain('data-route="index"');
    expect(html).toContain('Welcome to vite-ember-ssr');
    expect(html).toContain('Server-side rendered Ember application.');
  });

  it('renders the CounterDisplay component with initial state', async () => {
    const html = await readLazyHtml('index');

    expect(html).toContain('data-component="counter-display"');
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-label="zero"');
    expect(html).toContain('data-status="zero"');
    expect(html).toContain('The count is zero.');
  });

  it('renders the ItemList component with all items', async () => {
    const html = await readLazyHtml('index');

    expect(html).toContain('data-component="item-list"');
    expect(html).toContain('data-filter="all"');
    expect(html).toContain('data-item-count="5"');
    expect(html).toContain('Vite');
    expect(html).toContain('Ember');
    expect(html).toContain('HappyDOM');
    expect(html).toContain('Glimmer');
    expect(html).toContain('TypeScript');
  });

  it('renders navigation with correct links', async () => {
    const html = await readLazyHtml('index');

    expect(html).toContain('data-component="navigation"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/contact"');
  });

  it('marks the Home link as active', async () => {
    const html = await readLazyHtml('index');

    const homeLink = html.match(/<a[^>]+href="\/"[^>]*>/);
    expect(homeLink?.[0]).toContain('active');
  });

  it('does not contain other route content', async () => {
    const html = await readLazyHtml('index');

    expect(html).not.toContain('data-route="about"');
    expect(html).not.toContain('data-route="contact"');
  });
});

// ─── About route (lazy) ──────────────────────────────────────────────

describe('Lazy SSG about route (lazy-loaded)', () => {
  it('contains about-specific content', async () => {
    const html = await readLazyHtml('about');

    expect(html).toContain('data-route="about"');
    expect(html).toMatch(/<h1>About\s/);
    expect(html).toContain('HappyDOM');
  });

  it('renders CounterDisplay component', async () => {
    const html = await readLazyHtml('about');

    expect(html).toContain('data-component="counter-display"');
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-status="zero"');
  });

  it('renders AboutInfo component (has own CSS)', async () => {
    const html = await readLazyHtml('about');

    expect(html).toContain('data-component="about-info"');
    expect(html).toContain('About Info Component');
  });

  it('does not render ItemList component', async () => {
    const html = await readLazyHtml('about');

    expect(html).not.toContain('data-component="item-list"');
  });

  it('marks the About link as active', async () => {
    const html = await readLazyHtml('about');

    const aboutLink = html.match(/<a[^>]+href="\/about"[^>]*>/);
    expect(aboutLink?.[0]).toContain('active');
  });

  it('does not contain other route content', async () => {
    const html = await readLazyHtml('about');

    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('data-route="contact"');
  });
});

// ─── Contact route (lazy) ────────────────────────────────────────────

describe('Lazy SSG contact route (lazy-loaded)', () => {
  it('contains contact-specific content', async () => {
    const html = await readLazyHtml('contact');

    expect(html).toContain('data-route="contact"');
    expect(html).toMatch(/<h1>Contact\s/);
    expect(html).toContain('test@example.com');
    expect(html).toContain('GitHub: vite-ember-ssr');
  });

  it('does not render interactive components', async () => {
    const html = await readLazyHtml('contact');

    expect(html).not.toContain('data-component="counter-display"');
    expect(html).not.toContain('data-component="item-list"');
    expect(html).not.toContain('data-component="about-info"');
  });

  it('renders SharedBadge component', async () => {
    const html = await readLazyHtml('contact');

    expect(html).toContain('data-component="shared-badge"');
  });

  it('marks the Contact link as active', async () => {
    const html = await readLazyHtml('contact');

    const contactLink = html.match(/<a[^>]+href="\/contact"[^>]*>/);
    expect(contactLink?.[0]).toContain('active');
  });

  it('does not contain other route content', async () => {
    const html = await readLazyHtml('contact');

    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('data-route="about"');
  });
});

// ─── Route isolation ─────────────────────────────────────────────────

describe('Lazy SSG route isolation (no cross-contamination)', () => {
  it('each page contains only its own data-route attribute', async () => {
    const index = await readLazyHtml('index');
    const about = await readLazyHtml('about');
    const contact = await readLazyHtml('contact');

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

  it('each page gets fresh counter state (no state leakage)', async () => {
    const index = await readLazyHtml('index');
    const about = await readLazyHtml('about');

    // Both pages that have CounterDisplay should show 0
    expect(index).toContain('data-count="0"');
    expect(about).toContain('data-count="0"');
  });
});

// ─── Navigation rendering ────────────────────────────────────────────

describe('Lazy SSG navigation rendering', () => {
  it('renders LinkTo as <a> tags with correct hrefs on all pages', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readLazyHtml(route);

      expect(html).toMatch(/<a[^>]+href="\/"[^>]*>Home<\/a>/);
      expect(html).toMatch(/<a[^>]+href="\/about"[^>]*>About<\/a>/);
      expect(html).toMatch(/<a[^>]+href="\/contact"[^>]*>Contact<\/a>/);
    }
  });

  it('marks the correct link as active for each page', async () => {
    const index = await readLazyHtml('index');
    const about = await readLazyHtml('about');
    const contact = await readLazyHtml('contact');

    // Index: Home link is active
    const homeOnIndex = index.match(/<a[^>]+href="\/"[^>]*>/);
    expect(homeOnIndex?.[0]).toContain('active');
    const aboutOnIndex = index.match(/<a[^>]+href="\/about"[^>]*>/);
    expect(aboutOnIndex?.[0]).not.toContain('active');

    // About: About link is active
    const aboutOnAbout = about.match(/<a[^>]+href="\/about"[^>]*>/);
    expect(aboutOnAbout?.[0]).toContain('active');
    const homeOnAbout = about.match(/<a[^>]+href="\/"[^>]*>/);
    expect(homeOnAbout?.[0]).not.toContain('active');

    // Contact: Contact link is active
    const contactOnContact = contact.match(/<a[^>]+href="\/contact"[^>]*>/);
    expect(contactOnContact?.[0]).toContain('active');
  });
});

// ─── No shoebox (not using shoebox option) ───────────────────────────

describe('Lazy SSG no shoebox', () => {
  it('does NOT include a shoebox on any route', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readLazyHtml(route);
      expect(html).not.toContain('id="vite-ember-ssr-shoebox"');
    }
  });
});

// ─── CSS manifest and lazy CSS injection ─────────────────────────────

describe('Lazy SSG CSS manifest', () => {
  it('generates a css-manifest.json in the dist output', async () => {
    const exists = await fileExists(resolve(lazyDist, 'css-manifest.json'));
    expect(exists).toBe(true);
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

  it('manifest does not contain the index route (eager)', () => {
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

  it('contact route has shared component CSS and its own dependency CSS', () => {
    // contact.gts imports SharedBadge (shared CSS) and nvp.ui (which brings its own CSS)
    expect(cssManifest.contact.length).toBe(2);
    expect(cssManifest.contact).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/assets\/contact-[a-zA-Z0-9_-]+\.css$/),
        expect.stringMatching(/\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css$/),
      ]),
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

describe('Lazy SSG CSS link injection in prerendered HTML', () => {
  it('injects <link> tags for about route CSS (own + shared) in the about page', async () => {
    const html = await readLazyHtml('about');

    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('injects <link> tags for contact route CSS (own + shared) on the contact page', async () => {
    const html = await readLazyHtml('contact');

    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/contact-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
    // Contact should NOT have the about-specific CSS
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('does NOT inject lazy CSS <link> on the index page (eager route)', async () => {
    const html = await readLazyHtml('index');

    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/contact-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('CSS links appear in the <head> section of the about page', async () => {
    const html = await readLazyHtml('about');

    // Extract the <head> content
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
    expect(headMatch).not.toBeNull();

    const headContent = headMatch[1];
    expect(headContent).toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(headContent).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('CSS links appear in the <head> section of the contact page', async () => {
    const html = await readLazyHtml('contact');

    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
    expect(headMatch).not.toBeNull();

    const headContent = headMatch[1];
    expect(headContent).toMatch(
      /<link rel="stylesheet" href="\/assets\/contact-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(headContent).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });
});

// ─── Transitive CSS (route → component → CSS) ──────────────────────

describe('Lazy SSG transitive CSS injection (route → component → CSS)', () => {
  it('renders the AboutInfo component on the about page', async () => {
    const html = await readLazyHtml('about');

    expect(html).toContain('data-component="about-info"');
    expect(html).toContain('About Info Component');
  });

  it('does not render AboutInfo on the index page', async () => {
    const html = await readLazyHtml('index');

    expect(html).not.toContain('data-component="about-info"');
  });

  it('does not render AboutInfo on the contact page', async () => {
    const html = await readLazyHtml('contact');

    expect(html).not.toContain('data-component="about-info"');
  });

  it('the about-specific CSS bundle includes both direct and transitive CSS', async () => {
    // The about route's own CSS file should contain styles from both:
    // - about.css (direct import in about.gts)
    // - about-info.css (transitive: about.gts → about-info.gts → about-info.css)
    // Vite merges them into a single CSS asset for the dynamic entry chunk.
    const aboutCssPath = cssManifest.about.find((p) => p.includes('/about-'));
    expect(aboutCssPath).toBeDefined();

    const cssContent = await readFile(
      resolve(lazyDist, aboutCssPath.slice(1)),
      'utf-8',
    );

    // From about.css (CSS minifier converts 'blue' to '#00f')
    expect(cssContent).toMatch(/background:#00f|background:blue/);
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
      resolve(lazyDist, sharedCssPath.slice(1)),
      'utf-8',
    );

    expect(cssContent).toContain('.shared-badge');
  });
});

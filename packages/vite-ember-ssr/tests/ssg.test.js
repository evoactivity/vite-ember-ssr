import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ssgDist = resolve(__dirname, '../../test-app-ssg/dist');

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

describe('SSG output file structure', () => {
  it('generates index.html at the root', async () => {
    const exists = await fileExists(resolve(ssgDist, 'index.html'));
    expect(exists).toBe(true);
  });

  it('generates about/index.html', async () => {
    const exists = await fileExists(resolve(ssgDist, 'about/index.html'));
    expect(exists).toBe(true);
  });

  it('generates contact/index.html', async () => {
    const exists = await fileExists(resolve(ssgDist, 'contact/index.html'));
    expect(exists).toBe(true);
  });

  it('generates pokemon-fetch/index.html', async () => {
    const exists = await fileExists(
      resolve(ssgDist, 'pokemon-fetch/index.html'),
    );
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

describe('SSG HTML structure', () => {
  it('replaces SSR markers in all pages', async () => {
    for (const route of ['index', 'about', 'contact', 'pokemon-fetch']) {
      const html = await readSsgHtml(route);
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
      expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
    }
  });

  it('includes SSR boundary markers in all pages', async () => {
    for (const route of ['index', 'about', 'contact', 'pokemon-fetch']) {
      const html = await readSsgHtml(route);
      expect(html).toContain('id="ssr-body-start"');
      expect(html).toContain('id="ssr-body-end"');
    }
  });

  it('includes the client JS bundle in all pages', async () => {
    for (const route of ['index', 'about', 'contact', 'pokemon-fetch']) {
      const html = await readSsgHtml(route);
      expect(html).toMatch(/src="\/assets\/main-[a-zA-Z0-9_-]+\.js"/);
    }
  });

  it('includes the CSS bundle in all pages', async () => {
    for (const route of ['index', 'about', 'contact', 'pokemon-fetch']) {
      const html = await readSsgHtml(route);
      expect(html).toMatch(/href="\/assets\/main-[a-zA-Z0-9_-]+\.css"/);
    }
  });

  it('all pages reference the same JS and CSS bundles', async () => {
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

  it('sets the page title', async () => {
    const html = await readSsgHtml('index');
    expect(html).toContain('<title>TestApp</title>');
  });
});

// ─── Index route ─────────────────────────────────────────────────────

describe('SSG index route', () => {
  it('contains index-specific content', async () => {
    const html = await readSsgHtml('index');

    expect(html).toContain('data-route="index"');
    expect(html).toContain('Welcome to vite-ember-ssr');
    expect(html).toContain('Server-side rendered Ember application.');
  });

  it('renders the CounterDisplay component with initial state', async () => {
    const html = await readSsgHtml('index');

    expect(html).toContain('data-component="counter-display"');
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-label="zero"');
    expect(html).toContain('data-status="zero"');
    expect(html).toContain('The count is zero.');
    expect(html).toContain('data-action="increment"');
    expect(html).toContain('data-action="decrement"');
    expect(html).toContain('data-action="reset"');
  });

  it('renders the ItemList component with all items', async () => {
    const html = await readSsgHtml('index');

    expect(html).toContain('data-component="item-list"');
    expect(html).toContain('data-filter="all"');
    expect(html).toContain('data-item-count="5"');
    expect(html).toContain('Showing 5 of 5 items');

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
  });

  it('renders navigation with correct links', async () => {
    const html = await readSsgHtml('index');

    expect(html).toContain('data-component="navigation"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/pokemon-fetch"');
  });

  it('marks the Home link as active', async () => {
    const html = await readSsgHtml('index');

    const homeLink = html.match(/<a[^>]+href="\/"[^>]*>/);
    expect(homeLink?.[0]).toContain('active');
  });

  it('does not contain other route content', async () => {
    const html = await readSsgHtml('index');

    expect(html).not.toContain('data-route="about"');
    expect(html).not.toContain('data-route="contact"');
    expect(html).not.toContain('data-route="pokemon-fetch"');
  });
});

// ─── About route ─────────────────────────────────────────────────────

describe('SSG about route', () => {
  it('contains about-specific content', async () => {
    const html = await readSsgHtml('about');

    expect(html).toContain('data-route="about"');
    expect(html).toContain('<h1>About</h1>');
    expect(html).toContain('HappyDOM');
  });

  it('renders CounterDisplay component', async () => {
    const html = await readSsgHtml('about');

    expect(html).toContain('data-component="counter-display"');
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-status="zero"');
  });

  it('does not render ItemList component', async () => {
    const html = await readSsgHtml('about');

    expect(html).not.toContain('data-component="item-list"');
  });

  it('marks the About link as active', async () => {
    const html = await readSsgHtml('about');

    const aboutLink = html.match(/<a[^>]+href="\/about"[^>]*>/);
    expect(aboutLink?.[0]).toContain('active');
  });

  it('does not contain other route content', async () => {
    const html = await readSsgHtml('about');

    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('data-route="contact"');
    expect(html).not.toContain('data-route="pokemon-fetch"');
  });
});

// ─── Contact route ───────────────────────────────────────────────────

describe('SSG contact route', () => {
  it('contains contact-specific content', async () => {
    const html = await readSsgHtml('contact');

    expect(html).toContain('data-route="contact"');
    expect(html).toContain('<h1>Contact</h1>');
    expect(html).toContain('test@example.com');
    expect(html).toContain('GitHub: vite-ember-ssr');
  });

  it('does not render interactive components', async () => {
    const html = await readSsgHtml('contact');

    expect(html).not.toContain('data-component="counter-display"');
    expect(html).not.toContain('data-component="item-list"');
  });

  it('marks the Contact link as active', async () => {
    const html = await readSsgHtml('contact');

    const contactLink = html.match(/<a[^>]+href="\/contact"[^>]*>/);
    expect(contactLink?.[0]).toContain('active');
  });

  it('does not contain other route content', async () => {
    const html = await readSsgHtml('contact');

    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('data-route="about"');
    expect(html).not.toContain('data-route="pokemon-fetch"');
  });
});

// ─── Pokemon-fetch route ─────────────────────────────────────────────

describe('SSG pokemon-fetch route', () => {
  it('contains pokemon-fetch-specific content', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    expect(html).toContain('data-route="pokemon-fetch"');
    expect(html).toContain('<h1>Pokémon (Fetch)</h1>');
    expect(html).toContain('data-component="pokemon-list"');
  });

  it('renders fetched pokemon data', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    // Should have 12 pokemon from the API
    expect(html).toContain('data-pokemon="bulbasaur"');
    expect(html).toContain('data-pokemon="ivysaur"');
    expect(html).toContain('data-pokemon="charmander"');
    expect(html).toContain('data-pokemon="squirtle"');
    expect(html).toContain('data-pokemon="caterpie"');
    expect(html).toContain('data-pokemon="butterfree"');
  });

  it('renders pokemon links to detail pages', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    expect(html).toContain('href="/pokemon-fetch/bulbasaur"');
    expect(html).toContain('href="/pokemon-fetch/charmander"');
    expect(html).toContain('href="/pokemon-fetch/squirtle"');
  });

  it('marks the Pokemon (Fetch) link as active', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    const pokemonLink = html.match(/<a[^>]+href="\/pokemon-fetch"[^>]*>/);
    expect(pokemonLink?.[0]).toContain('active');
  });

  it('does not contain other route content', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    expect(html).not.toContain('data-route="index"');
    expect(html).not.toContain('data-route="about"');
    expect(html).not.toContain('data-route="contact"');
  });
});

// ─── Shoebox in SSG ──────────────────────────────────────────────────

describe('SSG shoebox (fetch replay data)', () => {
  it('includes a shoebox script tag in the pokemon-fetch page', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    expect(html).toContain('id="vite-ember-ssr-shoebox"');
    expect(html).toContain('type="application/json"');
  });

  it('places the shoebox in the <head> section', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
    expect(headMatch).not.toBeNull();

    const headContent = headMatch[1];
    expect(headContent).toContain('id="vite-ember-ssr-shoebox"');
  });

  it('contains valid JSON with captured fetch entries', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    const scriptMatch = html.match(
      /<script type="application\/json" id="vite-ember-ssr-shoebox">([\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();

    const entries = JSON.parse(scriptMatch[1]);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry).toHaveProperty('url');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('statusText');
      expect(entry).toHaveProperty('headers');
      expect(entry).toHaveProperty('body');
      expect(typeof entry.url).toBe('string');
      expect(typeof entry.status).toBe('number');
      expect(typeof entry.body).toBe('string');
    }
  });

  it('captures the pokemon list API URL', async () => {
    const html = await readSsgHtml('pokemon-fetch');

    const scriptMatch = html.match(
      /<script type="application\/json" id="vite-ember-ssr-shoebox">([\s\S]*?)<\/script>/,
    );
    const entries = JSON.parse(scriptMatch[1]);

    const listEntry = entries.find((e) =>
      e.url.includes('pokeapi.co/api/v2/pokemon'),
    );
    expect(listEntry).toBeDefined();
    expect(listEntry.status).toBe(200);

    const body = JSON.parse(listEntry.body);
    expect(body.results).toBeDefined();
    expect(body.results.length).toBe(12);
  });

  it('does NOT include a shoebox on routes that do not fetch data', async () => {
    for (const route of ['index', 'about', 'contact']) {
      const html = await readSsgHtml(route);
      expect(html).not.toContain('id="vite-ember-ssr-shoebox"');
    }
  });
});

// ─── Route isolation ─────────────────────────────────────────────────

describe('SSG route isolation (no cross-contamination)', () => {
  it('each page contains only its own data-route attribute', async () => {
    const index = await readSsgHtml('index');
    const about = await readSsgHtml('about');
    const contact = await readSsgHtml('contact');
    const pokemon = await readSsgHtml('pokemon-fetch');

    expect(index).toContain('data-route="index"');
    expect(index).not.toContain('data-route="about"');
    expect(index).not.toContain('data-route="contact"');
    expect(index).not.toContain('data-route="pokemon-fetch"');

    expect(about).toContain('data-route="about"');
    expect(about).not.toContain('data-route="index"');
    expect(about).not.toContain('data-route="contact"');
    expect(about).not.toContain('data-route="pokemon-fetch"');

    expect(contact).toContain('data-route="contact"');
    expect(contact).not.toContain('data-route="index"');
    expect(contact).not.toContain('data-route="about"');
    expect(contact).not.toContain('data-route="pokemon-fetch"');

    expect(pokemon).toContain('data-route="pokemon-fetch"');
    expect(pokemon).not.toContain('data-route="index"');
    expect(pokemon).not.toContain('data-route="about"');
    expect(pokemon).not.toContain('data-route="contact"');
  });

  it('each page gets fresh counter state (no state leakage)', async () => {
    const index = await readSsgHtml('index');
    const about = await readSsgHtml('about');

    // Both pages that have CounterDisplay should show 0
    expect(index).toContain('data-count="0"');
    expect(about).toContain('data-count="0"');
  });

  it('pokemon data only appears in the pokemon-fetch page', async () => {
    const index = await readSsgHtml('index');
    const about = await readSsgHtml('about');
    const contact = await readSsgHtml('contact');

    for (const html of [index, about, contact]) {
      expect(html).not.toContain('data-pokemon=');
      expect(html).not.toContain('data-component="pokemon-list"');
    }
  });
});

// ─── Navigation rendering ────────────────────────────────────────────

describe('SSG navigation rendering', () => {
  it('renders LinkTo as <a> tags with correct hrefs on all pages', async () => {
    for (const route of ['index', 'about', 'contact', 'pokemon-fetch']) {
      const html = await readSsgHtml(route);

      expect(html).toMatch(/<a[^>]+href="\/"[^>]*>Home<\/a>/);
      expect(html).toMatch(/<a[^>]+href="\/about"[^>]*>About<\/a>/);
      expect(html).toMatch(/<a[^>]+href="\/contact"[^>]*>Contact<\/a>/);
      expect(html).toMatch(
        /<a[^>]+href="\/pokemon-fetch"[^>]*>Pokémon \(Fetch\)<\/a>/,
      );
    }
  });

  it('marks the correct link as active for each page', async () => {
    const index = await readSsgHtml('index');
    const about = await readSsgHtml('about');
    const contact = await readSsgHtml('contact');
    const pokemon = await readSsgHtml('pokemon-fetch');

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

    // Pokemon: Pokemon link is active
    const pokemonOnPokemon = pokemon.match(
      /<a[^>]+href="\/pokemon-fetch"[^>]*>/,
    );
    expect(pokemonOnPokemon?.[0]).toContain('active');
  });
});

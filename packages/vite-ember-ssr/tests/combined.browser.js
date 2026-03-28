import { test, expect } from '@playwright/test';

// ─── Prerendered routes serve static HTML ────────────────────────────

test.describe('Combined: prerendered routes serve static HTML (no JS)', () => {
  test('index route shows prerendered content without JS', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/');

    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Welcome to vite-ember-ssr');
    await expect(page.locator('[data-component="counter-display"]')).toBeVisible();
    await expect(page.locator('[data-component="item-list"]')).toBeVisible();
    await expect(page.locator('[data-count="0"]')).toBeVisible();
  });

  test('about route shows prerendered content without JS', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/about');

    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('About');
    await expect(page.locator('[data-component="counter-display"]')).toBeVisible();
  });

  test('contact route shows prerendered content without JS', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/contact');

    await expect(page.locator('[data-route="contact"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Contact');
    await expect(page.locator('text=test@example.com')).toBeVisible();
  });
});

// ─── Non-prerendered routes fall back to dynamic SSR ─────────────────

test.describe('Combined: non-prerendered routes use dynamic SSR', () => {
  test('pokemon-fetch route is dynamically SSR-rendered', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    // Dynamic SSR should still produce full content
    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Pokémon (Fetch)');
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="charmander"]')).toBeVisible();
  });

  test('dynamic SSR includes shoebox data for fetched routes', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    const shoeboxEl = page.locator('#vite-ember-ssr-shoebox');
    await expect(shoeboxEl).toBeAttached();

    const content = await shoeboxEl.textContent();
    const entries = JSON.parse(content);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.some((e) => e.url.includes('pokeapi.co'))).toBe(true);
  });
});

// ─── Client Ember boot on prerendered pages ──────────────────────────

test.describe('Combined: client Ember boots on prerendered pages', () => {
  test('Ember boots and takes over the index page', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Welcome to vite-ember-ssr');
    await expect(page.locator('[data-component="counter-display"]')).toBeVisible();
  });

  test('SSR boundary markers are removed after boot', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    const startMarker = await page.$('#ssr-body-start');
    const endMarker = await page.$('#ssr-body-end');
    expect(startMarker).toBeNull();
    expect(endMarker).toBeNull();
  });
});

// ─── Client Ember boot on dynamically SSR-rendered pages ─────────────

test.describe('Combined: client Ember boots on dynamic SSR pages', () => {
  test('Ember boots on the dynamically SSR-rendered pokemon-fetch page', async ({ page }) => {
    await page.goto('/pokemon-fetch');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
  });
});

// ─── Client-side navigation across both modes ────────────────────────

test.describe('Combined: client-side navigation between prerendered and SSR routes', () => {
  test('navigates from prerendered route to dynamic SSR route', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    await expect(page.locator('[data-route="index"]')).toBeVisible();

    // Navigate to pokemon-fetch (not prerendered — will use client-side routing)
    await page.locator('nav a:has-text("Pokémon (Fetch)")').click();
    await page.waitForURL('/pokemon-fetch', { timeout: 10_000 });

    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible({ timeout: 10_000 });
  });

  test('navigates from prerendered to prerendered route', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Navigate to About (also prerendered)
    const aboutNav = page.waitForURL('/about', { timeout: 5_000 });
    await page.locator('nav a:has-text("About")').click();
    await aboutNav;

    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('About');

    // Navigate to Contact (also prerendered)
    await page.locator('nav a:has-text("Contact")').click();
    await page.waitForURL('/contact', { timeout: 5_000 });

    await expect(page.locator('[data-route="contact"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Contact');
  });

  test('navigates back from dynamic SSR route to prerendered route', async ({ page }) => {
    await page.goto('/pokemon-fetch');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Navigate to Home (prerendered)
    await page.locator('nav a:has-text("Home")').click();
    await page.waitForURL('/', { timeout: 5_000 });

    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Welcome to vite-ember-ssr');
  });
});

// ─── Interactive components on prerendered pages ─────────────────────

test.describe('Combined: interactivity works on prerendered pages', () => {
  test('counter buttons work after client boot on prerendered page', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    await expect(page.locator('[data-count="0"]')).toBeVisible();

    await page.locator('[data-action="increment"]').click();
    await page.locator('[data-action="increment"]').click();

    await expect(page.locator('[data-count="2"]')).toBeVisible();
    await expect(page.locator('[data-status="positive"]')).toBeVisible();

    await page.locator('[data-action="reset"]').click();
    await expect(page.locator('[data-count="0"]')).toBeVisible();
  });
});

// ─── Shoebox prevents double-fetch on dynamic SSR pages ──────────────

test.describe('Combined: shoebox prevents double-fetching on SSR pages', () => {
  test('no duplicate PokeAPI requests on dynamic SSR pokemon-fetch page', async ({ page }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    await page.goto('/pokemon-fetch');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();

    // Shoebox should prevent client-side refetch
    expect(pokeApiRequests).toHaveLength(0);
  });
});

import { test, expect } from '@playwright/test';

// ─── SSG Content Visible on Load ─────────────────────────────────────

test.describe('SSG static content is visible before client JS boots', () => {
  test('index route shows prerendered content immediately', async ({
    page,
  }) => {
    // Block JS to see pure static HTML content
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/');

    // Prerendered content should be visible
    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Welcome to vite-ember-ssr');
    await expect(page.locator('nav')).toBeVisible();

    // Components should be prerendered
    await expect(
      page.locator('[data-component="counter-display"]'),
    ).toBeVisible();
    await expect(page.locator('[data-component="item-list"]')).toBeVisible();
    await expect(page.locator('[data-count="0"]')).toBeVisible();
    await expect(page.locator('[data-item-count="5"]')).toBeVisible();
  });

  test('about route shows prerendered content immediately', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/about');

    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('About');
    await expect(
      page.locator('[data-component="counter-display"]'),
    ).toBeVisible();
  });

  test('contact route shows prerendered content immediately', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/contact');

    await expect(page.locator('[data-route="contact"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Contact');
    await expect(page.locator('text=test@example.com')).toBeVisible();
    await expect(page.locator('text=GitHub: vite-ember-ssr')).toBeVisible();
  });

  test('pokemon-fetch route shows prerendered content with fetched data', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Pokémon (Fetch)');
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible();

    // Fetched data should be in the static HTML
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="charmander"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="squirtle"]')).toBeVisible();
  });
});

// ─── Client-Side Ember Boot on SSG Pages ─────────────────────────────

test.describe('client Ember app boots on SSG pages', () => {
  test('Ember boots and takes over the index page', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot — SSR boundary markers are removed
    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    // Content should still be present after client takeover
    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Welcome to vite-ember-ssr');
    await expect(
      page.locator('[data-component="counter-display"]'),
    ).toBeVisible();
    await expect(page.locator('[data-component="item-list"]')).toBeVisible();
  });

  test('SSR boundary markers are removed after client boot', async ({
    page,
  }) => {
    await page.goto('/');

    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    const startMarker = await page.$('#ssr-body-start');
    const endMarker = await page.$('#ssr-body-end');
    expect(startMarker).toBeNull();
    expect(endMarker).toBeNull();
  });

  test('Ember boots on the about page', async ({ page }) => {
    await page.goto('/about');

    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('About');
  });

  test('Ember boots on the pokemon-fetch page', async ({ page }) => {
    await page.goto('/pokemon-fetch');

    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
  });
});

// ─── Client-Side Navigation ──────────────────────────────────────────

test.describe('client-side navigation on SSG pages', () => {
  test('navigates between routes via Ember router', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot
    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    await expect(page.locator('[data-route="index"]')).toBeVisible();

    // Navigate to About
    const aboutNav = page.waitForURL('/about', { timeout: 5_000 });
    await page.locator('nav a:has-text("About")').click();
    await aboutNav;

    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('About');
    await expect(page.locator('[data-route="index"]')).not.toBeAttached();

    // Navigate to Contact
    await page.locator('nav a:has-text("Contact")').click();
    await page.waitForURL('/contact', { timeout: 5_000 });

    await expect(page.locator('[data-route="contact"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Contact');

    // Navigate back to Home
    await page.locator('nav a:has-text("Home")').click();
    await page.waitForURL('/', { timeout: 5_000 });

    await expect(page.locator('[data-route="index"]')).toBeVisible();
  });
});

// ─── Interactive Components ──────────────────────────────────────────

test.describe('SSG counter component interactivity', () => {
  test('increment and decrement buttons work after client boot', async ({
    page,
  }) => {
    await page.goto('/');

    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    // Initial state
    await expect(page.locator('[data-count="0"]')).toBeVisible();

    // Click increment 3 times
    const incrementBtn = page.locator('[data-action="increment"]');
    await incrementBtn.click();
    await incrementBtn.click();
    await incrementBtn.click();

    await expect(page.locator('[data-count="3"]')).toBeVisible();
    await expect(page.locator('[data-status="positive"]')).toBeVisible();

    // Click decrement 5 times (3 → -2)
    const decrementBtn = page.locator('[data-action="decrement"]');
    for (let i = 0; i < 5; i++) {
      await decrementBtn.click();
    }

    await expect(page.locator('[data-count="-2"]')).toBeVisible();
    await expect(page.locator('[data-status="negative"]')).toBeVisible();

    // Reset
    await page.locator('[data-action="reset"]').click();
    await expect(page.locator('[data-count="0"]')).toBeVisible();
  });
});

// ─── Item List filtering ─────────────────────────────────────────────

test.describe('SSG item list filtering', () => {
  test('filters items by category after client boot', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    // Initially shows all 5 items
    await expect(page.locator('[data-item-count="5"]')).toBeVisible();
    await expect(page.locator('.item-entries li')).toHaveCount(5);

    // Click "framework" filter
    await page.locator('[data-category="framework"]').click();
    await expect(page.locator('[data-item-count="2"]')).toBeVisible();
    await expect(page.locator('.item-entries li')).toHaveCount(2);

    // Click "all" to reset
    await page.locator('[data-category="all"]').click();
    await expect(page.locator('[data-item-count="5"]')).toBeVisible();
    await expect(page.locator('.item-entries li')).toHaveCount(5);
  });
});

// ─── Shoebox prevents double-fetching on SSG pages ───────────────────

test.describe('SSG shoebox prevents double-fetching', () => {
  test('shoebox script tag is present in static HTML', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    const shoeboxEl = page.locator('#vite-ember-ssr-shoebox');
    await expect(shoeboxEl).toBeAttached();

    const content = await shoeboxEl.textContent();
    const entries = JSON.parse(content);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);

    const hasPokeApi = entries.some((e) => e.url.includes('pokeapi.co'));
    expect(hasPokeApi).toBe(true);
  });

  test('shoebox script tag is removed after client boot', async ({ page }) => {
    await page.goto('/pokemon-fetch');

    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    const shoeboxEl = await page.$('#vite-ember-ssr-shoebox');
    expect(shoeboxEl).toBeNull();
  });

  test('no duplicate PokeAPI requests on initial pokemon-fetch page load', async ({
    page,
  }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push({ url: request.url(), method: request.method() });
      }
    });

    await page.goto('/pokemon-fetch');

    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );

    // Pokemon content should be visible (served from shoebox)
    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();

    // No PokeAPI requests from the client — data came from shoebox
    expect(pokeApiRequests).toHaveLength(0);
  });

  test('subsequent client-side navigation still fetches normally', async ({
    page,
  }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    // Initial load — shoebox prevents API calls
    await page.goto('/pokemon-fetch');
    await page.waitForFunction(
      () => {
        return !document.getElementById('ssr-body-start');
      },
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    expect(pokeApiRequests).toHaveLength(0);

    // Navigate to a pokemon detail via client-side navigation
    // This should make a REAL fetch since the shoebox only had
    // entries for the initial page load
    await page.locator('[data-pokemon="charmander"] a').click();
    await page.waitForURL('/pokemon-fetch/charmander', { timeout: 10_000 });

    await expect(page.locator('[data-pokemon-name="charmander"]')).toBeVisible({
      timeout: 10_000,
    });

    // NOW there should be API requests (the detail fetch for charmander)
    expect(pokeApiRequests.length).toBeGreaterThan(0);
    expect(
      pokeApiRequests.some((url) => url.includes('pokemon/charmander')),
    ).toBe(true);
  });
});

// ─── Navigation links work as static file links (no JS) ─────────────

test.describe('SSG navigation works as static links without JS', () => {
  test('navigation links point to correct static file paths', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/');

    // Verify the nav links have correct hrefs that map to static files
    await expect(page.locator('nav a[href="/"]')).toBeVisible();
    await expect(page.locator('nav a[href="/about"]')).toBeVisible();
    await expect(page.locator('nav a[href="/contact"]')).toBeVisible();
    await expect(page.locator('nav a[href="/pokemon-fetch"]')).toBeVisible();
  });
});

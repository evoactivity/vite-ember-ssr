import { test, expect } from '@playwright/test';

// ─── SSR Content Visible on Load ─────────────────────────────────────

test.describe('SSR content is visible before client JS boots', () => {
  test('index route shows SSR content immediately', async ({ page }) => {
    // Block JS to see pure SSR content
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/');

    // SSR-rendered content should be visible
    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Welcome to vite-ember-ssr');
    await expect(page.locator('nav')).toBeVisible();

    // Components should be SSR-rendered
    await expect(page.locator('[data-component="counter-display"]')).toBeVisible();
    await expect(page.locator('[data-component="item-list"]')).toBeVisible();
    await expect(page.locator('[data-count="0"]')).toBeVisible();
    await expect(page.locator('[data-item-count="5"]')).toBeVisible();
  });

  test('about route shows SSR content immediately', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/about');

    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('About');
    await expect(page.locator('[data-component="counter-display"]')).toBeVisible();
  });
});

// ─── Client-Side Ember Boot ──────────────────────────────────────────

test.describe('client Ember app boots and takes over', () => {
  test('Ember boots and renders the page', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot — the ember-view class on body or
    // the disappearance of SSR boundary markers indicates Ember took over
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Content should still be present after client takeover
    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Welcome to vite-ember-ssr');
    await expect(page.locator('[data-component="counter-display"]')).toBeVisible();
    await expect(page.locator('[data-component="item-list"]')).toBeVisible();
  });

  test('SSR boundary markers are removed after client boot', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Boundary markers should be gone
    const startMarker = await page.$('#ssr-body-start');
    const endMarker = await page.$('#ssr-body-end');
    expect(startMarker).toBeNull();
    expect(endMarker).toBeNull();
  });
});

// ─── Client-Side Navigation (proves Ember router is active) ──────────

test.describe('client-side navigation via Ember router', () => {
  test('navigates between routes without full page reload', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Verify we're on index
    await expect(page.locator('[data-route="index"]')).toBeVisible();

    // Click the About link — should be a client-side transition
    const navigationPromise = page.waitForURL('/about', { timeout: 5_000 });
    await page.locator('nav a:has-text("About")').click();
    await navigationPromise;

    // Should show about content without a full reload
    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('About');

    // Index content should be gone
    await expect(page.locator('[data-route="index"]')).not.toBeAttached();

    // Navigate to contact
    await page.locator('nav a:has-text("Contact")').click();
    await page.waitForURL('/contact', { timeout: 5_000 });

    await expect(page.locator('[data-route="contact"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Contact');

    // Navigate back to home
    await page.locator('nav a:has-text("Home")').click();
    await page.waitForURL('/', { timeout: 5_000 });

    await expect(page.locator('[data-route="index"]')).toBeVisible();
  });
});

// ─── Interactive Components (proves client JS is working) ────────────

test.describe('counter component interactivity', () => {
  test('increment and decrement buttons work', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Initial state
    await expect(page.locator('[data-count="0"]')).toBeVisible();
    await expect(page.locator('[data-status="zero"]')).toBeVisible();

    // Click increment 3 times
    const incrementBtn = page.locator('[data-action="increment"]');
    await incrementBtn.click();
    await incrementBtn.click();
    await incrementBtn.click();

    // Count should be 3
    await expect(page.locator('[data-count="3"]')).toBeVisible();
    await expect(page.locator('[data-label="positive"]')).toBeVisible();
    await expect(page.locator('[data-status="positive"]')).toBeVisible();
    await expect(page.locator('.count-value')).toHaveText('3');

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
    await expect(page.locator('[data-status="zero"]')).toBeVisible();
  });

  test('counter state persists across client-side navigation', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Increment counter to 5
    const incrementBtn = page.locator('[data-action="increment"]');
    for (let i = 0; i < 5; i++) {
      await incrementBtn.click();
    }
    await expect(page.locator('[data-count="5"]')).toBeVisible();

    // Navigate to about (which also has CounterDisplay)
    await page.locator('nav a:has-text("About")').click();
    await page.waitForURL('/about', { timeout: 5_000 });

    // Counter should still show 5 (service state persists across transitions)
    await expect(page.locator('[data-count="5"]')).toBeVisible();
    await expect(page.locator('.count-value')).toHaveText('5');

    // Navigate back to index
    await page.locator('nav a:has-text("Home")').click();
    await page.waitForURL('/', { timeout: 5_000 });

    // Counter should still be 5
    await expect(page.locator('[data-count="5"]')).toBeVisible();
  });
});

// ─── ItemList filtering (proves tracked state + each work) ───────────

test.describe('item list filtering', () => {
  test('filters items by category', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Initially shows all 5 items
    await expect(page.locator('[data-item-count="5"]')).toBeVisible();
    await expect(page.locator('.item-entries li')).toHaveCount(5);

    // Click "framework" filter
    await page.locator('[data-category="framework"]').click();

    // Should show 2 items (Ember, Glimmer)
    await expect(page.locator('[data-item-count="2"]')).toBeVisible();
    await expect(page.locator('[data-filter="framework"]')).toBeVisible();
    await expect(page.locator('.item-entries li')).toHaveCount(2);
    await expect(page.locator('[data-item-category="framework"]')).toHaveCount(2);

    // Click "tooling" filter
    await page.locator('[data-category="tooling"]').click();

    // Should show 2 items (Vite, HappyDOM)
    await expect(page.locator('[data-item-count="2"]')).toBeVisible();
    await expect(page.locator('[data-filter="tooling"]')).toBeVisible();
    await expect(page.locator('.item-entries li')).toHaveCount(2);

    // Click "language" filter
    await page.locator('[data-category="language"]').click();

    // Should show 1 item (TypeScript)
    await expect(page.locator('[data-item-count="1"]')).toBeVisible();
    await expect(page.locator('.item-entries li')).toHaveCount(1);
    await expect(page.locator('.item-entries li')).toContainText('TypeScript');

    // Click "all" to reset
    await page.locator('[data-category="all"]').click();
    await expect(page.locator('[data-item-count="5"]')).toBeVisible();
    await expect(page.locator('.item-entries li')).toHaveCount(5);
  });
});

// ─── Pokemon-fetch routes with fetch (SSR + client) ─────────────────

test.describe('pokemon-fetch routes with fetched data', () => {
  test('pokemon list page shows SSR content with fetched data (no JS)', async ({ page }) => {
    // Block JS to verify pure SSR
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Pokémon (Fetch)');
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible();

    // Fetched data should be in SSR HTML
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="charmander"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="squirtle"]')).toBeVisible();
  });

  test('pokemon detail page shows SSR content with fetched data (no JS)', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch/pikachu');

    // Parent list is present
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible();

    // Detail view with fetched data
    await expect(page.locator('[data-route="pokemon-fetch.show"]')).toBeVisible();
    await expect(page.locator('[data-pokemon-name="pikachu"]')).toBeVisible();
    await expect(page.locator('h2')).toHaveText('pikachu');
    await expect(page.locator('[data-field="id"]')).toHaveText('25');
    await expect(page.locator('[data-type="electric"]')).toBeVisible();
    await expect(page.locator('[data-sprite]')).toBeVisible();
  });

  test('client-side navigation to pokemon list fetches data', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Navigate to pokemon via client-side link
    await page.locator('nav a:has-text("Pokémon")').click();
    await page.waitForURL('/pokemon-fetch', { timeout: 10_000 });

    // Fetched data should be rendered by client Ember
    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="charmander"]')).toBeVisible();
  });

  test('clicking a pokemon navigates to its detail page', async ({ page }) => {
    await page.goto('/pokemon-fetch');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Click on bulbasaur
    await page.locator('[data-pokemon="bulbasaur"] a').click();
    await page.waitForURL('/pokemon-fetch/bulbasaur', { timeout: 10_000 });

    // Detail view should show bulbasaur data
    await expect(page.locator('[data-pokemon-name="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-field="id"]')).toHaveText('1');
    await expect(page.locator('[data-type="grass"]')).toBeVisible();
    await expect(page.locator('[data-type="poison"]')).toBeVisible();
    await expect(page.locator('[data-sprite]')).toBeVisible();

    // Parent list should still be visible
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible();
  });

  test('navigating between pokemon detail pages updates content', async ({ page }) => {
    await page.goto('/pokemon-fetch/bulbasaur');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    await expect(page.locator('[data-pokemon-name="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-field="id"]')).toHaveText('1');

    // Navigate to charmander via the list
    await page.locator('[data-pokemon="charmander"] a').click();
    await page.waitForURL('/pokemon-fetch/charmander', { timeout: 10_000 });

    // Content should update to charmander
    await expect(page.locator('[data-pokemon-name="charmander"]')).toBeVisible();
    await expect(page.locator('[data-field="id"]')).toHaveText('4');
    await expect(page.locator('[data-type="fire"]')).toBeVisible();

    // Bulbasaur data should be gone
    await expect(page.locator('[data-pokemon-name="bulbasaur"]')).not.toBeAttached();
  });
});

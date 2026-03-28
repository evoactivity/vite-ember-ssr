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
    await page.locator('nav a:has-text("Pokémon (Fetch)")').click();
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

// ─── Pokemon WarpDrive SSR content (proves server returns content, not loading) ─

test.describe('pokemon-warp-drive SSR shows content, not loading state', () => {
  test('pokemon list page shows SSR content with WarpDrive data (no JS)', async ({ page }) => {
    // Block JS to verify pure SSR content
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-warp-drive');

    await expect(page.locator('[data-route="pokemon-warp-drive"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Pokémon (WarpDrive)');
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible();

    // WarpDrive-fetched data should be in the SSR HTML (not loading state)
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="charmander"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="squirtle"]')).toBeVisible();

    // Loading/error states should NOT be present
    await expect(page.locator('[data-loading]')).not.toBeAttached();
    await expect(page.locator('[data-error]')).not.toBeAttached();
  });

  test('pokemon detail page shows SSR content with WarpDrive data (no JS)', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-warp-drive/pikachu');

    // Parent list is present from SSR
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible();

    // Detail view with WarpDrive-fetched data
    await expect(page.locator('[data-route="pokemon-warp-drive.show"]')).toBeVisible();
    await expect(page.locator('[data-pokemon-name="pikachu"]')).toBeVisible();
    await expect(page.locator('h2')).toHaveText('pikachu');
    await expect(page.locator('[data-field="id"]')).toBeVisible();
    await expect(page.locator('[data-type="electric"]')).toBeVisible();
    await expect(page.locator('[data-sprite]')).toBeVisible();

    // Loading/error states should NOT be present
    await expect(page.locator('[data-loading]')).not.toBeAttached();
    await expect(page.locator('[data-error]')).not.toBeAttached();
  });

  test('different pokemon detail pages render correct SSR content (no JS)', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-warp-drive/charmander');

    await expect(page.locator('[data-pokemon-name="charmander"]')).toBeVisible();
    await expect(page.locator('[data-type="fire"]')).toBeVisible();
    await expect(page.locator('[data-field="id"]')).toBeVisible();

    // Should NOT contain pikachu data (no cross-contamination)
    await expect(page.locator('[data-pokemon-name="pikachu"]')).not.toBeAttached();

    // Loading/error states should NOT be present
    await expect(page.locator('[data-loading]')).not.toBeAttached();
  });
});

// ─── Shoebox: data transfer from server to client ───────────────────

test.describe('shoebox prevents double-fetching', () => {
  test('shoebox script tag is present in SSR HTML (no JS)', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    // Shoebox script should be in the DOM
    const shoeboxEl = page.locator('#vite-ember-ssr-shoebox');
    await expect(shoeboxEl).toBeAttached();

    // It should contain valid JSON
    const content = await shoeboxEl.textContent();
    const entries = JSON.parse(content);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);

    // Should contain a PokeAPI URL
    const hasPokeApi = entries.some((e) => e.url.includes('pokeapi.co'));
    expect(hasPokeApi).toBe(true);
  });

  test('shoebox script tag is removed after client boot', async ({ page }) => {
    await page.goto('/pokemon-fetch');

    // Wait for client Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Shoebox should be consumed and removed
    const shoeboxEl = await page.$('#vite-ember-ssr-shoebox');
    expect(shoeboxEl).toBeNull();
  });

  test('no duplicate PokeAPI requests on initial pokemon-fetch page load', async ({ page }) => {
    // Track all requests to the PokeAPI
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push({ url: request.url(), method: request.method() });
      }
    });

    await page.goto('/pokemon-fetch');

    // Wait for Ember to boot and content to be visible
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Pokemon content should be visible (served from shoebox, not re-fetched)
    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();

    // No PokeAPI requests should have been made by the client
    // (the server made them during SSR, the client reads from the shoebox)
    expect(pokeApiRequests).toHaveLength(0);
  });

  test('no duplicate PokeAPI requests on initial pokemon-fetch detail load', async ({ page }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    await page.goto('/pokemon-fetch/pikachu');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Content should be visible
    await expect(page.locator('[data-pokemon-name="pikachu"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();

    // No PokeAPI requests from the client
    expect(pokeApiRequests).toHaveLength(0);
  });

  test('no duplicate PokeAPI requests on initial WarpDrive page load', async ({ page }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    await page.goto('/pokemon-warp-drive');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Wait for WarpDrive content to render
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();

    // No PokeAPI requests from the client — shoebox served them
    expect(pokeApiRequests).toHaveLength(0);
  });

  test('subsequent client-side navigation still fetches normally', async ({ page }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    // Initial load — shoebox prevents API calls
    await page.goto('/pokemon-fetch');
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    expect(pokeApiRequests).toHaveLength(0);

    // Navigate to a different pokemon detail via client-side navigation
    // This should make a REAL fetch call since the shoebox only had
    // entries for the initial page load
    await page.locator('[data-pokemon="charmander"] a').click();
    await page.waitForURL('/pokemon-fetch/charmander', { timeout: 10_000 });

    // Wait for detail content to appear
    await expect(page.locator('[data-pokemon-name="charmander"]')).toBeVisible({ timeout: 10_000 });

    // NOW there should be API requests (the detail fetch for charmander)
    expect(pokeApiRequests.length).toBeGreaterThan(0);
    expect(pokeApiRequests.some((url) => url.includes('pokemon/charmander'))).toBe(true);
  });
});

test.describe('pokemon-warp-drive routes with WarpDrive store', () => {
  test('pokemon list loads via WarpDrive after client boot', async ({ page }) => {
    await page.goto('/pokemon-warp-drive');

    // Wait for Ember to boot and data to load
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Wait for the pokemon list to appear (WarpDrive request resolves)
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="charmander"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="squirtle"]')).toBeVisible();
  });

  test('pokemon detail loads via WarpDrive after client boot', async ({ page }) => {
    await page.goto('/pokemon-warp-drive/pikachu');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Wait for detail to appear
    await expect(page.locator('[data-route="pokemon-warp-drive.show"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-pokemon-name="pikachu"]')).toBeVisible();
    await expect(page.locator('[data-type="electric"]')).toBeVisible();
    await expect(page.locator('[data-sprite]')).toBeVisible();
    await expect(page.locator('[data-field="id"]')).toBeVisible();
  });

  test('clicking a pokemon navigates to WarpDrive detail page', async ({ page }) => {
    await page.goto('/pokemon-warp-drive');

    // Wait for Ember to boot and list to load
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible({ timeout: 10_000 });

    // Click on bulbasaur
    await page.locator('[data-pokemon="bulbasaur"] a').click();
    await page.waitForURL('/pokemon-warp-drive/bulbasaur', { timeout: 10_000 });

    // Detail view should show
    await expect(page.locator('[data-pokemon-name="bulbasaur"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-type="grass"]')).toBeVisible();
    await expect(page.locator('[data-type="poison"]')).toBeVisible();
  });

  test('client-side navigation to WarpDrive pokemon list', async ({ page }) => {
    await page.goto('/');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    // Navigate via nav link
    await page.locator('nav a:has-text("Pokémon (WarpDrive)")').click();
    await page.waitForURL('/pokemon-warp-drive', { timeout: 10_000 });

    // Data loaded via WarpDrive
    await expect(page.locator('[data-route="pokemon-warp-drive"]')).toBeVisible();
    await expect(page.locator('[data-component="pokemon-list"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
  });

  test('navigating between WarpDrive pokemon detail pages updates content', async ({ page }) => {
    await page.goto('/pokemon-warp-drive/bulbasaur');

    // Wait for Ember to boot
    await page.waitForFunction(() => {
      return !document.getElementById('ssr-body-start');
    }, { timeout: 15_000 });

    await expect(page.locator('[data-pokemon-name="bulbasaur"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-field="id"]')).toHaveText('bulbasaur');

    // Navigate to charmander via the list
    await page.locator('[data-pokemon="charmander"] a').click();
    await page.waitForURL('/pokemon-warp-drive/charmander', { timeout: 10_000 });

    // Content should update to charmander
    await expect(page.locator('[data-pokemon-name="charmander"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-field="id"]')).toHaveText('charmander');
    await expect(page.locator('[data-type="fire"]')).toBeVisible();

    // Bulbasaur data should be gone
    await expect(page.locator('[data-pokemon-name="bulbasaur"]')).not.toBeAttached();
  });
});

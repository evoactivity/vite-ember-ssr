import { test, expect } from '@playwright/test';

// ─── SSR content visible without JS ──────────────────────────────────

test.describe('SSR HTML is fully rendered without client JS', () => {
  test('shows SSR-rendered content immediately when JS is blocked', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/');

    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Welcome to vite-ember-ssr');
    await expect(
      page.locator('[data-component="counter-display"]'),
    ).toBeVisible();
    await expect(page.locator('[data-component="item-list"]')).toBeVisible();
  });
});

// ─── Client rehydration ──────────────────────────────────────────────

test.describe('Client Ember rehydrates and becomes interactive', () => {
  test('Ember boots, the counter is interactive after boot', async ({
    page,
  }) => {
    await page.goto('/');

    // body.ember-application is added when Ember finishes booting
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    // Content was rehydrated, not re-rendered
    await expect(page.locator('[data-route="index"]')).toBeVisible();

    // Interactivity proves Glimmer attached to the SSR DOM successfully
    await page.locator('[data-action="increment"]').click();
    await expect(page.locator('[data-count="1"]')).toBeVisible();
  });

  test('no SSR boundary markers in the DOM', async ({ page }) => {
    // The server never emits boundary markers. Extra DOM nodes would
    // break Glimmer's RehydrateTree which expects the first child to
    // be <!--%+b:0%-->.
    await page.goto('/');

    expect(await page.$('#ssr-body-start')).toBeNull();
    expect(await page.$('#ssr-body-end')).toBeNull();
  });
});

// ─── Client-side navigation ──────────────────────────────────────────

test.describe('Client-side routing after rehydration', () => {
  test('navigates between routes without a full page reload', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    await page.locator('nav a:has-text("About")').click();
    await page.waitForURL('/about', { timeout: 5_000 });

    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('[data-route="index"]')).not.toBeAttached();

    // Navigate back proves bidirectional routing works
    await page.locator('nav a:has-text("Home")').click();
    await page.waitForURL('/', { timeout: 5_000 });
    await expect(page.locator('[data-route="index"]')).toBeVisible();
  });
});

// ─── Pokemon-fetch SSR with fetched data, no JS ──────────────────────

test.describe('SSR with fetched data is fully present without JS', () => {
  test('list page contains fetched pokemon names without JS', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="charmander"]')).toBeVisible();
  });

  test('detail page contains fetched pokemon stats without JS', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch/pikachu');

    await expect(page.locator('[data-pokemon-name="pikachu"]')).toBeVisible();
    await expect(page.locator('[data-type="electric"]')).toBeVisible();
    await expect(page.locator('[data-sprite]')).toBeVisible();
  });

  test('WarpDrive list page is rendered without JS (no loading state)', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-warp-drive');

    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-loading]')).not.toBeAttached();
  });
});

// ─── Shoebox: client-side fetch replay ───────────────────────────────

test.describe('Shoebox prevents duplicate fetches on first client load', () => {
  test('shoebox script tag is present in SSR HTML', async ({ page }) => {
    // Block JS so installShoebox() does not consume the tag before we read it
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    await expect(page.locator('#vite-ember-ssr-shoebox')).toBeAttached();
  });

  test('shoebox script tag is removed after client boot', async ({ page }) => {
    await page.goto('/pokemon-fetch');

    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => !document.getElementById('vite-ember-ssr-shoebox'),
      { timeout: 5_000 },
    );
  });

  test('shoebox interceptor is transparent to native-fetch detection', async ({
    page,
  }) => {
    // Libraries sniff fetch.toString() to detect mock environments (e.g.
    // warp-drive's dev builds, which then treat response headers as mutable
    // and crash on real immutable ones). The interceptor installs and
    // uninstalls itself quickly, so trap every assignment to globalThis.fetch
    // and assert each assigned function still reports the native source.
    await page.addInitScript(() => {
      const assigned = [];
      let current = globalThis.fetch;
      window.__nativeFetchSource = current.toString();
      window.__assignedFetches = assigned;
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        get: () => current,
        set: (value) => {
          assigned.push(value);
          current = value;
        },
      });
    });

    await page.goto('/pokemon-fetch');
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );
    // Shoebox fully consumed → interceptor was installed and restored
    await page.waitForFunction(
      () => !document.getElementById('vite-ember-ssr-shoebox'),
      { timeout: 5_000 },
    );

    const { nativeSource, sources } = await page.evaluate(() => ({
      nativeSource: window.__nativeFetchSource,
      sources: window.__assignedFetches.map((fn) => fn.toString()),
    }));

    // installShoebox() assigned the interceptor, cleanupShoebox() restored
    // the original — both must be indistinguishable from native fetch.
    expect(sources.length).toBeGreaterThanOrEqual(2);
    for (const source of sources) {
      expect(source).toBe(nativeSource);
    }
  });

  test('no PokeAPI requests on initial pokemon-fetch load (data served from shoebox)', async ({
    page,
  }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    await page.goto('/pokemon-fetch');
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    expect(pokeApiRequests).toHaveLength(0);
  });

  test('no PokeAPI requests on initial WarpDrive load', async ({ page }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    await page.goto('/pokemon-warp-drive');
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible({
      timeout: 10_000,
    });
    expect(pokeApiRequests).toHaveLength(0);
  });

  test('subsequent client-side navigation fetches normally (shoebox is one-shot)', async ({
    page,
  }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    await page.goto('/pokemon-fetch');
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    expect(pokeApiRequests).toHaveLength(0);

    // Navigate to a detail page the shoebox does not have
    await page.locator('[data-pokemon="charmander"] a').click();
    await page.waitForURL('/pokemon-fetch/charmander', { timeout: 10_000 });
    await expect(page.locator('[data-pokemon-name="charmander"]')).toBeVisible({
      timeout: 10_000,
    });

    // Now a real fetch happens
    expect(
      pokeApiRequests.some((url) => url.includes('pokemon/charmander')),
    ).toBe(true);
  });
});

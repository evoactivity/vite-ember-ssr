/**
 * Client-side utilities for vite-ember-ssr.
 *
 * The library always renders pages with Glimmer rehydration markers, so
 * the client boots with `_renderMode: 'rehydrate'` and Glimmer attaches
 * to the existing DOM instead of replacing it. The {@link bootRehydrated}
 * helper takes care of choosing rehydrate vs. a normal boot, since some
 * pages (e.g. dev mode without SSR, or non-prerendered SSG routes) will
 * not carry the rehydrate flag.
 */

// ─── Shoebox Types ───────────────────────────────────────────────────

/**
 * A captured fetch response transferred from the server.
 * Must match the ShoeboxEntry interface in server.ts.
 */
interface ShoeboxEntry {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

const SHOEBOX_SCRIPT_ID = 'vite-ember-ssr-shoebox';

// ─── Shoebox: Client-Side Fetch Replay ───────────────────────────────

/** Original fetch function, saved before monkey-patching */
let _originalFetch: typeof fetch | null = null;

/** Map of URL → { entry, refCount } for reference-counted consumption */
let _shoeboxMap: Map<string, { entry: ShoeboxEntry; refCount: number }> | null =
  null;

/**
 * Installs the shoebox fetch interceptor on the client.
 *
 * Reads the shoebox data from the server-injected <script> tag,
 * removes the tag from the DOM, and monkey-patches globalThis.fetch
 * to serve cached responses for URLs that match shoebox entries.
 *
 * Each entry is reference-counted: concurrent fetch calls to the same
 * URL all receive the shoebox response. The entry is removed only when
 * the last concurrent consumer has been served.
 *
 * Call this BEFORE creating the Ember application, typically as the
 * first thing in your client entry point.
 *
 * @returns true if shoebox data was found and installed, false otherwise
 */
export function installShoebox(): boolean {
  const scriptEl = document.getElementById(SHOEBOX_SCRIPT_ID);
  if (!scriptEl) {
    return false;
  }

  // Parse the shoebox data
  let entries: ShoeboxEntry[];
  try {
    entries = JSON.parse(scriptEl.textContent ?? '[]');
  } catch {
    // Malformed shoebox data — skip
    scriptEl.remove();
    return false;
  }

  // Remove the script tag from the DOM
  scriptEl.remove();

  if (entries.length === 0) {
    return false;
  }

  // Build the lookup map with ref counts
  _shoeboxMap = new Map();
  for (const entry of entries) {
    _shoeboxMap.set(entry.url, { entry, refCount: 1 });
  }

  // Save the original fetch and install our interceptor
  _originalFetch = globalThis.fetch;

  globalThis.fetch = function shoeboxFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Only intercept GET requests (or requests with no method, which default to GET)
    const method = init?.method?.toUpperCase() ?? 'GET';
    if (method !== 'GET' || !_shoeboxMap || _shoeboxMap.size === 0) {
      return _originalFetch!(input, init);
    }

    // Resolve the URL string for matching
    let url: string;
    try {
      if (typeof input === 'string') {
        url = new URL(input, globalThis.location?.href).href;
      } else if (input instanceof URL) {
        url = input.href;
      } else if (input instanceof Request) {
        url = input.url;
      } else {
        return _originalFetch!(input, init);
      }
    } catch {
      return _originalFetch!(input, init);
    }

    const cached = _shoeboxMap.get(url);
    if (!cached) {
      return _originalFetch!(input, init);
    }

    // Decrement ref count and remove if exhausted
    cached.refCount--;
    if (cached.refCount <= 0) {
      _shoeboxMap.delete(url);
    }

    // Construct a Response from the cached data
    const { entry } = cached;
    const response = new Response(entry.body, {
      status: entry.status,
      statusText: entry.statusText,
      headers: new Headers(entry.headers),
    });

    // Auto-cleanup when the map is empty
    if (_shoeboxMap.size === 0) {
      cleanupShoebox();
    }

    return Promise.resolve(response);
  };

  // Advertise the original fetch's source so the wrapper is transparent to
  // native-fetch detection. Some libraries sniff `fetch.toString()` to decide
  // whether a mock environment is active and change behavior on it — e.g.
  // warp-drive's dev builds assume mutable (Mirage-style) response headers and
  // crash on real responses ("Headers are immutable") while the shoebox
  // interceptor is installed. The wrapper delegates to the original fetch for
  // everything it doesn't serve, so reporting its source is accurate enough.
  const originalSource = _originalFetch.toString();
  globalThis.fetch.toString = () => originalSource;

  return true;
}

/**
 * Restores the original fetch function and cleans up shoebox state.
 *
 * Called automatically when all shoebox entries have been consumed,
 * or can be called manually to force cleanup.
 */
export function cleanupShoebox(): void {
  if (_originalFetch) {
    globalThis.fetch = _originalFetch;
    _originalFetch = null;
  }
  _shoeboxMap = null;
}

// ─── Boot ─────────────────────────────────────────────────────────────

/**
 * Returns `true` when the current page was rendered with rehydration
 * markers by the server (or the SSG build), i.e. when the server set
 * `window.__vite_ember_ssr_rehydrate__`.
 *
 * Use this when you need to branch on rehydrate vs. plain boot yourself.
 * In most cases, prefer {@link bootRehydrated}.
 *
 * Returns `false` for pages that were not rendered by the server, e.g.
 * a dev page hit without an SSR middleware, or an SSG app navigating to
 * a non-prerendered route.
 */
export function shouldRehydrate(): boolean {
  return (
    (window as unknown as Record<string, unknown>)
      .__vite_ember_ssr_rehydrate__ === true
  );
}

/**
 * Minimal interface satisfied by an Ember Application class.
 */
interface ApplicationClass {
  create(options: Record<string, unknown>): {
    visit?(
      url: string,
      options: Record<string, unknown>,
    ): Promise<unknown> | unknown;
  };
}

/**
 * Boots the client Ember application, rehydrating the server-rendered
 * DOM when one is present.
 *
 * Behaviour:
 * - If {@link shouldRehydrate} returns `true`, creates the application
 *   with `autoboot: false` and calls `app.visit(url, { _renderMode: 'rehydrate' })`
 *   so Glimmer attaches to the existing DOM instead of replacing it.
 * - Otherwise, calls `Application.create(config.APP)` for a normal boot.
 *
 * The visit URL is derived from `window.location.pathname + search`
 * with the configured `rootURL` stripped, matching what `Application.create`
 * would have used internally.
 *
 * @example
 * ```ts
 * import Application from './app.ts';
 * import config from './config/environment.ts';
 * import { bootRehydrated, installShoebox } from 'vite-ember-ssr/client';
 *
 * installShoebox();
 * bootRehydrated(Application, config);
 * ```
 */
export function bootRehydrated(
  Application: ApplicationClass,
  config: { APP?: Record<string, unknown>; rootURL?: string },
): void {
  if (!shouldRehydrate()) {
    Application.create(config.APP ?? {});
    return;
  }

  const app = Application.create({
    ...(config.APP ?? {}),
    autoboot: false,
  });

  const rootURL = config.rootURL ?? '/';
  const url = (window.location.pathname + window.location.search).replace(
    rootURL,
    '/',
  );

  void app.visit?.(url, { _renderMode: 'rehydrate' });
}

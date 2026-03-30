/**
 * Client-side utilities for vite-ember-ssr.
 *
 * Currently the client Ember app boots normally and replaces the
 * SSR-rendered content. True DOM hydration is planned for a future
 * phase.
 *
 * For now, the SSR content provides the initial visual while client
 * JavaScript loads, parses, and Ember boots.
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

// ─── SSR Content Cleanup ─────────────────────────────────────────────

/**
 * Removes the SSR-rendered content from the DOM so the client Ember
 * app can render into a clean `<body>`. This prevents the "double
 * render" where both server-rendered HTML and client-rendered HTML
 * are visible simultaneously.
 *
 * Removes everything between (and including) the SSR boundary markers:
 *   <script type="x/boundary" id="ssr-body-start">
 *   ...server rendered content...
 *   <script type="x/boundary" id="ssr-body-end">
 *
 * **Call this from your application template** rather than from
 * `entry.ts` — this ensures removal happens at the moment Ember
 * renders, avoiding a flash of no content:
 *
 * ```gts
 * import { cleanupSSRContent } from 'vite-ember-ssr/client';
 *
 * <template>
 *   {{cleanupSSRContent}}
 *   {{outlet}}
 * </template>
 * ```
 *
 * Only used in cleanup mode (default). Not needed when using
 * `rehydrate: true` — in that mode Glimmer reuses the existing DOM.
 */
export function cleanupSSRContent(): void {
  const start = document.getElementById('ssr-body-start');
  const end = document.getElementById('ssr-body-end');

  if (!start || !end) {
    return; // Not an SSR-rendered page
  }

  // Remove all nodes between start and end markers (inclusive)
  const parent = start.parentNode;
  if (!parent) return;

  let node: ChildNode | null = start;
  while (node) {
    const next: ChildNode | null = node.nextSibling;
    parent.removeChild(node);
    if (node === end) break;
    node = next;
  }
}

/**
 * Checks if the current page was server-side rendered by looking
 * for SSR boundary markers in the DOM.
 */
export function isSSRRendered(): boolean {
  return document.getElementById('ssr-body-start') !== null;
}

/**
 * Checks whether the current page was rendered with rehydration mode.
 *
 * Returns `true` when the server (or SSG build) injected the
 * `window.__vite_ember_ssr_rehydrate__` flag. Use this in your client
 * entry point to decide whether to boot Ember in rehydrate mode or
 * with a normal boot:
 *
 * ```ts
 * import { shouldRehydrate, installShoebox } from 'vite-ember-ssr/client';
 *
 * installShoebox();
 *
 * const app = Application.create({ ...config.APP, autoboot: false });
 *
 * app.visit(window.location.pathname + window.location.search, {
 *   ...(shouldRehydrate() ? { _renderMode: 'rehydrate' } : {}),
 * });
 * ```
 *
 * This is especially important for SSG apps where only prerendered
 * routes carry the flag — non-SSG routes will boot normally without
 * attempting rehydration (which would fail with no serialized DOM).
 */
export function shouldRehydrate(): boolean {
  return (
    (window as unknown as Record<string, unknown>)
      .__vite_ember_ssr_rehydrate__ === true
  );
}

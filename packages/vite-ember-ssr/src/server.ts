import { Window } from 'happy-dom';
import type { CssManifest } from './vite-plugin.js';

const SSR_HEAD_MARKER = '<!-- VITE_EMBER_SSR_HEAD -->';
const SSR_BODY_MARKER = '<!-- VITE_EMBER_SSR_BODY -->';
const SSR_MARKER_REGEX = /<!-- VITE_EMBER_SSR_(HEAD|BODY) -->/g;

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Minimal interface for an Ember Application that supports SSR.
 *
 * The app must be created with `autoboot: false` so the server can
 * control boot timing via `app.visit(url, options)`.
 *
 * `visit()` handles the full boot sequence internally:
 *   app.boot() → app.buildInstance() → instance.boot(options) → instance.visit(url)
 * and returns a Promise<ApplicationInstance>.
 */
export interface EmberApplication {
  visit(url: string, options?: BootOptions): Promise<EmberApplicationInstance>;
  destroy(): void;
}

export interface EmberApplicationInstance {
  destroy(): void;
  getURL?(): string;
  _booted?: boolean;
  /**
   * Look up a registered object (service, etc.) on the instance.
   * Used internally to access the router service for CSS injection.
   */
  lookup?(fullName: string): unknown;
}

export interface BootOptions {
  /** When false, disables browser-specific features like event delegation. */
  isBrowser: boolean;
  /** The document to render into. For SSR, this is the HappyDOM document. */
  document: Document;
  /** The root DOM element for the Ember app. Typically document.body. */
  rootElement: Element;
  /** Whether Ember should render templates. Set to true for SSR. */
  shouldRender: boolean;
  /** Override the router's location type. */
  location?: string;
  /** Optional render mode hint for Ember's rendering engine. */
  _renderMode?: 'serialize' | 'rehydrate' | undefined;
}

export interface RenderOptions {
  /** The URL path to render, e.g., '/' or '/about' */
  url: string;

  /**
   * Async factory that creates a fresh Ember Application instance.
   *
   * Called inside `withBrowserGlobals` — browser globals like `window`,
   * `document`, etc. are available when this function runs. This makes
   * it safe to lazily `import()` SSR bundles that reference `window` at
   * module scope (e.g., apps using `@embroider/router` lazy routes).
   *
   * @example
   * ```js
   * createApp: async () => {
   *   const { createSsrApp } = await import('./dist/server/app-ssr.mjs');
   *   return createSsrApp();
   * }
   * ```
   */
  createApp: () => Promise<EmberApplication>;

  /**
   * When true, intercepts all fetch() calls during SSR rendering and
   * serializes the responses into a <script> tag in the HTML output.
   * The client can then replay these responses to avoid double-fetching.
   */
  shoebox?: boolean;

  /**
   * Enable Glimmer VM rehydration mode.
   *
   * When true, the server renders with `_renderMode: 'serialize'`,
   * which annotates the rendered DOM with markers that Glimmer can
   * use to reuse the existing HTML instead of replacing it.
   *
   * The client must boot with `autoboot: false` and call
   * `app.visit(url, { _renderMode: 'rehydrate' })` to complete
   * the rehydration.
   *
   * When false (default), no render mode is set and the client
   * is expected to call `cleanupSSRContent()` before booting.
   *
   * @default false
   */
  rehydrate?: boolean;

  /**
   * CSS manifest mapping route names to their associated CSS asset paths.
   *
   * Generated automatically by the `emberSsr()` Vite plugin during the
   * client build (written as `css-manifest.json`). When provided, the
   * renderer injects `<link rel="stylesheet">` tags into the `<head>`
   * for CSS files associated with the active route.
   *
   * This solves the problem where Vite's SSR build strips CSS imports
   * from lazy-loaded route bundles, causing missing styles in the
   * initial HTML response.
   *
   * @example
   * ```js
   * const manifest = JSON.parse(
   *   await readFile('dist/client/css-manifest.json', 'utf-8')
   * );
   * const result = await render({
   *   url: '/about',
   *   template,
   *   createApp,
   *   cssManifest: manifest,
   * });
   * ```
   */
  cssManifest?: CssManifest;
}

export interface RenderResult {
  /** Rendered HTML from the document's <head> */
  head: string;
  /** Rendered HTML from the document's <body>. In cleanup mode, wrapped in boundary markers. In rehydrate mode, unwrapped. */
  body: string;
  /** HTTP status code (200 by default) */
  statusCode: number;
  /** Any error that occurred during rendering */
  error?: Error;
}

// ─── Shoebox Types ───────────────────────────────────────────────────

/**
 * A captured fetch response for transfer from server to client.
 */
export interface ShoeboxEntry {
  /** The request URL */
  url: string;
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Response headers (serializable subset) */
  headers: Record<string, string>;
  /** Response body as text */
  body: string;
}

// ─── HappyDOM Environment ────────────────────────────────────────────

/**
 * Creates an isolated HappyDOM Window for a single SSR request.
 * Each request gets its own Window to prevent state leakage.
 */
function createSSRWindow(url: string): Window {
  return new Window({
    url: `http://localhost${url}`,
    width: 1024,
    height: 768,
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      navigator: {
        userAgent: 'vite-ember-ssr',
      },
    },
  });
}

/**
 * Browser global names that Ember (and its dependencies) reference
 * during rendering. We temporarily copy these from the per-request
 * HappyDOM Window onto globalThis for the duration of the render,
 * then restore the originals.
 */
const BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'self',
  'localStorage',
  'sessionStorage',
  'InputEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'PointerEvent',
  'IntersectionObserver',
  'ResizeObserver',
  'CSSStyleSheet',
] as const;

/**
 * Temporarily installs HappyDOM's browser globals onto globalThis
 * for the duration of a callback. Restores the originals afterward.
 *
 * Also handles sticky embroider bundle registrations: apps using
 * `@embroider/router` lazy routes assign `window._embroiderRouteBundles_`
 * at module import time. Since ES module `import()` caches by URL,
 * module-level side effects only run once — on the first render's
 * window. Subsequent renders create a new HappyDOM window that lacks
 * those registrations.
 *
 * To solve this, we capture `_embroiderRouteBundles_` and
 * `_embroiderEngineBundles_` from the window after the callback
 * completes, and re-apply them to every subsequent window before
 * the callback runs.
 */

// Sticky storage for embroider bundle registrations across renders.
const EMBROIDER_BUNDLE_KEYS = [
  '_embroiderRouteBundles_',
  '_embroiderEngineBundles_',
] as const;

type EmbroiderBundleKey = (typeof EMBROIDER_BUNDLE_KEYS)[number];

const stickyBundles = new Map<EmbroiderBundleKey, unknown>();

async function withBrowserGlobals<T>(
  window: Window,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, PropertyDescriptor | undefined>();

  // Install globals
  for (const name of BROWSER_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = window[name];
    try {
      Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      // Some globals may not be overridable
    }
  }

  // Re-apply any previously captured embroider bundles to this window
  // so the 2nd+ render sees the same bundle registrations.
  for (const key of EMBROIDER_BUNDLE_KEYS) {
    if (stickyBundles.has(key)) {
      (window as unknown as Record<string, unknown>)[key] =
        stickyBundles.get(key);
    }
  }

  try {
    return await fn();
  } finally {
    // Capture any embroider bundles that were registered during this
    // render so they survive across HappyDOM windows.
    for (const key of EMBROIDER_BUNDLE_KEYS) {
      const value = (window as unknown as Record<string, unknown>)[key];
      if (value !== undefined) {
        stickyBundles.set(key, value);
      }
    }

    // Restore originals
    for (const name of BROWSER_GLOBALS) {
      const desc = saved.get(name);
      if (desc) {
        try {
          Object.defineProperty(globalThis, name, desc);
        } catch {
          // ignore
        }
      } else {
        try {
          delete (globalThis as Record<string, unknown>)[name];
        } catch {
          // ignore
        }
      }
    }
  }
}

// ─── Shoebox: Fetch Interception ─────────────────────────────────────

const SHOEBOX_SCRIPT_ID = 'vite-ember-ssr-shoebox';

/**
 * Creates a fetch interceptor that captures responses during SSR.
 *
 * Wraps globalThis.fetch to record URL → response mappings for GET
 * requests. The original response is returned to the caller untouched;
 * a cloned copy is read for the shoebox.
 *
 * Only GET requests are captured — POST/PUT/DELETE should not be
 * replayed on the client.
 */
function createFetchInterceptor() {
  const entries = new Map<string, ShoeboxEntry>();
  const originalFetch = globalThis.fetch;

  const interceptedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const method = request.method.toUpperCase();

    // Only intercept GET requests
    if (method !== 'GET') {
      return originalFetch(input, init);
    }

    const response = await originalFetch(input, init);
    const url = request.url;

    // Clone the response so we can read the body without consuming it
    // for the caller
    try {
      const clone = response.clone();
      const body = await clone.text();

      const headers: Record<string, string> = {};
      clone.headers.forEach((value, key) => {
        headers[key] = value;
      });

      entries.set(url, {
        url,
        status: clone.status,
        statusText: clone.statusText,
        headers,
        body,
      });
    } catch {
      // If cloning fails (e.g., body already consumed), skip capture.
      // The SSR render still works; the client just won't get this
      // entry in the shoebox.
    }

    return response;
  };

  return {
    /** Install the interceptor onto globalThis.fetch */
    install() {
      globalThis.fetch = interceptedFetch;
    },
    /** Restore the original globalThis.fetch */
    restore() {
      globalThis.fetch = originalFetch;
    },
    /** Get all captured entries */
    getEntries(): ShoeboxEntry[] {
      return Array.from(entries.values());
    },
  };
}

/**
 * Serializes shoebox entries into a <script> tag for embedding in HTML.
 * Returns an empty string if there are no entries.
 */
function serializeShoebox(entries: ShoeboxEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const json = JSON.stringify(entries);
  // Escape </script> in JSON to prevent premature tag closure
  const safeJson = json.replace(/<\/(script)/gi, '<\\/$1');

  return `<script type="application/json" id="${SHOEBOX_SCRIPT_ID}">${safeJson}</script>`;
}

// ─── CSS Manifest: Route-Aware Lazy CSS Injection ───────────────────

/**
 * Extracts the current route name from an Ember ApplicationInstance
 * by looking up the router service.
 *
 * Returns the dot-separated route name (e.g., 'about', 'blog.post')
 * or undefined if the router service is not available.
 */
function getActiveRouteName(
  instance: EmberApplicationInstance,
): string | undefined {
  if (!instance.lookup) return undefined;

  try {
    const router = instance.lookup('service:router') as
      | { currentRouteName?: string }
      | undefined;
    return router?.currentRouteName ?? undefined;
  } catch {
    // Router service may not be available in all configurations
    return undefined;
  }
}

/**
 * Collects all route names in the hierarchy for a given leaf route.
 *
 * Ember route names use dot notation for nesting:
 * - 'about' → ['about']
 * - 'blog.post' → ['blog', 'blog.post']
 * - 'admin.users.edit' → ['admin', 'admin.users', 'admin.users.edit']
 *
 * This ensures that CSS from parent routes is also included when
 * rendering a nested child route.
 */
function expandRouteHierarchy(routeName: string): string[] {
  const segments = routeName.split('.');
  const routes: string[] = [];
  for (let i = 1; i <= segments.length; i++) {
    routes.push(segments.slice(0, i).join('.'));
  }
  return routes;
}

/**
 * Builds `<link rel="stylesheet">` tags for CSS files associated with
 * the active route and its parent routes.
 *
 * Uses the CSS manifest (generated at build time by the `emberSsr()`
 * Vite plugin) to map route names to their CSS asset paths.
 *
 * Returns an empty string if no manifest is provided, the route name
 * cannot be determined, or no CSS files are mapped to the active route.
 */
function buildRouteCssLinks(
  manifest: CssManifest | undefined,
  instance: EmberApplicationInstance | undefined,
): string {
  if (!manifest || !instance) return '';

  const routeName = getActiveRouteName(instance);
  if (!routeName) return '';

  // Collect CSS files for the active route and all its parents
  const routes = expandRouteHierarchy(routeName);
  const seen = new Set<string>();
  const links: string[] = [];

  for (const route of routes) {
    const cssFiles = manifest[route];
    if (!cssFiles) continue;

    for (const href of cssFiles) {
      if (seen.has(href)) continue;
      seen.add(href);
      links.push(`<link rel="stylesheet" href="${href}">`);
    }
  }

  return links.join('');
}

// ─── Core Rendering ──────────────────────────────────────────────────

/**
 * Renders an Ember application at the given URL using HappyDOM.
 *
 * This is the main SSR entry point. It:
 * 1. Creates an isolated HappyDOM Window
 * 2. Temporarily installs browser globals from HappyDOM
 * 3. Creates the Ember app and calls visit()
 * 4. Extracts the rendered HTML
 * 5. Cleans up all resources
 *
 * Each call creates a completely fresh environment — there is no
 * shared state between requests.
 */
export async function renderEmberApp(
  options: RenderOptions,
): Promise<RenderResult> {
  const {
    url,
    createApp,
    shoebox = false,
    rehydrate = false,
    cssManifest,
  } = options;

  const window = createSSRWindow(url);
  const document = window.document;

  let app: EmberApplication | undefined;
  let instance: EmberApplicationInstance | undefined;
  let error: Error | undefined;
  let shoeboxEntries: ShoeboxEntry[] = [];
  let cssLinks = '';

  // Set up the fetch interceptor before rendering (if shoebox is enabled)
  const interceptor = shoebox ? createFetchInterceptor() : null;

  try {
    await withBrowserGlobals(window, async () => {
      // Install the fetch interceptor inside withBrowserGlobals so it
      // captures fetches made during the Ember render lifecycle
      interceptor?.install();

      try {
        // Create a fresh Ember application (autoboot must be false)
        app = await createApp();

        // Application#visit() handles the full boot sequence:
        //   app.boot() → app.buildInstance() → instance.boot(options) → instance.visit(url)
        const bootOptions: BootOptions = {
          isBrowser: false,
          document: document as unknown as Document,
          rootElement: document.body as unknown as Element,
          shouldRender: true,
          ...(rehydrate ? { _renderMode: 'serialize' as const } : {}),
        };

        instance = await app.visit(url, bootOptions);

        // After visit() completes, the router has resolved the URL to
        // a route name. Query it to determine which CSS files to inject.
        // This must happen inside withBrowserGlobals while the instance
        // is still alive and the router service is accessible.
        if (cssManifest) {
          cssLinks = buildRouteCssLinks(cssManifest, instance);
        }
      } finally {
        // Always restore original fetch, even if rendering fails
        interceptor?.restore();
      }
    });
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  // Collect shoebox entries after render completes
  if (interceptor) {
    shoeboxEntries = interceptor.getEntries();
  }

  // Extract rendered HTML before cleanup
  const head = document.head?.innerHTML ?? '';
  const body = document.body?.innerHTML ?? '';

  // Build the shoebox script tag (empty string if no entries)
  const shoeboxHTML = serializeShoebox(shoeboxEntries);

  // When rehydrate mode is active, inject a flag the client can read
  // to decide whether to boot with `_renderMode: 'rehydrate'`.
  // This is critical for SSG: only prerendered pages carry the flag,
  // so the client can fall back to a normal boot on non-SSG routes.
  const rehydrateHTML = rehydrate
    ? '<script>window.__vite_ember_ssr_rehydrate__=true</script>'
    : '';

  // Prepend CSS links, rehydrate flag, and shoebox to head content.
  // CSS links come first so stylesheets begin loading immediately.
  const fullHead = cssLinks + rehydrateHTML + shoeboxHTML + head;

  // In cleanup mode (default), wrap body in boundary markers so the
  // client's cleanupSSRContent() can identify and remove SSR content
  // before Ember boots.
  //
  // In rehydrate mode, skip the boundary markers — they would break
  // Glimmer's RehydrateTree which expects the first child of rootElement
  // to be Ember's serialization comment (<!--%+b:0%-->).
  const wrappedBody = rehydrate
    ? body
    : [
        '<script type="x/boundary" id="ssr-body-start"></script>',
        body,
        '<script type="x/boundary" id="ssr-body-end"></script>',
      ].join('');

  // Cleanup: destroy in reverse order
  try {
    instance?.destroy();
  } catch {
    // Instance may already be destroyed if an error occurred during visit
  }

  try {
    app?.destroy();
  } catch {
    // Application may already be destroyed
  }

  // Close HappyDOM window to free resources
  await window.happyDOM.close();

  return {
    head: fullHead,
    body: wrappedBody,
    statusCode: error ? 500 : 200,
    error,
  };
}

// ─── HTML Assembly ───────────────────────────────────────────────────

/**
 * Assembles the final HTML response by inserting rendered content
 * into the index.html template.
 *
 * Replaces:
 * - `<!-- VITE_EMBER_SSR_HEAD -->` with the rendered head content
 * - `<!-- VITE_EMBER_SSR_BODY -->` with the rendered body content
 */
export function assembleHTML(
  template: string,
  rendered: Pick<RenderResult, 'head' | 'body'>,
): string {
  let headReplaced = false;
  let bodyReplaced = false;

  return template.replace(SSR_MARKER_REGEX, (_match, tag: string) => {
    if (tag === 'HEAD' && !headReplaced) {
      headReplaced = true;
      return rendered.head;
    }
    if (tag === 'BODY' && !bodyReplaced) {
      bodyReplaced = true;
      return rendered.body;
    }
    return '';
  });
}

/**
 * Checks whether an HTML template contains the required SSR markers.
 */
export function hasSSRMarkers(html: string): { head: boolean; body: boolean } {
  return {
    head: html.includes(SSR_HEAD_MARKER),
    body: html.includes(SSR_BODY_MARKER),
  };
}

// ─── Convenience: Render + Assemble ──────────────────────────────────

export interface SSRResult {
  /** Final HTML string with SSR content injected */
  html: string;
  /** HTTP status code (200 by default) */
  statusCode: number;
  /** Any error that occurred during rendering */
  error?: Error;
}

/**
 * Renders an Ember app at the given URL and assembles the final HTML
 * in a single call. Combines `renderEmberApp` and `assembleHTML`.
 *
 * @example
 * ```js
 * const { html, statusCode, error } = await render({
 *   url: '/about',
 *   template,
 *   createApp: async () => {
 *     const { createSsrApp } = await import('./dist/server/app-ssr.mjs');
 *     return createSsrApp();
 *   },
 *   shoebox: true,
 * });
 * reply.code(statusCode).type('text/html').send(html);
 * ```
 */
export async function render(
  options: RenderOptions & { template: string },
): Promise<SSRResult> {
  const { template, ...renderOptions } = options;
  const result = await renderEmberApp(renderOptions);
  const html = assembleHTML(template, result);

  return {
    html,
    statusCode: result.statusCode,
    error: result.error,
  };
}

// ─── CSS Manifest Loading ────────────────────────────────────────────

// Re-export for convenience so consumers don't need a separate import
// from 'vite-ember-ssr/vite-plugin' just for these constants.
export type { CssManifest } from './vite-plugin.js';
export { CSS_MANIFEST_FILENAME } from './vite-plugin.js';

/**
 * Loads the CSS manifest from the client build output directory.
 *
 * The CSS manifest is generated by the `emberSsr()` Vite plugin during
 * the client build. It maps Ember route names to their CSS asset paths.
 *
 * Returns `undefined` if the manifest file doesn't exist (i.e., the app
 * has no lazy-loaded CSS assets).
 *
 * @example
 * ```js
 * import { loadCssManifest, render } from 'vite-ember-ssr/server';
 *
 * const cssManifest = await loadCssManifest('dist/client');
 *
 * app.get('*', async (req, reply) => {
 *   const { html, statusCode } = await render({
 *     url: req.url,
 *     template,
 *     createApp,
 *     cssManifest,
 *   });
 *   reply.code(statusCode).type('text/html').send(html);
 * });
 * ```
 */
export async function loadCssManifest(
  clientDir: string,
): Promise<CssManifest | undefined> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { CSS_MANIFEST_FILENAME: filename } = await import('./vite-plugin.js');

  try {
    const raw = await readFile(join(clientDir, filename), 'utf-8');
    return JSON.parse(raw) as CssManifest;
  } catch {
    // No manifest file — app has no lazy-loaded CSS
    return undefined;
  }
}

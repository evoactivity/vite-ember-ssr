/**
 * Long-lived tinypool worker for SSR rendering.
 *
 * The SSR bundle is imported and createSsrApp() is called eagerly at worker
 * startup via top-level await, using the bundle path supplied through
 * tinypool's workerData. This means the cold-start cost (bundle eval +
 * Ember app creation) is paid once when the server initialises its pool,
 * and every render request hits a fully warm EmberApplication instance.
 *
 * Worker API: tinypool single-function style — just `export default`.
 */

import { Window } from 'happy-dom';
import type { CssManifest } from './vite-plugin.js';
import type {
  EmberApplication,
  EmberApplicationInstance,
  BootOptions,
  ShoeboxEntry,
} from './server.js';

// ─── Types ────────────────────────────────────────────────────────────

export interface WorkerRenderOptions {
  ssrBundlePath: string;
  url: string;
  shoebox: boolean;
  rehydrate: boolean;
  cssManifest: CssManifest | null;
}

export interface WorkerRenderResult {
  head: string;
  body: string;
  statusCode: number;
  error?: string;
}

// ─── Browser globals ──────────────────────────────────────────────────

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

function installGlobals(win: Window): void {
  // Capture any Embroider-set properties from the previous window BEFORE
  // replacing it. Embroider's lazy route loader writes `_embroiderRouteBundles_`
  // onto `window` at bundle evaluation time. When we swap in a fresh Window
  // per render, the new window object won't have this property — causing lazy
  // routes to resolve as empty. We copy it forward explicitly.
  const prevWindow = (globalThis as Record<string, unknown>)['window'] as
    | Record<string, unknown>
    | undefined;

  for (const name of BROWSER_GLOBALS) {
    try {
      Object.defineProperty(globalThis, name, {
        value: (win as unknown as Record<string, unknown>)[name],
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      /* skip non-overridable globals */
    }
  }

  if (prevWindow && '_embroiderRouteBundles_' in prevWindow) {
    (win as unknown as Record<string, unknown>)['_embroiderRouteBundles_'] =
      prevWindow['_embroiderRouteBundles_'];
  }
}

// ─── Eager startup: import bundle + create app ────────────────────────
//
// workerData.ssrBundlePath is set by server.ts when constructing the pool.
// Top-level await here runs before tinypool dispatches the first render
// request, so every render hits a fully warm EmberApplication.

const { ssrBundlePath: startupBundlePath } = (
  process as unknown as {
    __tinypool_state__: { workerData: { ssrBundlePath: string } };
  }
).__tinypool_state__.workerData;

// Install globals from a bootstrap Window before importing the bundle.
// Bundles (and their lazy chunks) may access window/document at module
// evaluation time, so a real Window must be in globalThis beforehand.
const bootstrapWin = new Window({
  url: 'http://localhost/',
  width: 1024,
  height: 768,
  settings: {
    disableJavaScriptFileLoading: true,
    disableJavaScriptEvaluation: true,
    disableCSSFileLoading: true,
    navigator: { userAgent: 'vite-ember-ssr' },
  },
});
installGlobals(bootstrapWin);

const startupMod = (await import(startupBundlePath)) as {
  createSsrApp?: () => EmberApplication;
};
if (typeof startupMod.createSsrApp !== 'function') {
  throw new Error(
    `SSR bundle '${startupBundlePath}' does not export a 'createSsrApp' function. ` +
      `Found exports: ${Object.keys(startupMod).join(', ')}`,
  );
}

const app: EmberApplication = startupMod.createSsrApp();

// ─── Shoebox ──────────────────────────────────────────────────────────

const SHOEBOX_SCRIPT_ID = 'vite-ember-ssr-shoebox';

function createFetchInterceptor() {
  const entries = new Map<string, ShoeboxEntry>();
  const originalFetch = globalThis.fetch;

  const interceptedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method.toUpperCase() !== 'GET')
      return originalFetch(input, init);
    const response = await originalFetch(input, init);
    try {
      const clone = response.clone();
      const body = await clone.text();
      const headers: Record<string, string> = {};
      clone.headers.forEach((v, k) => {
        headers[k] = v;
      });
      entries.set(request.url, {
        url: request.url,
        status: clone.status,
        statusText: clone.statusText,
        headers,
        body,
      });
    } catch {
      /* skip */
    }
    return response;
  };

  return {
    install() {
      globalThis.fetch = interceptedFetch;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
    getEntries(): ShoeboxEntry[] {
      return Array.from(entries.values());
    },
  };
}

function serializeShoebox(entries: ShoeboxEntry[]): string {
  if (entries.length === 0) return '';
  const safeJson = JSON.stringify(entries).replace(/<\/(script)/gi, '<\\/$1');
  return `<script type="application/json" id="${SHOEBOX_SCRIPT_ID}">${safeJson}</script>`;
}

// ─── CSS manifest helpers ─────────────────────────────────────────────

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
    return undefined;
  }
}

function buildRouteCssLinks(
  manifest: CssManifest | null,
  instance: EmberApplicationInstance,
): string {
  if (!manifest) return '';
  const routeName = getActiveRouteName(instance);
  if (!routeName) return '';
  const segments = routeName.split('.');
  const seen = new Set<string>();
  const links: string[] = [];
  for (let i = 1; i <= segments.length; i++) {
    const cssFiles = manifest[segments.slice(0, i).join('.')];
    if (!cssFiles) continue;
    for (const href of cssFiles) {
      if (seen.has(href)) continue;
      seen.add(href);
      links.push(`<link rel="stylesheet" href="${href}">`);
    }
  }
  return links.join('');
}

// ─── Default export (tinypool worker API) ────────────────────────────

export default async function render(
  options: WorkerRenderOptions,
): Promise<WorkerRenderResult> {
  const { url, shoebox, rehydrate, cssManifest } = options;

  // Create a fresh Window per render for an isolated DOM / location / document.
  const win = new Window({
    url: `http://localhost${url}`,
    width: 1024,
    height: 768,
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      navigator: { userAgent: 'vite-ember-ssr' },
    },
  });

  // Update globalThis.window/document/location to this render's Window so
  // Ember sees the correct URL and document for this request.
  installGlobals(win);

  const interceptor = shoebox ? createFetchInterceptor() : null;

  const document = win.document;
  let head = '';
  let body = '';
  let cssLinks = '';
  let error: Error | undefined;

  try {
    try {
      interceptor?.install();

      const bootOptions: BootOptions = {
        isBrowser: false,
        document: document as unknown as Document,
        rootElement: document.body as unknown as Element,
        shouldRender: true,
        ...(rehydrate ? { _renderMode: 'serialize' as const } : {}),
      };

      const instance = await app.visit(url, bootOptions);

      // Drain Backburner's autorun microtask before reading the DOM.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      if (cssManifest) cssLinks = buildRouteCssLinks(cssManifest, instance);
      head = document.head?.innerHTML ?? '';
      body = document.body?.innerHTML ?? '';
    } finally {
      interceptor?.restore();
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  const shoeboxHTML = interceptor
    ? serializeShoebox(interceptor.getEntries())
    : '';
  const rehydrateHTML = rehydrate
    ? '<script>window.__vite_ember_ssr_rehydrate__=true</script>'
    : '';
  const fullHead = cssLinks + rehydrateHTML + shoeboxHTML + head;
  const wrappedBody = rehydrate
    ? body
    : `<script type="x/boundary" id="ssr-body-start"></script>${body}<script type="x/boundary" id="ssr-body-end"></script>`;

  return {
    head: fullHead,
    body: wrappedBody,
    statusCode: error ? 500 : 200,
    ...(error
      ? { error: error.message + (error.stack ? '\n' + error.stack : '') }
      : {}),
  };
}

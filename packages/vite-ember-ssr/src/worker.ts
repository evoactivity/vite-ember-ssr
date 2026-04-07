/**
 * EXPERIMENT: long-lived-window
 *
 * Models an SSR worker the same way a browser tab works: one Window,
 * one EmberApplication, running forever. Every render is a bare
 * `app.visit(url)` — no Window construction, no globalThis mutation,
 * no DOM reset between requests.
 *
 * Hypothesis: the per-render Window construction + installGlobals() is
 * a measurable cost that can be eliminated when renders are fully
 * sequential within a single worker (tinypool serialises tasks per thread).
 *
 * Caveats / known risks:
 *  - document accumulates state across renders (head/body from previous
 *    visit may still be present unless Ember clears them itself).
 *  - globalThis.location will always point at the initial URL unless
 *    Ember's visit() mutates it in place — which it does via the
 *    location service.
 *  - Shoebox: fetch interceptor installs/restores around each visit,
 *    same as before. No isolation concern there.
 *  - CSS manifest: same lookup logic, no change.
 *
 * If Ember's visit() fully owns the document lifecycle (clearing and
 * re-rendering head/body) this should work. If it accumulates state,
 * the rendered HTML will be wrong and tests will catch it.
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
}

// ─── Eager startup: single long-lived Window + app ────────────────────
//
// One Window is created at worker startup and lives forever.
// globalThis is set once. The EmberApplication is created once.
// Renders are serialised by tinypool (one task at a time per thread),
// so there is no concurrency concern within a single worker.

const win = new Window({
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

// Install browser globals once for this worker's lifetime.
installGlobals(win);

const { ssrBundlePath: startupBundlePath } = (
  process as unknown as {
    __tinypool_state__: { workerData: { ssrBundlePath: string } };
  }
).__tinypool_state__.workerData;

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

  // Use the long-lived document directly — no new Window, no globalThis swap.
  const document = win.document;

  const interceptor = shoebox ? createFetchInterceptor() : null;

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

      // Destroy the instance so its container is torn down cleanly.
      // app.visit() creates a fresh ApplicationInstance per call; without
      // destroying it the container's singletons (including location:none)
      // remain live and can corrupt the next visit.
      instance.destroy();
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

/**
 * SSR worker — long-lived Window per thread.
 *
 * One Window is created at worker startup and lives for the worker's lifetime.
 * One EmberApplication is created eagerly (top-level await) and reused for
 * every render. Renders are serialised by tinypool (concurrentTasksPerWorker:1),
 * so there is no concurrency concern within a single worker.
 *
 * app.visit() fully owns document.head/body between calls, so DOM state does
 * not bleed across renders. A fresh ApplicationInstance is created per visit
 * and destroyed after the DOM is read, keeping container singletons clean.
 *
 * The shoebox fetch interceptor is installed once at startup. Each render
 * assigns a fresh entries Map before visiting, so entries never bleed between
 * requests. When shoebox is disabled, the Map is set to null and the
 * interceptor is a no-op passthrough.
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

// The fetch interceptor is installed once at startup. globalThis.fetch
// never changes. Each render passes a fresh entries Map so there is no
// bleed between requests.
const realFetch = globalThis.fetch;
let shoeboxEntries: Map<string, ShoeboxEntry> | null = null;

const interceptedFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.method.toUpperCase() !== 'GET') return realFetch(input, init);
  const response = await realFetch(input, init);
  if (shoeboxEntries) {
    try {
      const clone = response.clone();
      const body = await clone.text();
      const headers: Record<string, string> = {};
      clone.headers.forEach((v, k) => {
        headers[k] = v;
      });
      shoeboxEntries.set(request.url, {
        url: request.url,
        status: clone.status,
        statusText: clone.statusText,
        headers,
        body,
      });
    } catch {
      /* skip */
    }
  }
  return response;
};

// Install once — never needs to be restored.
globalThis.fetch = interceptedFetch;

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

export default async function render(
  options: WorkerRenderOptions,
): Promise<WorkerRenderResult> {
  const { url, shoebox, rehydrate, cssManifest } = options;

  // Use the long-lived document directly — no new Window, no globalThis swap.
  const document = win.document;

  // Give the interceptor a fresh Map for this render, or null if shoebox
  // is disabled, so entries never bleed between requests.
  shoeboxEntries = shoebox ? new Map() : null;

  let head = '';
  let body = '';
  let cssLinks = '';
  let error: Error | undefined;

  try {
    const bootOptions: BootOptions = {
      isBrowser: true,
      isInteractive: true,
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

    // rehydrate mode causes left over rehydration markers to remain in the DOM, so
    // we clear the body to ensure a clean slate for the next render.
    if (rehydrate) {
      document.body.innerHTML = '';
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  const shoeboxHTML =
    shoeboxEntries && shoeboxEntries.size > 0
      ? serializeShoebox(Array.from(shoeboxEntries.values()))
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

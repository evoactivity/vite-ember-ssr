/**
 * Worker thread script for isolated SSR rendering.
 *
 * Each render runs in its own Worker so that:
 *  - The SSR bundle is imported fresh (no cross-render ESM module cache).
 *  - Prototype patches applied by ember-provide-consume-context (and
 *    similar initializers) are contained within this Worker's V8 isolate
 *    and do NOT accumulate across renders.
 *  - WeakMap / module-level singleton state is fully discarded when the
 *    Worker terminates after the render.
 *
 * Input (via workerData):
 *   ssrBundlePath  – absolute path (or file:// URL) to the SSR bundle
 *   url            – the route URL to render (e.g. '/' or '/about')
 *   shoebox        – boolean: capture fetch responses for client replay
 *   rehydrate      – boolean: use Glimmer serialize/rehydrate mode
 *   cssManifest    – optional CssManifest object
 *
 * Output (via postMessage):
 *   { head, body, statusCode, error? }
 *   or { fatalError: string } on catastrophic failure
 */

import { workerData, parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import type { CssManifest } from './vite-plugin.js';
import type {
  EmberApplication,
  EmberApplicationInstance,
  BootOptions,
  ShoeboxEntry,
} from './server.js';

// ─── Types ────────────────────────────────────────────────────────────

interface WorkerInput {
  ssrBundlePath: string;
  url: string;
  shoebox: boolean;
  rehydrate: boolean;
  cssManifest?: CssManifest;
}

interface WorkerOutput {
  head: string;
  body: string;
  statusCode: number;
  error?: string;
}

// ─── Browser globals list ─────────────────────────────────────────────

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

// ─── Shoebox types ────────────────────────────────────────────────────

const SHOEBOX_SCRIPT_ID = 'vite-ember-ssr-shoebox';

function createFetchInterceptor() {
  const entries = new Map<string, ShoeboxEntry>();
  const originalFetch = globalThis.fetch;

  const interceptedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const method = request.method.toUpperCase();

    if (method !== 'GET') {
      return originalFetch(input, init);
    }

    const response = await originalFetch(input, init);
    const url = request.url;

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
      // skip
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
  const json = JSON.stringify(entries);
  const safeJson = json.replace(/<\/(script)/gi, '<\\/$1');
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

function expandRouteHierarchy(routeName: string): string[] {
  const segments = routeName.split('.');
  const routes: string[] = [];
  for (let i = 1; i <= segments.length; i++) {
    routes.push(segments.slice(0, i).join('.'));
  }
  return routes;
}

function buildRouteCssLinks(
  manifest: CssManifest | undefined,
  instance: EmberApplicationInstance | undefined,
): string {
  if (!manifest || !instance) return '';
  const routeName = getActiveRouteName(instance);
  if (!routeName) return '';
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

// ─── Main render ──────────────────────────────────────────────────────

async function runRender(): Promise<void> {
  const { ssrBundlePath, url, shoebox, rehydrate, cssManifest } =
    workerData as WorkerInput;

  let head = '';
  let body = '';
  let cssLinks = '';
  let error: Error | undefined;

  // Normalise to file URL so import() works for absolute paths too.
  const bundleURL = ssrBundlePath.startsWith('file://')
    ? ssrBundlePath
    : pathToFileURL(ssrBundlePath).href;

  const interceptor = shoebox ? createFetchInterceptor() : null;

  try {
    // Create HappyDOM window
    const window = new Window({
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

    const document = window.document;

    // Set browser globals once for this Worker's lifetime.
    // No save/restore is needed: each Worker runs exactly one render
    // and then terminates, so there is nothing to clean up. Restoring
    // globals in a finally block is actively harmful because Backburner
    // timers scheduled during app.visit() fire *after* the await
    // returns, and they still need window/document to be defined.
    for (const name of BROWSER_GLOBALS) {
      const value = (window as unknown as Record<string, unknown>)[name];
      try {
        Object.defineProperty(globalThis, name, {
          value,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } catch {
        // Some host globals may not be overridable – skip them.
      }
    }

    try {
      interceptor?.install();

      // Import the SSR bundle. Because this Worker is a fresh V8 isolate,
      // the module cache is empty — this is a genuine cold import every time.
      const ssrModule = (await import(bundleURL)) as {
        createSsrApp?: () => Promise<EmberApplication>;
      };

      if (typeof ssrModule.createSsrApp !== 'function') {
        throw new Error(
          `SSR bundle '${ssrBundlePath}' does not export a 'createSsrApp' function. ` +
            `Found exports: ${Object.keys(ssrModule).join(', ')}`,
        );
      }

      const app = await ssrModule.createSsrApp();

      const bootOptions: BootOptions = {
        isBrowser: false,
        document: document as unknown as Document,
        rootElement: document.body as unknown as Element,
        shouldRender: true,
        ...(rehydrate ? { _renderMode: 'serialize' as const } : {}),
      };

      const instance = await app.visit(url, bootOptions);

      // Let Backburner's Promise-based autorun microtask fire and complete
      // against the live DOM before we read the HTML. Without this drain,
      // the autorun fires after we've started tearing things down, causing
      // removeChild / WeakMap errors. A macrotask yield (setTimeout) is
      // sufficient: all pending microtasks run before the setTimeout fires.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      if (cssManifest) {
        cssLinks = buildRouteCssLinks(cssManifest, instance);
      }

      head = document.head?.innerHTML ?? '';
      body = document.body?.innerHTML ?? '';
    } finally {
      interceptor?.restore();
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  // Collect shoebox entries
  let shoeboxHTML = '';
  if (interceptor) {
    shoeboxHTML = serializeShoebox(interceptor.getEntries());
  }

  const rehydrateHTML = rehydrate
    ? '<script>window.__vite_ember_ssr_rehydrate__=true</script>'
    : '';

  const fullHead = cssLinks + rehydrateHTML + shoeboxHTML + head;

  const wrappedBody = rehydrate
    ? body
    : [
        '<script type="x/boundary" id="ssr-body-start"></script>',
        body,
        '<script type="x/boundary" id="ssr-body-end"></script>',
      ].join('');

  const result: WorkerOutput = {
    head: fullHead,
    body: wrappedBody,
    statusCode: error ? 500 : 200,
    ...(error
      ? { error: error.message + (error.stack ? '\n' + error.stack : '') }
      : {}),
  };

  parentPort!.postMessage(result);
}

runRender().catch((e: unknown) => {
  parentPort!.postMessage({
    fatalError: e instanceof Error ? (e.stack ?? e.message) : String(e),
  });
});

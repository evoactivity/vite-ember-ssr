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
  ForwardedCookie,
} from './server.js';
import {
  compose,
  forwardCookieMiddleware,
  shoeboxMiddleware,
} from './fetch-middleware.js';

// ─── Types ────────────────────────────────────────────────────────────

export interface WorkerRenderOptions {
  ssrBundlePath: string;
  url: string;
  shoebox: boolean;
  cssManifest: CssManifest | null;
  settledTimeout: number;
  forwardCookie: ForwardedCookie | null;
}

export interface WorkerRenderResult {
  head: string;
  body: string;
  bodyAttrs: Record<string, string>;
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
  'getComputedStyle',
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
  settled?: () => Promise<void>;
};
if (typeof startupMod.createSsrApp !== 'function') {
  throw new Error(
    `SSR bundle '${startupBundlePath}' does not export a 'createSsrApp' function. ` +
      `Found exports: ${Object.keys(startupMod).join(', ')}`,
  );
}

const app: EmberApplication = startupMod.createSsrApp();

// Optional: the SSR bundle may re-export `settled` from `@ember/test-helpers`.
// When present, the renderer awaits it after `app.visit()` so any registered
// `@ember/test-waiters` (used by WarpDrive, ember-concurrency, etc.) drain
// before the DOM is captured. When absent, we fall back to a single
// Backburner autorun drain via `setTimeout(0)`.
const appSettled: (() => Promise<void>) | null =
  typeof startupMod.settled === 'function' ? startupMod.settled : null;

// ─── Fetch middleware pipeline ────────────────────────────────────────

const SHOEBOX_SCRIPT_ID = 'vite-ember-ssr-shoebox';

// The fetch pipeline is installed once at startup. globalThis.fetch never
// changes. Per-render state (shoebox entries, forwarded cookie) lives in
// module-level variables that the middlewares read via getters.
const realFetch = globalThis.fetch;
let activeShoebox: Map<string, ShoeboxEntry> | null = null;
let activeCookie: ForwardedCookie | null = null;

const fetchWithMiddleware = compose(
  [
    forwardCookieMiddleware(() => activeCookie),
    shoeboxMiddleware(() => activeShoebox),
  ],
  (request) => realFetch(request),
);

// Install once — never needs to be restored.
globalThis.fetch = fetchWithMiddleware;

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

let warnedMissingSettled = false;

async function awaitSettled(timeoutMs: number): Promise<void> {
  if (!appSettled) {
    if (timeoutMs > 0 && !warnedMissingSettled) {
      warnedMissingSettled = true;
      console.warn(
        '[vite-ember-ssr] settledTimeout is set but the SSR bundle does not ' +
          'export `settled` — renders will NOT wait for the app to settle ' +
          'and may capture incomplete HTML. Add ' +
          "`export { settled } from '@ember/test-helpers';` to your SSR entry.",
      );
    }
    // Fallback: drain Backburner's autorun microtask before reading the DOM.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      appSettled(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`settled() timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (e) {
    console.warn(
      `[vite-ember-ssr] settled() did not resolve within ${timeoutMs}ms, ` +
        `capturing DOM anyway:`,
      e instanceof Error ? e.message : e,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default async function render(
  options: WorkerRenderOptions,
): Promise<WorkerRenderResult> {
  const { url, shoebox, cssManifest, settledTimeout, forwardCookie } = options;

  // Use the long-lived document directly — no new Window, no globalThis swap.
  const document = win.document;

  // Set per-render state. The middlewares read these via getters, so a
  // single shared pipeline can serve every render without re-installation.
  activeShoebox = shoebox ? new Map() : null;
  activeCookie = forwardCookie;

  let head = '';
  let body = '';
  let bodyAttrs: Record<string, string> = {};
  let cssLinks = '';
  let error: Error | undefined;

  try {
    const bootOptions: BootOptions = {
      isBrowser: true,
      isInteractive: true,
      document: document as unknown as Document,
      rootElement: document.body as unknown as Element,
      shouldRender: true,
      _renderMode: 'serialize',
    };

    const instance = await app.visit(url, bootOptions);

    // Wait for the app to settle (test waiters, run loop, pending timers, etc.)
    // before reading the DOM. Falls back to a microtask drain when the SSR
    // bundle doesn't export `settled`.
    await awaitSettled(settledTimeout);

    if (cssManifest) cssLinks = buildRouteCssLinks(cssManifest, instance);
    head = document.head?.innerHTML ?? '';
    body = document.body?.innerHTML ?? '';

    // Extract attributes set on <body> during rendering (e.g., data-theme, class).
    if (document.body) {
      for (const attr of Array.from(document.body.attributes)) {
        bodyAttrs[attr.name] = attr.value;
      }
    }

    // Destroy the instance so its container is torn down cleanly.
    // app.visit() creates a fresh ApplicationInstance per call; without
    // destroying it the container's singletons (including location:none)
    // remain live and can corrupt the next visit.
    instance.destroy();

    // Serialize mode leaves rehydration markers in the DOM, so we clear
    // the body to ensure a clean slate for the next render.
    document.body.innerHTML = '';

    // Clear body attributes so they don't bleed into the next render.
    if (document.body) {
      for (const attr of Array.from(document.body.attributes)) {
        document.body.removeAttribute(attr.name);
      }
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  const shoeboxHTML =
    activeShoebox && activeShoebox.size > 0
      ? serializeShoebox(Array.from(activeShoebox.values()))
      : '';

  // Clear per-render state so a stray late fetch can't see stale config.
  activeShoebox = null;
  activeCookie = null;
  const rehydrateHTML =
    '<script>window.__vite_ember_ssr_rehydrate__=true</script>';
  const fullHead = cssLinks + rehydrateHTML + shoeboxHTML + head;

  return {
    head: fullHead,
    body,
    bodyAttrs,
    statusCode: error ? 500 : 200,
    ...(error
      ? { error: error.message + (error.stack ? '\n' + error.stack : '') }
      : {}),
  };
}

/**
 * Dev-mode SSR renderer for vite-ember-ssr.
 *
 * Renders in-process using Vite's `ssrLoadModule` pipeline instead of a
 * tinypool worker pool. The SSR entry module is re-loaded on every render
 * so HMR changes are picked up immediately.
 *
 * A fresh HappyDOM Window is created and torn down for each render — there
 * is no long-lived state between requests.
 *
 * Usage:
 * ```js
 * import { createServer } from 'vite';
 * import { createEmberApp, assembleHTML } from 'vite-ember-ssr/server';
 *
 * const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
 * const app = await createEmberApp('app/app-ssr.ts', {
 *   dev: { ssrLoadModule: vite.ssrLoadModule.bind(vite) },
 * });
 *
 * // In your catch-all handler:
 * const rendered = await app.renderRoute(req.url);
 * const html = assembleHTML(template, rendered);
 * ```
 */

import { Window } from 'happy-dom';
import type {
  EmberApplication,
  EmberApplicationInstance,
  BootOptions,
  RenderRouteOptions,
  RenderResult,
  ShoeboxEntry,
  ForwardedCookie,
  EmberApp,
  EmberAppDevOptions,
} from './server.js';
import {
  compose,
  forwardCookieMiddleware,
  shoeboxMiddleware,
} from './fetch-middleware.js';

// ─── Constants ────────────────────────────────────────────────────────
// @todo I've seen happydom has a global registration method, use that
// instead of manually installing globals.
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
  'getComputedStyle',
] as const;

const SHOEBOX_SCRIPT_ID = 'vite-ember-ssr-shoebox';

// Warn only once per process — the SSR entry is re-loaded on every render
// in dev mode, so a per-render warning would flood the console.
let warnedMissingSettled = false;

// ─── Helpers ──────────────────────────────────────────────────────────

function installGlobals(win: Window): Record<string, unknown> {
  const saved: Record<string, unknown> = {};
  for (const name of BROWSER_GLOBALS) {
    saved[name] = (globalThis as Record<string, unknown>)[name];
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
  return saved;
}

function restoreGlobals(saved: Record<string, unknown>): void {
  for (const name of BROWSER_GLOBALS) {
    try {
      Object.defineProperty(globalThis, name, {
        value: saved[name],
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      /* skip */
    }
  }
}

function serializeShoebox(entries: ShoeboxEntry[]): string {
  if (entries.length === 0) return '';
  const safeJson = JSON.stringify(entries).replace(/<\/(script)/gi, '<\\/$1');
  return `<script type="application/json" id="${SHOEBOX_SCRIPT_ID}">${safeJson}</script>`;
}

function buildRouteCssLinks(
  manifest: NonNullable<RenderRouteOptions['cssManifest']>,
  instance: EmberApplicationInstance,
): string {
  if (!instance.lookup) return '';
  let routeName: string | undefined;
  try {
    const router = instance.lookup('service:router') as
      | { currentRouteName?: string }
      | undefined;
    routeName = router?.currentRouteName ?? undefined;
  } catch {
    return '';
  }
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

// ─── Dev EmberApp factory ─────────────────────────────────────────────

/**
 * Creates a dev-mode EmberApp that renders in-process via Vite's
 * `ssrLoadModule`. Implements the same `EmberApp` interface as the
 * production `createEmberApp` so it can be used as a drop-in.
 */
export function createDevEmberApp(
  entryPath: string,
  devOptions: EmberAppDevOptions,
): EmberApp {
  const { ssrLoadModule } = devOptions;

  // Install browser globals once at startup so module-evaluation-time access
  // (e.g. `@ember/test-helpers` reading `document` at the top level) succeeds
  // even before the first per-request window is created. The per-request
  // window below replaces these globals during the actual render.
  const startupWindow = new Window({
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
  installGlobals(startupWindow);

  return {
    async renderRoute(
      url: string,
      renderOptions: RenderRouteOptions = {},
    ): Promise<RenderResult> {
      const {
        shoebox = false,
        cssManifest,
        settledTimeout = 10_000,
        forwardCookie,
      } = renderOptions;

      // Fresh Window per request — no state bleeds between renders in dev.
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

      const savedGlobals = installGlobals(win);

      // Build a per-render fetch middleware pipeline. State is captured by
      // closure so each render is fully isolated from the next.
      const realFetch = globalThis.fetch;
      const shoeboxEntries: Map<string, ShoeboxEntry> | null = shoebox
        ? new Map()
        : null;
      const cookie: ForwardedCookie | null = forwardCookie ?? null;
      const middlewareActive = shoeboxEntries !== null || cookie !== null;

      if (middlewareActive) {
        globalThis.fetch = compose(
          [
            forwardCookieMiddleware(() => cookie),
            shoeboxMiddleware(() => shoeboxEntries),
          ],
          (request) => realFetch(request),
        );
      }

      let head = '';
      let body = '';
      let bodyAttrs: Record<string, string> = {};
      let cssLinks = '';
      let error: Error | undefined;

      try {
        const document = win.document;

        // Re-load the module on every request so HMR changes are reflected.
        const mod = (await ssrLoadModule(entryPath)) as {
          createSsrApp?: () => EmberApplication;
          settled?: () => Promise<void>;
        };
        if (typeof mod.createSsrApp !== 'function') {
          throw new Error(
            `SSR entry '${entryPath}' does not export a 'createSsrApp' function. ` +
              `Found exports: ${Object.keys(mod).join(', ')}`,
          );
        }
        const app = mod.createSsrApp();
        const appSettled =
          typeof mod.settled === 'function' ? mod.settled : null;

        const bootOptions: BootOptions = {
          isBrowser: false,
          document: document as unknown as Document,
          rootElement: document.body as unknown as Element,
          shouldRender: true,
          _renderMode: 'serialize',
        };

        const instance = await app.visit(url, bootOptions);

        // Wait for the app to settle (test waiters, run loop, pending timers).
        // Fallback to a microtask drain when the SSR entry doesn't export it.
        if (appSettled) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              appSettled(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        `settled() timed out after ${settledTimeout}ms`,
                      ),
                    ),
                  settledTimeout,
                );
              }),
            ]);
          } catch (e) {
            console.warn(
              `[vite-ember-ssr] settled() did not resolve within ${settledTimeout}ms, ` +
                `capturing DOM anyway:`,
              e instanceof Error ? e.message : e,
            );
          } finally {
            if (timer) clearTimeout(timer);
          }
        } else {
          if (settledTimeout > 0 && !warnedMissingSettled) {
            warnedMissingSettled = true;
            console.warn(
              '[vite-ember-ssr] settledTimeout is set but the SSR entry does ' +
                'not export `settled` — renders will NOT wait for the app to ' +
                'settle and may capture incomplete HTML. Add ' +
                "`export { settled } from '@ember/test-helpers';` to your " +
                'SSR entry.',
            );
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }

        if (cssManifest) {
          cssLinks = buildRouteCssLinks(cssManifest, instance);
        }

        head = document.head?.innerHTML ?? '';
        body = document.body?.innerHTML ?? '';

        // Extract attributes set on <body> during rendering
        if (document.body) {
          for (const attr of Array.from(document.body.attributes)) {
            bodyAttrs[attr.name] = attr.value;
          }
        }

        instance.destroy();
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
      } finally {
        if (middlewareActive) globalThis.fetch = realFetch;
        restoreGlobals(savedGlobals);
        await win.happyDOM?.close?.();
      }

      const shoeboxHTML =
        shoeboxEntries && shoeboxEntries.size > 0
          ? serializeShoebox(Array.from(shoeboxEntries.values()))
          : '';
      const rehydrateHTML =
        '<script>window.__vite_ember_ssr_rehydrate__=true</script>';
      const fullHead = cssLinks + rehydrateHTML + shoeboxHTML + head;

      return {
        head: fullHead,
        body,
        bodyAttrs,
        statusCode: error ? 500 : 200,
        ...(error ? { error } : {}),
      };
    },

    async destroy(): Promise<void> {
      // Nothing to tear down — no worker pool in dev mode.
    },
  };
}

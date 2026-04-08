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
  EmberApp,
  EmberAppDevOptions,
} from './server.js';

// ─── Constants ────────────────────────────────────────────────────────

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

const SHOEBOX_SCRIPT_ID = 'vite-ember-ssr-shoebox';
const SSR_BODY_START =
  '<script type="x/boundary" id="ssr-body-start"></script>';
const SSR_BODY_END = '<script type="x/boundary" id="ssr-body-end"></script>';

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

  return {
    async renderRoute(
      url: string,
      renderOptions: RenderRouteOptions = {},
    ): Promise<RenderResult> {
      const { shoebox = false, rehydrate = false, cssManifest } = renderOptions;

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

      // Shoebox: intercept fetch for this render only.
      const realFetch = globalThis.fetch;
      const shoeboxEntries: Map<string, ShoeboxEntry> | null = shoebox
        ? new Map()
        : null;

      if (shoebox) {
        globalThis.fetch = async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ) => {
          const request = new Request(input, init);
          if (request.method.toUpperCase() !== 'GET')
            return realFetch(input, init);
          const response = await realFetch(input, init);
          if (shoeboxEntries) {
            try {
              const clone = response.clone();
              const body = await clone.text();
              const headers: Record<string, string> = {};
              clone.headers.forEach((v: string, k: string) => {
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
      }

      let head = '';
      let body = '';
      let cssLinks = '';
      let error: Error | undefined;

      try {
        const document = win.document;

        // Re-load the module on every request so HMR changes are reflected.
        const mod = (await ssrLoadModule(entryPath)) as {
          createSsrApp?: () => EmberApplication;
        };
        if (typeof mod.createSsrApp !== 'function') {
          throw new Error(
            `SSR entry '${entryPath}' does not export a 'createSsrApp' function. ` +
              `Found exports: ${Object.keys(mod).join(', ')}`,
          );
        }
        const app = mod.createSsrApp();

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

        if (cssManifest) {
          cssLinks = buildRouteCssLinks(cssManifest, instance);
        }

        head = document.head?.innerHTML ?? '';
        body = document.body?.innerHTML ?? '';
        instance.destroy();
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
      } finally {
        if (shoebox) globalThis.fetch = realFetch;
        restoreGlobals(savedGlobals);
        await win.happyDOM?.close?.();
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
        : `${SSR_BODY_START}${body}${SSR_BODY_END}`;

      return {
        head: fullHead,
        body: wrappedBody,
        statusCode: error ? 500 : 200,
        ...(error ? { error } : {}),
      };
    },

    async destroy(): Promise<void> {
      // Nothing to tear down — no worker pool in dev mode.
    },
  };
}

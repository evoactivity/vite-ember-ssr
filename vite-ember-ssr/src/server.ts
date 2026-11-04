import { pathToFileURL, fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import type { CssManifest } from './vite-plugin.js';
import { createDevEmberApp } from './dev.js';

// ─── Worker script path ───────────────────────────────────────────────

// Resolve the worker script relative to this compiled file.
// In the dist/ output both server.js and worker.js sit side-by-side.
const WORKER_PATH = fileURLToPath(new URL('./worker.js', import.meta.url));

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Minimal interface for an Ember Application that supports SSR.
 *
 * The app must be created with `autoboot: false` so the server can
 * control boot timing via `app.visit(url, options)`.
 */
export interface EmberApplication {
  visit(url: string, options?: BootOptions): Promise<EmberApplicationInstance>;
  destroy(): void;
}

export interface EmberApplicationInstance {
  destroy(): void;
  getURL?(): string;
  _booted?: boolean;
  lookup?(fullName: string): unknown;
}

export interface BootOptions {
  isBrowser: boolean;
  isInteractive?: boolean;
  document: Document;
  rootElement: Element;
  shouldRender: boolean;
  location?: string;
  _renderMode?: 'serialize' | 'rehydrate' | undefined;
}

/**
 * Configures forwarding of the incoming request's `Cookie` header to
 * fetch() calls made during SSR rendering.
 *
 * `allowedHosts` is required: forwarding the session cookie to every
 * outbound fetch would leak credentials to third-party APIs the route
 * happens to call. Each entry is matched against the request URL's
 * `host` (hostname plus port) using exact equality — suffix wildcards
 * are not supported.
 */
export interface ForwardedCookie {
  /** Cookie header value from the incoming request. */
  value: string;
  /**
   * Hosts (`URL.host`) the cookie may be sent to. Exact match, no wildcards.
   *
   * @example ['api.example.com', 'auth.example.com:8080']
   */
  allowedHosts: string[];
}

export interface RenderRouteOptions {
  /**
   * When true, intercepts all fetch() calls during SSR rendering and
   * serializes the responses into a <script> tag in the HTML output.
   */
  shoebox?: boolean;

  /**
   * CSS manifest mapping route names to their associated CSS asset paths.
   *
   * Generated automatically by the `emberSsr()` Vite plugin during the
   * client build (written as `css-manifest.json`).
   */
  cssManifest?: CssManifest;

  /**
   * Maximum time (in milliseconds) to wait for `settled()` to resolve after
   * `app.visit()`. Only applies when the SSR bundle exports a `settled`
   * function (typically re-exported from `@ember/test-helpers`).
   *
   * If the timeout is exceeded, a warning is logged and the DOM is captured
   * regardless. Use this to bound render time when a route registers a
   * waiter that never resolves.
   *
   * @default 10000
   */
  settledTimeout?: number;

  /**
   * Forward the incoming request's `Cookie` header to fetch() calls made
   * during SSR rendering. The cookie is only sent to hosts listed in
   * `allowedHosts`, so credentials never leak to third-party APIs the
   * route may also call.
   *
   * @example
   * ```js
   * await app.renderRoute(req.url, {
   *   forwardCookie: {
   *     value: req.headers.cookie ?? '',
   *     allowedHosts: ['api.example.com'],
   *   },
   * });
   * ```
   */
  forwardCookie?: ForwardedCookie;
}

export interface RenderResult {
  /** Rendered HTML from the document's <head> */
  head: string;
  /** Rendered HTML from the document's <body> */
  body: string;
  /** Attributes set on the <body> element during rendering (e.g., data-theme, class) */
  bodyAttrs: Record<string, string>;
  /** Attributes set on the <html> element during rendering (e.g., lang, dir, class) */
  htmlAttrs: Record<string, string>;
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
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

// ─── EmberApp ────────────────────────────────────────────────────────

export interface EmberAppDevOptions {
  /**
   * Vite's `ssrLoadModule` function from the dev server.
   *
   * When provided, `createEmberApp` skips tinypool entirely and renders
   * in-process using Vite's module resolution pipeline. The SSR entry is
   * re-loaded on every render so HMR changes are reflected immediately.
   *
   * Obtain this from your Vite dev server instance:
   * ```js
   * const vite = await createServer({ ... });
   * await createEmberApp('app/app-ssr.ts', {
   *   dev: { ssrLoadModule: vite.ssrLoadModule.bind(vite) },
   * });
   * ```
   */
  ssrLoadModule: (path: string) => Promise<Record<string, unknown>>;
}

export interface EmberAppOptions {
  /**
   * Number of long-lived worker threads in the pool.
   *
   * Each worker imports the SSR bundle once and handles all subsequent
   * render requests without re-importing — making per-render cost ~4ms
   * instead of ~200ms for a fresh-worker approach.
   *
   * Ignored when `dev` is provided.
   *
   * @default os.cpus().length
   */
  workers?: number;

  /**
   * How often (in milliseconds) to recycle all workers in the pool.
   *
   * When set, `pool.recycleWorkers()` is called on this interval —
   * tinypool waits for all in-flight tasks to complete, then replaces
   * every worker with a fresh one. This bounds memory growth in
   * long-running processes where workers accumulate state over time.
   *
   * Set to `0` or omit to disable periodic recycling.
   *
   * Ignored when `dev` is provided.
   *
   * @example
   * // Recycle workers every hour
   * await createEmberApp(bundlePath, { recycleWorkerInterval: 60 * 60 * 1000 });
   */
  recycleWorkerInterval?: number;

  /**
   * When `true`, each render task is handled by a freshly-started worker.
   *
   * This maps directly to tinypool's `isolateWorkers` option. The worker is
   * replaced after every task, so module-level state (caches, singletons,
   * open handles) never bleeds between requests. The trade-off is that every
   * render pays the full worker-startup and bundle-import cost instead of
   * reusing a warm worker.
   *
   * For most apps the default (long-lived, warm workers) is preferred.
   * Enable isolation when you need strict request-level process boundaries,
   * e.g. when the SSR bundle keeps global state that cannot be reset between
   * renders.
   *
   * Ignored when `dev` is provided.
   *
   * @default false
   */
  isolateWorkers?: boolean;

  /**
   * Dev mode options. When provided, skips tinypool and renders in-process
   * via Vite's `ssrLoadModule` so HMR changes are picked up on every render.
   */
  dev?: EmberAppDevOptions;
}

export interface EmberApp {
  /**
   * Renders a route and returns the raw head/body HTML fragments.
   *
   * @param url  The URL path to render, e.g. `'/'` or `'/about'`
   */
  renderRoute(url: string, options?: RenderRouteOptions): Promise<RenderResult>;

  /**
   * Shuts down the worker pool. Call this when the app server is
   * stopping or after SSG prerendering is complete.
   */
  destroy(): Promise<void>;
}

// ─── EmberApp factory ────────────────────────────────────────────────

/**
 * Creates a long-lived worker thread pool for SSR/SSG rendering.
 *
 * Each worker imports the SSR bundle once at startup and reuses it for all
 * subsequent renders — no bundle re-import, no Worker respawn.
 *
 * Pass `dev: { ssrLoadModule }` to run in dev mode instead: renders happen
 * in-process via Vite's module resolution pipeline with no tinypool workers.
 * The SSR entry is re-loaded on every render so HMR changes are reflected
 * immediately.
 *
 * @example Production
 * ```js
 * import { createEmberApp, assembleHTML } from 'vite-ember-ssr/server';
 * import { resolve } from 'node:path';
 *
 * const app = await createEmberApp(resolve('dist/server/app-ssr.mjs'));
 *
 * // In a request handler:
 * const result = await app.renderRoute(req.url);
 * const html = assembleHTML(template, result);
 *
 * // On server shutdown:
 * await app.destroy();
 * ```
 *
 * @example Development
 * ```js
 * import { createServer } from 'vite';
 * import { createEmberApp, assembleHTML } from 'vite-ember-ssr/server';
 *
 * const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
 * const app = await createEmberApp('app/app-ssr.ts', {
 *   dev: { ssrLoadModule: vite.ssrLoadModule.bind(vite) },
 * });
 * ```
 */
export async function createEmberApp(
  ssrBundlePath: string,
  options: EmberAppOptions = {},
): Promise<EmberApp> {
  if (options.dev) {
    return createDevEmberApp(ssrBundlePath, options.dev);
  }

  const bundleURL = ssrBundlePath.startsWith('file://')
    ? ssrBundlePath
    : pathToFileURL(ssrBundlePath).href;

  const workerCount = options.workers ?? cpus().length;

  const { default: Tinypool } = await import('tinypool');
  const pool = new Tinypool({
    filename: WORKER_PATH,
    minThreads: workerCount,
    maxThreads: workerCount,
    isolateWorkers: options.isolateWorkers ?? false,
    // Pass the bundle URL so the worker can import it eagerly at startup,
    // paying the cold-start cost once (at server init) rather than on the
    // first render request.
    workerData: { ssrBundlePath: bundleURL },
  });

  // Schedule periodic worker recycling when requested.  pool.recycleWorkers()
  // waits for all in-flight renders to finish before replacing every worker
  // with a fresh one, bounding memory growth in long-running processes.
  let recycleTimer: ReturnType<typeof setInterval> | undefined;
  const recycleInterval = options.recycleWorkerInterval ?? 0;
  if (recycleInterval > 0) {
    recycleTimer = setInterval(() => {
      pool.recycleWorkers().catch(() => {
        // recycleWorkers rejects only if the pool is already being destroyed;
        // swallow the error to avoid an unhandled rejection on shutdown.
      });
    }, recycleInterval);
    // Allow the process to exit naturally without waiting for the next tick.
    recycleTimer.unref();
  }

  return {
    async renderRoute(
      url: string,
      renderOptions: RenderRouteOptions = {},
    ): Promise<RenderResult> {
      let result: {
        head: string;
        body: string;
        bodyAttrs: Record<string, string>;
        htmlAttrs: Record<string, string>;
        statusCode: number;
        error?: string;
      };

      try {
        result = await pool.run({
          ssrBundlePath: bundleURL,
          url,
          shoebox: renderOptions.shoebox ?? false,
          cssManifest: renderOptions.cssManifest ?? null,
          settledTimeout: renderOptions.settledTimeout ?? 10_000,
          forwardCookie: renderOptions.forwardCookie ?? null,
        });
      } catch (e) {
        // The worker itself failed (it crashed or was killed): the render
        // fails as one that threw would, and the pool starts a new worker.
        return {
          head: '',
          body: '',
          bodyAttrs: {},
          htmlAttrs: {},
          statusCode: 500,
          error: e instanceof Error ? e : new Error(String(e)),
        };
      }

      return {
        head: result.head,
        body: result.body,
        bodyAttrs: result.bodyAttrs ?? {},
        htmlAttrs: result.htmlAttrs ?? {},
        statusCode: result.statusCode,
        error: result.error ? new Error(result.error) : undefined,
      };
    },

    async destroy(): Promise<void> {
      clearInterval(recycleTimer);
      await pool.destroy();
    },
  };
}

// ─── HTML Assembly ───────────────────────────────────────────────────

const SSR_HEAD_MARKER = '<!-- VITE_EMBER_SSR_HEAD -->';
const SSR_BODY_MARKER = '<!-- VITE_EMBER_SSR_BODY -->';
const SSR_MARKER_REGEX = /<!-- VITE_EMBER_SSR_(HEAD|BODY) -->/g;

/**
 * Assembles the final HTML response by inserting rendered content
 * into the index.html template.
 *
 * When `rendered.bodyAttrs` is provided, attributes set on the `<body>`
 * element during SSR (e.g., `data-theme`, `class`) are applied to the
 * `<body>` tag in the template HTML. `rendered.htmlAttrs` does the same for
 * the `<html>` tag (e.g., `lang`, `dir`). A rendered attribute replaces the
 * template's attribute of the same name.
 */
export function assembleHTML(
  template: string,
  rendered: Pick<RenderResult, 'head' | 'body'> &
    Partial<Pick<RenderResult, 'bodyAttrs' | 'htmlAttrs'>>,
): string {
  let headReplaced = false;
  let bodyReplaced = false;

  let html = template.replace(SSR_MARKER_REGEX, (_match, tag: string) => {
    if (tag === 'HEAD' && !headReplaced) {
      headReplaced = true;
      return withoutStylesheetsOf(template, rendered.head);
    }
    if (tag === 'BODY' && !bodyReplaced) {
      bodyReplaced = true;
      return rendered.body;
    }
    return '';
  });

  // Apply <html> and <body> attributes from SSR rendering
  html = withAttributes(html, 'html', rendered.htmlAttrs);
  html = withAttributes(html, 'body', rendered.bodyAttrs);

  return html;
}

const ATTRIBUTE_REGEX =
  /\s([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

/**
 * Sets `attrs` on the first `<tag>` of the HTML: replaces the value of an
 * attribute the tag already has, and appends the others.
 */
function withAttributes(
  html: string,
  tag: 'html' | 'body',
  attrs: Record<string, string> | undefined,
): string {
  if (!attrs || Object.keys(attrs).length === 0) return html;

  return html.replace(
    new RegExp(`<${tag}(\\s[^>]*)?>`, 'i'),
    (_match, existing = '') => {
      const kept = (existing as string).replace(
        ATTRIBUTE_REGEX,
        (attr, name: string) => (name.toLowerCase() in attrs ? '' : attr),
      );
      const added = Object.entries(attrs)
        .map(
          ([key, value]) =>
            ` ${key}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`,
        )
        .join('');

      return `<${tag}${kept}${added}>`;
    },
  );
}

const STYLESHEET_LINK_REGEX = /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/g;
const HREF_REGEX = /\bhref=["']([^"']+)["']/;

/**
 * Drops the stylesheet links of the rendered head whose href the template
 * already has. The CSS of a route chunk can also be CSS of the entry, and
 * Vite already put a link for that in the template; a second link makes the
 * browser request the file twice, and it blocks rendering twice.
 */
function withoutStylesheetsOf(template: string, head: string): string {
  const inTemplate = new Set<string>();

  for (const link of template.match(STYLESHEET_LINK_REGEX) ?? []) {
    const href = link.match(HREF_REGEX)?.[1];
    if (href) inTemplate.add(href);
  }

  if (inTemplate.size === 0) return head;

  return head.replace(STYLESHEET_LINK_REGEX, (link) => {
    const href = link.match(HREF_REGEX)?.[1];
    return href && inTemplate.has(href) ? '' : link;
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

// ─── CSS Manifest Loading ────────────────────────────────────────────

export type { CssManifest } from './vite-plugin.js';
export { CSS_MANIFEST_FILENAME } from './vite-plugin.js';

/**
 * Loads the CSS manifest from the client build output directory.
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
    return undefined;
  }
}

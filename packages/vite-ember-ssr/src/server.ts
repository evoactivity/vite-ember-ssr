import { Worker } from 'node:worker_threads';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { CssManifest } from './vite-plugin.js';

// ─── Worker script path ───────────────────────────────────────────────

// Resolve the worker script relative to this compiled file.
// In the dist/ output both server.js and ssr-worker.js sit side-by-side.
const WORKER_PATH = fileURLToPath(new URL('./ssr-worker.js', import.meta.url));

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
  document: Document;
  rootElement: Element;
  shouldRender: boolean;
  location?: string;
  _renderMode?: 'serialize' | 'rehydrate' | undefined;
}

export interface RenderOptions {
  /** The URL path to render, e.g., '/' or '/about' */
  url: string;

  /**
   * Absolute path (or `file://` URL) to the pre-built SSR bundle.
   *
   * The bundle must export a `createSsrApp` function. Each render runs
   * in a fresh Worker thread so the bundle is imported clean every time —
   * there is no shared module cache or prototype-patch accumulation
   * between renders.
   *
   * @example
   * ```js
   * import { resolve } from 'node:path';
   * const { html } = await render({
   *   url: '/about',
   *   template,
   *   ssrBundlePath: resolve('dist/server/app-ssr.mjs'),
   * });
   * ```
   */
  ssrBundlePath: string;

  /**
   * When true, intercepts all fetch() calls during SSR rendering and
   * serializes the responses into a <script> tag in the HTML output.
   */
  shoebox?: boolean;

  /**
   * Enable Glimmer VM rehydration mode.
   *
   * When true, the server renders with `_renderMode: 'serialize'`,
   * annotating the DOM with markers Glimmer can reuse on the client.
   *
   * @default false
   */
  rehydrate?: boolean;

  /**
   * CSS manifest mapping route names to their associated CSS asset paths.
   *
   * Generated automatically by the `emberSsr()` Vite plugin during the
   * client build (written as `css-manifest.json`).
   */
  cssManifest?: CssManifest;
}

export interface RenderResult {
  /** Rendered HTML from the document's <head> */
  head: string;
  /** Rendered HTML from the document's <body> */
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
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

// ─── Core Rendering ──────────────────────────────────────────────────

/**
 * Renders an Ember application at the given URL inside a fresh Worker
 * thread, giving each render complete V8 isolate + module registry
 * isolation.
 *
 * The SSR bundle is imported fresh in every Worker so prototype patches
 * applied by Ember initializers (e.g. `ember-provide-consume-context`)
 * never accumulate across renders.
 */
export async function renderEmberApp(
  options: RenderOptions,
): Promise<RenderResult> {
  const {
    ssrBundlePath,
    url,
    shoebox = false,
    rehydrate = false,
    cssManifest,
  } = options;

  // Normalise to a file:// URL string so the worker's import() works
  // regardless of whether the caller passed an absolute path or URL.
  const bundleURL = ssrBundlePath.startsWith('file://')
    ? ssrBundlePath
    : pathToFileURL(ssrBundlePath).href;

  return new Promise<RenderResult>((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: {
        ssrBundlePath: bundleURL,
        url,
        shoebox,
        rehydrate,
        cssManifest: cssManifest ?? null,
      },
    });

    worker.once(
      'message',
      (result: {
        head?: string;
        body?: string;
        statusCode?: number;
        error?: string;
        fatalError?: string;
      }) => {
        worker.terminate();

        if (result.fatalError) {
          reject(new Error(result.fatalError));
          return;
        }

        resolve({
          head: result.head ?? '',
          body: result.body ?? '',
          statusCode: result.statusCode ?? 500,
          error: result.error ? new Error(result.error) : undefined,
        });
      },
    );

    worker.once('error', (err) => {
      worker.terminate();
      reject(err);
    });

    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`SSR worker exited with code ${code}`));
      }
    });
  });
}

// ─── HTML Assembly ───────────────────────────────────────────────────

const SSR_HEAD_MARKER = '<!-- VITE_EMBER_SSR_HEAD -->';
const SSR_BODY_MARKER = '<!-- VITE_EMBER_SSR_BODY -->';
const SSR_MARKER_REGEX = /<!-- VITE_EMBER_SSR_(HEAD|BODY) -->/g;

/**
 * Assembles the final HTML response by inserting rendered content
 * into the index.html template.
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
  html: string;
  statusCode: number;
  error?: Error;
}

/**
 * Renders an Ember app at the given URL and assembles the final HTML
 * in a single call. Combines `renderEmberApp` and `assembleHTML`.
 *
 * @example
 * ```js
 * const { html, statusCode } = await render({
 *   url: req.url,
 *   template,
 *   ssrBundlePath: resolve('dist/server/app-ssr.mjs'),
 * });
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

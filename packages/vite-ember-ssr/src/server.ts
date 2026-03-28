import { Window } from 'happy-dom';

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
}

export interface RenderOptions {
  /** The URL path to render, e.g., '/' or '/about' */
  url: string;

  /**
   * Factory function that creates a fresh Ember Application instance.
   * This should be the `createSsrApp` export from the Ember app.
   */
  createApp: () => EmberApplication;

  /**
   * When true, intercepts all fetch() calls during SSR rendering and
   * serializes the responses into a <script> tag in the HTML output.
   * The client can then replay these responses to avoid double-fetching.
   */
  shoebox?: boolean;
}

export interface RenderResult {
  /** Rendered HTML from the document's <head> */
  head: string;
  /** Rendered HTML from the document's <body>, wrapped in boundary markers */
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
] as const;

/**
 * Temporarily installs HappyDOM's browser globals onto globalThis
 * for the duration of a callback. Restores the originals afterward.
 */
async function withBrowserGlobals<T>(
  window: Window,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, PropertyDescriptor | undefined>();

  // Install globals
  for (const name of BROWSER_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = (window as unknown as Record<string, unknown>)[name];
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

  try {
    return await fn();
  } finally {
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
export async function renderEmberApp(options: RenderOptions): Promise<RenderResult> {
  const { url, createApp, shoebox = false } = options;

  const window = createSSRWindow(url);
  const document = window.document as unknown as Document;

  let app: EmberApplication | undefined;
  let instance: EmberApplicationInstance | undefined;
  let error: Error | undefined;
  let shoeboxEntries: ShoeboxEntry[] = [];

  // Set up the fetch interceptor before rendering (if shoebox is enabled)
  const interceptor = shoebox ? createFetchInterceptor() : null;

  try {
    await withBrowserGlobals(window, async () => {
      // Install the fetch interceptor inside withBrowserGlobals so it
      // captures fetches made during the Ember render lifecycle
      interceptor?.install();

      try {
        // Create a fresh Ember application (autoboot must be false)
        app = createApp();

        // Application#visit() handles the full boot sequence:
        //   app.boot() → app.buildInstance() → instance.boot(options) → instance.visit(url)
        const bootOptions: BootOptions = {
          isBrowser: false,
          document,
          rootElement: document.body as unknown as Element,
          shouldRender: true,
        };

        instance = await app.visit(url, bootOptions);
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

  // Prepend shoebox to head content so it's available early
  const fullHead = shoeboxHTML + head;

  // Wrap body in boundary markers so the client can identify SSR content
  const wrappedBody = [
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
 *   createApp: createSsrApp,
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
